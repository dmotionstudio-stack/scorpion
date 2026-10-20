// Recent activity for the home screen: chats, what the agent did in them
// (files written, apps opened, commands run…), scheduled runs, check-ins,
// memories learned while dreaming, and library scans. Built from what
// Scorpion already saves; nothing extra is recorded.

// Tool calls worth showing: they changed something or did something visible.
const ACTIONS = {
  write_file: (a) => `Saved ${a.path}`,
  edit_file: (a) => `Edited ${a.path}`,
  move_file: (a) => `Moved ${a.from} → ${a.to}`,
  copy_path: (a) => `Copied ${a.from} → ${a.to}`,
  recycle_path: (a) => `Moved ${a.path} to the Recycle Bin`,
  run_command: (a) => `Ran ${a.command}`,
  run_code: (a) => `Ran a ${a.language || ''} program`.replace('  ', ' '),
  open_app: (a) => `Opened ${a.name}`,
  close_app: (a) => `Closed ${a.window}`,
  system_control: (a) => String(a.action || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
  save_skill: (a) => `Saved the skill ${a.name}`,
  remember: (a) => `Remembered ${[].concat(a.facts || []).join('; ')}`,
  standing_intent: (a) => (a.action === 'add' || !a.action ? `Will remind you when "${a.when}" comes up` : null),
  browser_open: (a) => `Opened ${a.url} in its browser`,
};

const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

function chatKind(thread) {
  if (/^Phone: /.test(thread.title)) return 'phone';
  if (/^Scheduled: /.test(thread.title)) return 'schedule';
  if (thread.title === 'Check-ins') return 'checkin';
  return 'chat';
}

/**
 * threads: [{ id, title, updatedAt }] newest first; getThread(id) → full thread.
 * schedules, dreams ({ diary }), heartbeat ({ lastRun, lastResult }), library (status).
 */
export function recentActivity({ threads = [], getThread = () => null, schedules = [], dreams = null, heartbeat = null, library = null, limit = 30, perThread = 3 } = {}) {
  const out = [];
  for (const t of threads.slice(0, 15)) {
    const full = getThread(t.id);
    if (!full) continue;
    const msgs = full.messages || [];
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
    const kind = chatKind(full);
    if (kind !== 'schedule' && kind !== 'checkin') {
      out.push({ at: t.updatedAt || full.updatedAt || 0, kind, title: full.title, detail: lastUser ? clip(lastUser.text, 90) : '', threadId: full.id, workspace: full.workspace || null });
    }
    let shown = 0;
    for (const m of [...msgs].reverse()) {
      if (m.role !== 'assistant' || shown >= perThread) continue;
      for (const b of [...(m.blocks || [])].reverse()) {
        if (shown >= perThread) break;
        if (b.type !== 'tool' || b.status !== 'ok' || !ACTIONS[b.name]) continue;
        const title = ACTIONS[b.name](b.args || {});
        if (!title) continue;
        out.push({ at: m.createdAt || full.updatedAt || 0, kind: 'action', title: clip(title, 110), detail: `in “${clip(full.title, 50)}”`, threadId: full.id });
        shown++;
      }
    }
  }
  for (const s of schedules) {
    if (!s.lastRunAt) continue;
    const failed = String(s.lastStatus || '').startsWith('error');
    out.push({ at: s.lastRunAt, kind: 'schedule', title: `Scheduled: ${s.name}`, detail: failed ? clip(s.lastStatus, 90) : 'ran', threadId: s.threadId || null, error: failed });
  }
  if (heartbeat?.lastRun) {
    out.push({ at: heartbeat.lastRun, kind: 'checkin', title: 'Check-in', detail: { ok: 'all clear', alert: 'left you a note', error: 'failed' }[heartbeat.lastResult] || '', error: heartbeat.lastResult === 'error' });
  }
  for (const d of (dreams?.diary || []).slice(0, 5)) {
    if (!d.added?.length) continue;
    out.push({ at: d.at, kind: 'memory', title: `Learned ${d.added.length} thing${d.added.length === 1 ? '' : 's'} about you`, detail: clip(d.added.map((a) => a.text).join(' · '), 110) });
  }
  if (library?.scan?.lastRun) {
    out.push({ at: library.scan.lastRun, kind: 'library', title: 'Library updated', detail: `${library.counts?.total ?? 0} photos, videos and songs` });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, limit);
}
