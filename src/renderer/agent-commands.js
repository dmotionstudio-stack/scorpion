// Agents are run from the chat box with a slash: "/coder fix the failing test"
// makes Coder the chat's agent and sends the rest as the message; "/coder" on
// its own just switches. Pure functions, so they can be tested without the UI.

const slug = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// What you type after the slash. Built-in agents use their id (/coder); your own
// agents have ids like custom-ab12, so they use their name (/my-reviewer).
export function commandOf(agent) {
  return agent.id.startsWith('custom-') ? slug(agent.name) : agent.id;
}

const names = (agent) => [commandOf(agent), agent.id.toLowerCase(), slug(agent.name)];

// "/coder fix this" -> { agent, rest: 'fix this' }. null when the text isn't a
// command for a known agent, so "/etc/hosts" or "/unknown" is sent as ordinary text.
export function parseAgentCommand(text, agents) {
  const m = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(String(text || '').trim());
  if (!m) return null;
  const word = m[1].toLowerCase();
  const agent = agents.find((a) => names(a).includes(word));
  return agent ? { agent, rest: (m[2] || '').trim() } : null;
}

// The agents to offer while a command is being typed ("/co" -> Coder). null when
// the box isn't holding a half-typed command, so the menu stays closed.
export function suggestAgents(text, agents) {
  const m = /^\/([^\s/]*)$/.exec(String(text || ''));
  if (!m) return null;
  const prefix = m[1].toLowerCase();
  return agents.filter((a) => !prefix || names(a).some((n) => n.startsWith(prefix)) || a.name.toLowerCase().startsWith(prefix));
}
