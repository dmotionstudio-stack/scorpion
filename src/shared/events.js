// Folds one streamed agent event into an assistant message's blocks. Shared by
// the main process (what gets saved) and the UI (what gets drawn), so both
// always agree. Events from a helper agent carry `parent` (the ask_agent call's
// id) and are nested inside that tool block.
export function applyEvent(blocks, ev) {
  if (ev.parent) {
    const host = blocks.find((x) => x.type === 'tool' && x.id === ev.parent);
    if (!host) return;
    host.children ??= [];
    applyEvent(host.children, { ...ev, parent: undefined, type: ev.type === 'helper-text' ? 'text' : ev.type });
    return;
  }
  const last = blocks.at(-1);
  switch (ev.type) {
    case 'text':
    case 'thought':
      if (last?.type === ev.type) last.text += ev.delta;
      else blocks.push({ type: ev.type, text: ev.delta });
      break;
    case 'tool':
      blocks.push({ type: 'tool', id: ev.id, name: ev.name, access: ev.access, summary: ev.summary, args: ev.args, agentIcon: ev.agentIcon, status: 'running' });
      break;
    case 'tool-result': {
      const b = blocks.find((x) => x.type === 'tool' && x.id === ev.id);
      if (b) Object.assign(b, { status: ev.ok ? 'ok' : 'error', output: ev.output });
      break;
    }
    case 'plan': {
      const p = blocks.find((x) => x.type === 'plan');
      if (p) p.steps = ev.steps;
      else blocks.push({ type: 'plan', steps: ev.steps });
      break;
    }
    default:
  }
}

// Finds a tool block by id anywhere in the tree (helpers' tools are nested).
export function findTool(blocks, id) {
  for (const b of blocks || []) {
    if (b.type !== 'tool') continue;
    if (b.id === id) return b;
    const inner = findTool(b.children, id);
    if (inner) return inner;
  }
  return null;
}
