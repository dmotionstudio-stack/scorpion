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

export function buildSystemPrompt(settings, { docNames }) {
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

function summarizeArgs(name, args) {
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
  const { settings, rag, emit, requestApproval, signal, streamedText } = ctx;
  const lastCodeBlock = () => findLastCodeBlock(streamedText?.() ?? '');
  const available = Object.entries(TOOLS).filter(([name, tool]) => {
    if (name === 'search_documents') return rag.hasDocuments();
    if (tool.access === 'plan') return true;
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
