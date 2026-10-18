// The agent: turns the tool table into node-llama-cpp functions, applies the
// permission gate, and streams every step to the UI. node-llama-cpp keeps calling
// functions until the model answers in plain text, which is the agent loop.
import os from 'node:os';
import { defineChatSessionFunction } from 'node-llama-cpp';
import { TOOLS } from './tools.js';
import { listAgents, findAgentByName, agentAllows } from './agents.js';

// Tools that work without a workspace folder.
const NO_WORKSPACE_TOOLS = new Set(['calculator', 'run_code', 'update_plan']);
const MAX_HELPER_OUTPUT = 6000;

const BASE_PROMPT = `You are Kenzo, a helpful AI assistant and agent running fully offline on the user's own computer.
Be accurate and concise. Use Markdown for formatting and fenced code blocks for code.`;

const AGENT_RULES = `You can act through tools. Rules:
- For any task that needs more than two tool calls, first call update_plan with the steps, then work through them, updating the plan as each step finishes.
- Look before you change: list or read files before editing them. Prefer edit_file for small changes to existing files.
- To create or rewrite a file: write the complete content in one fenced code block, then call write_file with just the path.
- Paths are relative to the workspace folder. Never guess file contents.
- If a tool fails, read the error, fix the cause and try again (at most twice), or explain the problem to the user.
- When finished, reply with a short summary of what you did.`;

const MEMORY_RULES = `You have long-term memory across chats.
- When the user tells you something lasting about themselves or their work (name, job, preferences, projects, goals, decisions), call remember with each fact as a separate list item. Also when they say "remember that…".
- When they ask you to forget something, or a remembered fact changed, call forget. If that memory also held other facts that are still true, call remember again with just those.
- Memory only changes through these tools. Never say you remembered or forgot something unless you called the tool in this turn.
- Don't save trivia from a single task, and never save passwords or other secrets.
- If they refer to an earlier conversation, use search_past_chats.`;

// Per-chat modes. Each mode changes both the instructions and, more
// importantly, which tools the model is even offered (enforced in
// buildFunctions, not just requested in the prompt).
export const MODES = ['chat', 'plan', 'build'];
export function modeOf(settings) {
  if (MODES.includes(settings.mode)) return settings.mode;
  return settings.planMode ? 'plan' : 'build'; // older settings
}

const CHAT_RULES = 'CHAT MODE: just talk with the user. You have no file or command tools in this mode. If they want you to work on files or build something, tell them to switch to 🔨 Build mode (below the message box).';

const PLAN_RULES = 'PLAN MODE (read only): you cannot edit files or run programs. Investigate with read tools, then call update_plan with a complete step-by-step plan and explain it briefly. End by telling the user they can press "Build this plan" to have it built.';

const BUILD_RULES = `BUILD MODE: you are building what the user asks for, end to end.
1. If there is no plan yet, call update_plan with short, concrete steps.
2. Work through the steps one by one: create files (code block, then write_file), keep each file complete and runnable.
3. Verify your work: run it with run_command or run_code. If it fails, read the error, fix the cause and run it again.
4. Mark each step done in update_plan as you finish it.
5. Finish with a short summary: what you built, which files, and how to run it.
Don't stop to ask for confirmation between steps unless something is genuinely ambiguous.`;

const TEAM_RULES = `You can hand a self-contained subtask to a specialist agent with ask_agent (give it the full context it needs; it can't see this chat). Use this when a specialist clearly fits, e.g. Reviewer to check finished work, Data Analyst for spreadsheets, Coder for programming. Then use its answer to reply to the user.`;

