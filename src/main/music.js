// Scorpion's own music player: what it plays and how a request is understood. The songs are files on this computer: the
// Library's music and the Music folder. The player itself lives in the window (music-player.js: an audio element, the queue, a
// small player on the screen, in the orb too); this finds the songs for "play some jazz", "play Bob Marley", "next song" and
// sends the window what to do. Nothing is streamed, nothing leaves the computer.
import fs from 'node:fs';
import path from 'node:path';

export const AUDIO = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.flac', '.wav']);
export const ACTIONS = ['play', 'pause', 'resume', 'next', 'previous', 'stop', 'shuffle', 'repeat', 'volume', 'now_playing', 'list'];
const MAX_QUEUE = 300;

// "03 - Redemption_Song.mp3" → "Redemption Song"
export function titleOf(file) {
  // The last part of the path, whichever way its separators lean (a Windows path read on a Mac, or the other way round).
  const base = String(file).split(/[\\/]/).pop();
  return base.replace(/\.[^.]+$/, '').replace(/^\s*\d{1,3}\s*[-._)]\s*/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || base;
}

const clean = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
// Words that say "play" and not what to play.
const FILLER = new Set(['play', 'some', 'a', 'an', 'the', 'music', 'song', 'songs', 'track', 'tracks', 'by', 'from', 'me', 'something', 'please', 'my', 'of', 'put', 'on', 'for', 'to', 'listen', 'hear', 'album', 'artist', 'playlist']);

// The words that name the music in a request ("play some Bob Marley songs" → ["bob", "marley"]).
export const queryWords = (query) => clean(query).split(' ').filter((w) => w && !FILLER.has(w));

// Every song under a folder (not into folders that start with a dot, and not too deep or too many).
export function scanFolder(dir, { depth = 6, limit = 8000 } = {}) {
  const out = [];
  const walk = (d, level) => {
    if (out.length >= limit || level > depth) return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= limit) return;
      if (e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, level + 1);
      else if (e.isFile() && AUDIO.has(path.extname(e.name).toLowerCase())) out.push(p);
    }
  };
  walk(dir, 0);
  return out;
}

// How well a song fits the words: every word has to appear in its name, its folders (artist, album) or its tags (genre).
// 0: no fit. Names count most, then folders, then tags.
export function scoreTrack(words, file, { tags = [], root = '' } = {}) {
  if (!words.length) return 1;
  const name = clean(titleOf(file));
  const folders = clean(path.relative(root || path.dirname(file), path.dirname(file)));
  const tagText = clean(tags.join(' '));
  let score = 0;
  for (const w of words) {
    const inName = name.split(' ').some((x) => x === w) ? 3 : name.includes(w) ? 2 : 0;
    const inFolders = folders.includes(w) ? 1.5 : 0;
    const inTags = tagText.includes(w) ? 1 : 0;
    const best = Math.max(inName, inFolders, inTags);
    if (!best) return 0;
    score += best;
  }
  return score;
}

// sources: [{ root, files: [path], tags: Map(path → [labels]) }]. Returns [{ path, title }], best first; without words, a shuffled mix.
export function findTracks(query, sources, { limit = MAX_QUEUE, random = Math.random } = {}) {
  const words = queryWords(query);
  const seen = new Set();
  const scored = [];
  for (const { root, files, tags } of sources) {
    for (const file of files) {
      const key = path.resolve(file).toLowerCase();
      if (seen.has(key) || !AUDIO.has(path.extname(file).toLowerCase())) continue;
      const s = scoreTrack(words, file, { tags: tags?.get?.(file) || [], root });
      if (s > 0) { seen.add(key); scored.push({ path: file, title: titleOf(file), s }); }
    }
  }
  if (!words.length) {
    for (let i = scored.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [scored[i], scored[j]] = [scored[j], scored[i]]; }
  } else scored.sort((a, b) => b.s - a.s || a.title.localeCompare(b.title));
  return scored.slice(0, limit).map(({ path: p, title }) => ({ path: p, title }));
}

// One line for the person (or the model) about the player.
export function describeState(s) {
  if (!s || !s.title) return 'Nothing is playing.';
  const where = s.total > 1 ? ` (${s.index + 1} of ${s.total})` : '';
  return `${s.playing ? 'Playing' : 'Paused'}: ${s.title}${where}. Volume ${Math.round((s.volume ?? 1) * 100)}%${s.shuffle ? ', shuffle on' : ''}${s.repeat && s.repeat !== 'off' ? `, repeat ${s.repeat}` : ''}.`;
}

// What a request does, and the text for the answer. deps: { sources() → the folders and the library (async), send(cmd) to the window,
// state() the window's last report, authorize(paths) the songs the window may be given a link to }.
export function createMusic({ sources, send, state, authorize = () => {}, wait = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  return {
    async run({ action = 'play', query = '', amount } = {}) {
      if (!ACTIONS.includes(action)) throw new Error(`Unknown music action. Use one of: ${ACTIONS.join(', ')}`);
      if (action === 'now_playing') return describeState(state());
      if (action === 'play' || action === 'list') {
        const found = findTracks(query, await sources());
        if (!found.length) {
          const words = queryWords(query);
          return words.length
            ? `Found no music matching "${words.join(' ')}". Scorpion plays the music in the Library and in the Music folder.`
            : 'Found no music. Put songs in the Music folder, or add a folder in Library → Settings.';
        }
        if (action === 'list') return `${found.length} song${found.length === 1 ? '' : 's'}:\n${found.slice(0, 30).map((t) => `- ${t.title}`).join('\n')}${found.length > 30 ? `\n…and ${found.length - 30} more` : ''}`;
        authorize(found.map((t) => t.path));
        send({ action: 'play', tracks: found, shuffle: !queryWords(query).length });
        return `Playing ${found[0].title}${found.length > 1 ? `, and ${found.length - 1} more after it` : ''}.`;
      }
      if (action === 'volume') {
        const level = Math.max(0, Math.min(100, Math.round(Number(amount))));
        if (!Number.isFinite(level)) throw new Error('Give a volume from 0 to 100 as amount.');
        send({ action: 'volume', amount: level / 100 });
        return `Music volume ${level}%.`;
      }
      if (action === 'shuffle' || action === 'repeat') {
        send({ action, value: query });
        await wait(150);
        return describeState(state());
      }
      if (!state()?.title && action !== 'stop') return 'Nothing is playing. Ask for a song, an artist or a kind of music.';
      send({ action });
      await wait(250);
      return action === 'stop' ? 'Stopped the music.' : describeState(state());
    },
  };
}
