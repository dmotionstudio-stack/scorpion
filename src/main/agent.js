// The agent: turns the tool table into node-llama-cpp functions, applies the
// permission gate, and streams every step to the UI. node-llama-cpp keeps calling
// functions until the model answers in plain text, which is the agent loop.
import os from 'node:os';
import { defineChatSessionFunction } from 'node-llama-cpp';
import { TOOLS } from './tools.js';

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

export function buildSystemPrompt(settings, { docNames, memoryBlock = '' }) {
  const parts = [settings.systemPrompt?.trim() || BASE_PROMPT];
  parts.push(`Today is ${new Date().toDateString()}. Operating system: ${os.type()} ${os.release()}.`);
  if (settings.workspace) {
    parts.push(`Workspace folder: ${settings.workspace}`);
    parts.push(AGENT_RULES);
    if (settings.planMode) {
      parts.push('PLAN MODE is on (read only). You cannot edit files or run commands. Investigate with read tools, then call update_plan with a complete plan and ask the user to turn plan mode off to execute it.');
    }
  } else {
    parts.push('No workspace folder is set, so file and command tools are unavailable. If the user asks you to work on files, tell them to choose a workspace folder.');
  }
  if (docNames.length) {
    parts.push(`The user has imported these documents: ${docNames.slice(0, 40).join(', ')}. Use search_documents to answer questions about them and cite the document name.`);
  }
  if (settings.memoryEnabled) {
    parts.push(MEMORY_RULES);
    if (memoryBlock) parts.push(memoryBlock);
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
  return JSON.stringify(args);
}

/**
 * Build the function set for one turn.
 * ctx: { settings, rag, signal, emit(event), requestApproval(info) => Promise<boolean> }
 */
// Last complete fenced code block in the text the model has streamed this turn.
export function findLastCodeBlock(text) {
  const blocks = [...text.matchAll(/```[^\n`]*\n([\s\S]*?)```/g)];
  return blocks.length ? blocks.at(-1)[1] : null;
}

export function buildFunctions(ctx) {
  const { settings, rag, emit, requestApproval, signal, streamedText, memory, threadId } = ctx;
  const lastCodeBlock = () => findLastCodeBlock(streamedText?.() ?? '');
  const available = Object.entries(TOOLS).filter(([name, tool]) => {
    if (name === 'search_documents') return rag.hasDocuments();
    if (tool.access === 'plan') return true;
    if (tool.access === 'memory' || name === 'search_past_chats') return Boolean(settings.memoryEnabled && memory);
    if (!settings.workspace) return false;
    if (settings.planMode && (tool.access === 'write' || tool.access === 'exec')) return false;
    return true;
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
          if (tool.prepare) args = tool.prepare(rawArgs, { lastCodeBlock });
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
            memory,
            threadId,
            onMemory: () => emit({ type: 'memory' }),
          });
          const output = typeof result === 'string' ? result : JSON.stringify(result, null, 1);
          emit({ type: 'tool-result', id, ok: true, output });
          return output;
        } catch (err) {
          const message = err?.message || String(err);
          emit({ type: 'tool-result', id, ok: false, output: message });
          return `Error: ${message}`;
        }
      },
    });
  }
  return functions;
}