export function buildSystemPrompt(settings, { docNames, memoryBlock = '', agent = null, isHelper = false }) {
  const intro = agent?.instructions?.trim()
    ? `${agent.instructions.trim()}\nYou run fully offline on the user's own computer as part of Kenzo. Use Markdown, and fenced code blocks for code.`
    : settings.systemPrompt?.trim() || BASE_PROMPT;
  const parts = [intro];
  if (isHelper) parts.push('Another agent asked you to do the task below. Complete it fully with your tools, then reply with the result only: concise, factual and self-contained.');
  parts.push(`Today is ${new Date().toDateString()}. Operating system: ${os.type()} ${os.release()}.`);
  const mode = modeOf(settings);
  if (mode === 'chat') {
    parts.push(CHAT_RULES);
  } else if (settings.workspace) {
    parts.push(`Workspace folder: ${settings.workspace}`);
    parts.push(AGENT_RULES);
    parts.push(mode === 'plan' ? PLAN_RULES : BUILD_RULES);
  } else {
    parts.push('No workspace folder is set, so file and command tools are unavailable. If the user asks you to work on files, tell them to choose a workspace folder (📁 in the top bar).');
    if (mode === 'plan') parts.push(PLAN_RULES);
  }
  if (docNames.length) {
    parts.push(`The user has imported these documents: ${docNames.slice(0, 40).join(', ')}. Use search_documents to answer questions about them and cite the document name.`);
  }
  if (settings.memoryEnabled && !isHelper) {
    parts.push(MEMORY_RULES);
    if (memoryBlock) parts.push(memoryBlock);
  }
  if (!isHelper && mode !== 'chat' && (!agent || agentAllows(agent, 'ask_agent'))) {
    const others = listAgents().filter((a) => a.id !== (agent?.id || 'kenzo') && a.id !== 'kenzo');
    parts.push(`${TEAM_RULES}\nAvailable specialists:\n${others.map((a) => `- ${a.name}: ${a.description}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

// Automatic retrieval: small models don't reliably decide to search, so attach
// the best-matching passages to the user's message when they look relevant.
const MIN_RELEVANCE = 0.5;
export async function withDocumentContext(text, rag) {
  if (!rag.hasDocuments()) return text;
  let hits;
  try { hits = (await rag.search(text, 4)).filter((h) => h.score >= MIN_RELEVANCE); } catch { return text; }
  if (!hits.length) return text;
  const passages = hits.map((h, i) => `[${i + 1}] ${h.docName}:\n${h.text}`).join('\n\n');
  return `Possibly relevant passages from my documents (cite the document name if you use them):\n\n${passages}\n\n---\n\n${text}`;
}

// Same idea for past chats: attach strong keyword matches from other threads.
// Explicit "remember/forget" requests also get a nudge, because small models
// otherwise sometimes just *say* they forgot without calling the tool.
const FORGET_RE = /\b(forget|don'?t remember|stop remembering|remove (that|it) from (your )?memory|no longer true)\b/i;
const REMEMBER_RE = /\b(remember (that|this|my|i)|keep in mind|note that|don'?t forget)\b/i;

export function withConversationRecall(text, memory, threadId) {
  const block = memory?.recallBlock(text, threadId);
  let out = block ? `${block}\n\n---\n\n${text}` : text;
  if (FORGET_RE.test(text) && !/don'?t forget/i.test(text)) out += '\n\n(Kenzo note: to forget, you must call the forget tool now.)';
  else if (REMEMBER_RE.test(text)) out += '\n\n(Kenzo note: to remember this, you must call the remember tool now.)';
  return out;
}

function summarizeArgs(name, args) {
  if (name === 'remember') return [].concat(args.facts || []).join(' · ');
  if (name === 'forget') return args.memory;
  if (name === 'run_command') return args.command;
  if (name === 'write_file') return `${args.path} (${(args.content || '').length} chars)`;
  if (name === 'edit_file') return args.path;
  if (name === 'move_file') return `${args.from} → ${args.to}`;
  if (name === 'run_code') return `${args.language} (${(args.code || '').split('\n').length} lines)`;
  if (name === 'calculator') return args.expression;
  if (name === 'ask_agent') return `${args.agent}: ${String(args.task).slice(0, 120)}`;
  if (args.path !== undefined && Object.keys(args).length <= 2) return args.path;
  return JSON.stringify(args);
}

// Last complete fenced code block in the text the model has streamed this turn.
export function findLastCodeBlock(text) {
  return findLastCodeBlockInfo(text)?.code ?? null;
}

export function findLastCodeBlockInfo(text) {
  const blocks = [...text.matchAll(/```([^\n`]*)\n([\s\S]*?)```/g)];
  if (!blocks.length) return null;
  const m = blocks.at(-1);
  return { code: m[2], lang: m[1].trim().toLowerCase(), end: m.index + m[0].length };
}

/**
 * Build the function set for one turn.
 * ctx: { settings, agent, isHelper, rag, memory, threadId, signal, streamedText(),
 *        emit(event), requestApproval(info) => Promise<boolean>, runHelper(opts) => Promise<string> }
 */
export function buildFunctions(ctx) {
  const { settings, rag, emit, requestApproval, signal, streamedText, memory, threadId, agent, isHelper, runHelper, maxToolChars = 16000 } = ctx;
  // Each code block can feed one write_file/run_code call. Without this, a
  // model that forgets to write a new block would silently reuse the previous
  // one (e.g. save a JSON snippet as the program).
  let consumedUpTo = 0;
  const freshBlock = () => {
    const info = findLastCodeBlockInfo(streamedText?.() ?? '');
    return info && info.end > consumedUpTo ? info : null;
  };
  const lastCodeBlock = () => freshBlock()?.code ?? null;
  const lastCodeLang = () => freshBlock()?.lang ?? '';
  const available = Object.entries(TOOLS).filter(([name, tool]) => {
    if (agent && !agentAllows(agent, name)) return false;
    const mode = modeOf(settings);
    if (mode !== 'build' && (tool.access === 'write' || tool.access === 'exec')) return false;
    if (mode === 'chat' && name !== 'calculator' && tool.access !== 'memory' && name !== 'search_past_chats' && name !== 'search_documents') return false;
    if (name === 'search_documents') return rag.hasDocuments();
    if (tool.access === 'plan') return !isHelper;
    if (tool.access === 'memory' || name === 'search_past_chats') return Boolean(settings.memoryEnabled && memory && !isHelper);
    if (NO_WORKSPACE_TOOLS.has(name)) return true;
    return Boolean(settings.workspace);
  });

  let seq = 0;
  const functions = {};
  for (const [name, tool] of available) {
    functions[name] = defineChatSessionFunction({
      description: tool.description,
      params: tool.params,
      async handler(rawArgs) {
        const id = `${Date.now().toString(36)}-${++seq}`;
        let args = rawArgs;
        try {
          if (tool.prepare) {
            const block = freshBlock();
            args = tool.prepare(rawArgs, { lastCodeBlock, lastCodeLang });
            if (block) consumedUpTo = block.end;
          }
        } catch (err) {
          emit({ type: 'tool', id, name, access: tool.access, summary: summarizeArgs(name, rawArgs), args: rawArgs });
          emit({ type: 'tool-result', id, ok: false, output: err.message });
          return `Error: ${err.message}`;
        }
        emit({ type: 'tool', id, name, access: tool.access, summary: summarizeArgs(name, args), args });

        if ((tool.access === 'write' || tool.access === 'exec') && !settings.autoApprove) {
          const ok = await requestApproval({ id, name, access: tool.access, summary: summarizeArgs(name, args), args });
          if (!ok) {
            emit({ type: 'tool-result', id, ok: false, output: 'Denied by user' });
            return 'The user denied this action. Do not retry it; ask what they would like instead.';
          }
        }

        try {
          const result = await tool.run(args, {
            workspace: settings.workspace,
            rag,
            signal,
            onPlan: (steps) => emit({ type: 'plan', steps }),
            mode: modeOf(settings),
            memory,
            threadId,
            onMemory: () => emit({ type: 'memory' }),
          });
          const full = typeof result === 'string' ? result : JSON.stringify(result, null, 1);
          emit({ type: 'tool-result', id, ok: true, output: full });
          // Keep any one tool result from crowding out the rest of the context.
          return full.length > maxToolChars
            ? `${full.slice(0, maxToolChars)}
…[cut: ${full.length - maxToolChars} more characters. Read a specific part (e.g. read_file with startLine) if you need it.]`
            : full;
        } catch (err) {
          const message = err?.message || String(err);
          emit({ type: 'tool-result', id, ok: false, output: message });
          return `Error: ${message}`;
        }
      },
    });
  }

  // Delegation: run a specialist on its own context sequence, then hand its
  // answer back as this tool's result. Helpers can't delegate further.
  if (!isHelper && runHelper && modeOf(settings) !== 'chat' && (!agent || agentAllows(agent, 'ask_agent'))) {
    const helpers = listAgents().filter((a) => a.id !== (agent?.id || 'kenzo') && a.id !== 'kenzo');
    if (helpers.length) {
      functions.ask_agent = defineChatSessionFunction({
        description: 'Give a self-contained subtask to a specialist agent and get its result back. Put every detail it needs in "task".',
        params: { type: 'object', properties: { agent: { enum: helpers.map((a) => a.name) }, task: { type: 'string' } } },
        async handler(args) {
          const id = `${Date.now().toString(36)}-${++seq}`;
          const helper = findAgentByName(args.agent);
          emit({ type: 'tool', id, name: 'ask_agent', access: 'agent', summary: summarizeArgs('ask_agent', args), args, agentIcon: helper?.icon });
          if (!helper) {
            emit({ type: 'tool-result', id, ok: false, output: `Unknown agent ${args.agent}` });
            return `Error: unknown agent ${args.agent}`;
          }
          let helperText = '';
          const sub = (e) => emit({ ...e, parent: id });
          try {
            const answer = await runHelper({
              systemPrompt: buildSystemPrompt(settings, { docNames: [], agent: helper, isHelper: true }),
              text: args.task,
              temperature: helper.temperature ?? settings.temperature,
              functions: buildFunctions({ ...ctx, agent: helper, isHelper: true, emit: sub, streamedText: () => helperText }),
              onText: (d) => { helperText += d; sub({ type: 'helper-text', delta: d }); },
              signal,
            });
            const output = (answer || helperText).trim() || '(the agent returned no answer)';
            emit({ type: 'tool-result', id, ok: true, output });
            return `${helper.name} replied:\n${output.slice(0, MAX_HELPER_OUTPUT)}`;
          } catch (err) {
            emit({ type: 'tool-result', id, ok: false, output: err.message });
            return `Error: ${helper.name} failed: ${err.message}`;
          }
        },
      });
    }
  }
  return functions;
}
