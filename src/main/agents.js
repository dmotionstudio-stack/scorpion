// Agent profiles: a name, instructions and the tools that agent may use.
// Built-ins ship with Scorpion; users can create their own (stored in agents.json).
import path from 'node:path';
import { paths, writeJson, readJson, newId } from './store.js';

const FILE_READ = ['list_files', 'read_file', 'search_files', 'read_document'];
const FILE_WRITE = ['write_file', 'edit_file', 'move_file'];
const MEMORY = ['remember', 'forget', 'search_past_chats'];

export const BUILTIN_AGENTS = [
  {
    id: 'scorpion',
    name: 'Scorpion',
    icon: '✨',
    description: 'General assistant. Can use every tool and hand work to specialists.',
    instructions: '',
    tools: ['*'],
  },
  {
    id: 'coder',
    name: 'Coder',
    icon: '💻',
    description: 'Writes, edits, runs and debugs code in your workspace.',
    instructions: 'You are Coder, a careful senior software engineer. Read the relevant code before changing it, keep changes small and focused, match the existing style, and verify your work by running it (run_command or run_code) whenever possible. Explain what you changed and why in a few sentences.',
    tools: [...FILE_READ, ...FILE_WRITE, 'run_command', 'run_code', 'calculator', 'update_plan', 'ask_agent', ...MEMORY],
    temperature: 0.3,
  },
  {
    id: 'researcher',
    name: 'Researcher',
    icon: '🔎',
    description: 'Answers questions from your documents, files and past chats, with sources. Read-only.',
    instructions: 'You are Researcher. Answer only from evidence you find with your tools: search the user\'s documents, read files, and search past chats. Quote or cite the source (document or file name) for every claim. If the evidence is missing or unclear, say so plainly instead of guessing.',
    tools: ['search_documents', ...FILE_READ, 'calculator', 'update_plan', ...MEMORY],
    temperature: 0.2,
  },
  {
    id: 'writer',
    name: 'Writer',
    icon: '✍️',
    description: 'Drafts and edits emails, reports, posts and stories; can save them as files.',
    instructions: 'You are Writer, a skilled editor. Write clearly and concretely, match the tone the user asks for (default: friendly and professional), prefer short sentences, and avoid filler. When asked to improve text, keep the author\'s meaning and voice. Save longer pieces to the workspace when the user wants a file.',
    tools: ['read_file', 'read_document', 'list_files', 'search_documents', 'write_file', 'edit_file', 'update_plan', ...MEMORY],
    temperature: 0.8,
  },
  {
    id: 'analyst',
    name: 'Data Analyst',
    icon: '📊',
    description: 'Reads spreadsheets and CSVs, calculates exactly, and finds trends.',
    instructions: 'You are Data Analyst. Inspect the data with read_spreadsheet before drawing conclusions. Never do arithmetic in your head: use calculator, or run_code (JavaScript) for anything over many rows. Report key numbers in a small Markdown table and state your assumptions.',
    tools: ['read_spreadsheet', 'read_file', 'list_files', 'read_document', 'run_code', 'calculator', 'write_file', 'update_plan', ...MEMORY],
    temperature: 0.2,
  },
  {
    id: 'organizer',
    name: 'File Organizer',
    icon: '🗂️',
    description: 'Tidies folders: sorts, renames and groups files safely.',
    instructions: 'You are File Organizer. First list the files and propose a clear folder structure with update_plan. Only move or rename with move_file (never delete anything). Never overwrite a file. When done, list what moved where.',
    tools: ['list_files', 'read_file', 'read_document', 'move_file', 'update_plan', ...MEMORY],
    temperature: 0.3,
  },
  {
    id: 'reviewer',
    name: 'Reviewer',
    icon: '🧐',
    description: 'Reviews code or writing and lists concrete problems and fixes. Read-only.',
    instructions: 'You are Reviewer. Examine the work critically. Report concrete problems ranked by importance (bugs and errors first, then clarity, then style), each with where it is and a suggested fix. If it is good, say so briefly. Do not rewrite everything.',
    tools: [...FILE_READ, 'run_code', 'calculator'],
    temperature: 0.2,
  },
];

const file = () => path.join(paths.data, 'agents.json');

function readCustom() {
  return readJson(file(), []);
}

export function listAgents() {
  return [...BUILTIN_AGENTS.map((a) => ({ ...a, builtin: true })), ...readCustom()];
}

export function getAgent(id) {
  return listAgents().find((a) => a.id === id) || { ...BUILTIN_AGENTS[0], builtin: true };
}

export function findAgentByName(name) {
  const n = String(name || '').trim().toLowerCase().replace(/^the\s+/, '');
  return listAgents().find((a) => a.id === n || a.name.toLowerCase() === n || a.name.toLowerCase().startsWith(n));
}

function clean(input) {
  const name = String(input.name || '').trim().slice(0, 40);
  if (!name) throw new Error('Give the agent a name');
  return {
    name,
    icon: String(input.icon || '🤖').slice(0, 4),
    description: String(input.description || '').slice(0, 200),
    instructions: String(input.instructions || '').slice(0, 4000),
    tools: Array.isArray(input.tools) ? input.tools.map(String) : ['*'],
    temperature: Number.isFinite(+input.temperature) ? Math.min(Math.max(+input.temperature, 0), 1.5) : undefined,
  };
}

export function saveAgent(input) {
  const list = readCustom();
  if (BUILTIN_AGENTS.some((a) => a.id === input.id)) throw new Error('Built-in agents cannot be changed; duplicate it instead');
  const existing = input.id && list.find((a) => a.id === input.id);
  if (existing) Object.assign(existing, clean(input));
  else list.push({ id: `custom-${newId()}`, ...clean(input) });
  writeJson(file(), list);
  return existing || list.at(-1);
}

export function deleteAgent(id) {
  writeJson(file(), readCustom().filter((a) => a.id !== id));
}

export function agentAllows(agent, toolName) {
  return agent.tools.includes('*') || agent.tools.includes(toolName);
}
