import fs from 'node:fs';
const f = 'src/main/memory.js';
let s = fs.readFileSync(f, 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 80)); s = s.replace(a, b); };
rep(`    for (const m of t.messages || []) {
      const text = messageText(m).trim();`, `    const msgs = t.messages || [];
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      const text = messageText(m).trim();`);
rep(`      docs.push({ threadId: t.id, title: t.title, role: m.role, text, len: tokens.length, tf, at: m.createdAt || t.updatedAt });`,
`      // Keep the reply to each question: "what did you suggest earlier?" matches
      // the question's words, but the answer is what the user actually wants.
      const reply = m.role === 'user' && msgs[i + 1]?.role === 'assistant' ? messageText(msgs[i + 1]).trim() : '';
      docs.push({ threadId: t.id, title: t.title, role: m.role, text, reply, len: tokens.length, tf, at: m.createdAt || t.updatedAt });`);
rep(`    .map(({ threadId, title, role, text, score, matched, coverage, at }) => ({ threadId, title, role, text: text.slice(0, 700), score, matched, coverage, at }));`,
    `    .map(({ threadId, title, role, text, reply, score, matched, coverage, at }) => ({ threadId, title, role, text: text.slice(0, 700), reply: (reply || '').slice(0, 900), score, matched, coverage, at }));`);
rep("    .map((h) => `[chat \"${h.title}\" · ${h.role === 'user' ? 'you said' : 'I said'}]\n${h.text}`)",
    "    .map((h) => `[chat \"${h.title}\" · ${h.role === 'user' ? 'you said' : 'I said'}]\n${h.text}${h.reply ? `\n[I replied]\n${h.reply}` : ''}`)");
fs.writeFileSync(f, s);
console.log('ok');
