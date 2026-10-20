// Chat with Scorpion from your phone, after OpenClaw's channels: through your
// own Telegram bot (made with @BotFather). Scorpion polls Telegram for new
// messages (it opens no port and needs no server). Only private chats are
// answered, and a stranger gets a pairing code that the owner must approve in
// Scorpion first. Approvals for file changes and commands arrive as Allow /
// Deny buttons on the phone.
import crypto from 'node:crypto';

const API = 'https://api.telegram.org';
const LIMIT = 4000; // Telegram allows 4096 characters per message

// Markdown → plain text that still reads well on a phone.
export function plainText(md) {
  return String(md || '')
    .replace(/```[a-z0-9_-]*\n?([\s\S]*?)```/gi, (_, code) => code.trimEnd())
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1 ($2)')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Splits long replies at paragraph, then line, then word boundaries.
export function chunkText(text, size = LIMIT) {
  const out = [];
  let rest = String(text || '');
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n\n', size);
    if (cut < size / 2) cut = rest.lastIndexOf('\n', size);
    if (cut < size / 2) cut = rest.lastIndexOf(' ', size);
    if (cut < size / 2) cut = size;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.trim()) out.push(rest);
  return out;
}

export const pairingCode = () => String(crypto.randomInt(100000, 1000000));

const nameOf = (from) => [from?.first_name, from?.last_name].filter(Boolean).join(' ') || (from?.username ? `@${from.username}` : 'Someone');

/**
 * hooks:
 *  isAllowed(chatId) → boolean
 *  onPairRequest({ chatId, name, username }) → code (existing or new)
 *  onMessage({ chatId, name, text }) → Promise<string>  (the reply)
 *  onVoice({ chatId, name, file: { bytes, name } }) → Promise<string>
 *  onCommand({ chatId, command }) → Promise<string|null>
 *  onStatus({ ok, error, bot })
 */
export class TelegramBot {
  constructor(token, hooks, { fetchImpl = fetch } = {}) {
    this.token = token;
    this.hooks = hooks;
    this.fetch = fetchImpl;
    this.offset = 0;
    this.running = false;
    this.abort = null;
    this.waiting = new Map(); // approval id -> { resolve, chatId, messageId }
    this.bot = null;
  }

  async call(method, body = {}, signal) {
    const res = await this.fetch(`${API}/bot${this.token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    const j = await res.json().catch(() => ({}));
    if (!j.ok) throw new Error(j.description || `Telegram ${method} failed (${res.status})`);
    return j.result;
  }

  async start() {
    this.bot = await this.call('getMe');
    this.running = true;
    this.hooks.onStatus?.({ ok: true, bot: this.bot });
    this.loop();
    return this.bot;
  }

  stop() {
    this.running = false;
    this.abort?.abort();
    for (const w of this.waiting.values()) w.resolve(false);
    this.waiting.clear();
  }

  async loop() {
    let failures = 0;
    while (this.running) {
      this.abort = new AbortController();
      try {
        const updates = await this.call('getUpdates', { offset: this.offset, timeout: 30, allowed_updates: ['message', 'callback_query'] }, this.abort.signal);
        failures = 0;
        for (const u of updates) {
          this.offset = u.update_id + 1;
          this.handle(u).catch((err) => this.hooks.onStatus?.({ ok: true, bot: this.bot, error: err.message }));
        }
      } catch (err) {
        if (!this.running) break;
        failures++;
        this.hooks.onStatus?.({ ok: false, bot: this.bot, error: err.message });
        await new Promise((r) => setTimeout(r, Math.min(60000, 2000 * failures)));
      }
    }
  }

  async handle(u) {
    if (u.callback_query) return this.handleButton(u.callback_query);
    const m = u.message;
    if (!m?.chat || m.chat.type !== 'private') return; // groups are not answered
    const chatId = m.chat.id;
    const name = nameOf(m.from);
    if (!this.hooks.isAllowed(chatId)) {
      const code = await this.hooks.onPairRequest({ chatId, name, username: m.from?.username });
      await this.send(chatId, `Hi ${name}! This Scorpion is private.\n\nTo talk to it, its owner must approve you in Scorpion → Settings → Connections → Phone, with this code: ${code}`);
      return;
    }
    const command = /^\/(\w+)/.exec(m.text || '')?.[1]?.toLowerCase();
    if (command && command !== 'ask') {
      const reply = await this.hooks.onCommand?.({ chatId, command });
      if (reply) await this.send(chatId, reply);
      return;
    }
    const typing = setInterval(() => this.call('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {}), 4500);
    this.call('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
    try {
      let reply;
      if (m.voice || m.audio) {
        const fileId = (m.voice || m.audio).file_id;
        const file = await this.call('getFile', { file_id: fileId });
        const res = await this.fetch(`${API}/file/bot${this.token}/${file.file_path}`);
        if (!res.ok) throw new Error('Could not download the voice message');
        reply = await this.hooks.onVoice({ chatId, name, file: { bytes: Buffer.from(await res.arrayBuffer()), name: file.file_path.split('/').pop() } });
      } else if (m.text) {
        reply = await this.hooks.onMessage({ chatId, name, text: m.text.replace(/^\/ask\s*/i, '') });
      } else {
        reply = 'I can read text and voice messages here. Photos and files: send them to Scorpion on your computer.';
      }
      await this.send(chatId, reply || '(no answer)');
    } finally {
      clearInterval(typing);
    }
  }

  async send(chatId, text) {
    for (const part of chunkText(plainText(text))) await this.call('sendMessage', { chat_id: chatId, text: part, link_preview_options: { is_disabled: true } });
  }

  // Asks on the phone; resolves true/false when a button is pressed.
  askApproval(chatId, question, detail, signal) {
    const id = crypto.randomBytes(6).toString('hex');
    return new Promise((resolve) => {
      const finish = (ok) => { this.waiting.delete(id); resolve(ok); };
      this.waiting.set(id, { resolve: finish, chatId });
      signal?.addEventListener('abort', () => finish(false), { once: true });
      this.call('sendMessage', {
        chat_id: chatId,
        text: `${question}\n\n${String(detail || '').slice(0, 3000)}`,
        reply_markup: { inline_keyboard: [[{ text: 'Allow', callback_data: `ok:${id}` }, { text: 'Deny', callback_data: `no:${id}` }]] },
      }).then((msg) => { const w = this.waiting.get(id); if (w) w.messageId = msg.message_id; }).catch(() => finish(false));
    });
  }

  async handleButton(q) {
    const [verdict, id] = String(q.data || '').split(':');
    const w = this.waiting.get(id);
    // Only the chat that was asked can answer.
    if (!w || w.chatId !== q.message?.chat?.id) {
      await this.call('answerCallbackQuery', { callback_query_id: q.id, text: 'This request has expired.' }).catch(() => {});
      return;
    }
    const ok = verdict === 'ok';
    w.resolve(ok);
    await this.call('answerCallbackQuery', { callback_query_id: q.id, text: ok ? 'Allowed' : 'Denied' }).catch(() => {});
    if (w.messageId) await this.call('editMessageReplyMarkup', { chat_id: w.chatId, message_id: w.messageId, reply_markup: { inline_keyboard: [] } }).catch(() => {});
  }
}
