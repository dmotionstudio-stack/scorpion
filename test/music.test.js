import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { titleOf, queryWords, scanFolder, scoreTrack, findTracks, describeState, createMusic } from '../src/main/music.js';
import { Queue } from '../src/renderer/music-player.js';
import { parseMusic } from '../src/renderer/orb-commands.js';

test('a song is named by its file, without track numbers and underscores', () => {
  assert.equal(titleOf('/m/Bob Marley/03 - Redemption_Song.mp3'), 'Redemption Song');
  assert.equal(titleOf('C:\\Music\\07. Buffalo Soldier.flac'), 'Buffalo Soldier');
  assert.equal(titleOf('/m/Imagine.m4a'), 'Imagine');
});

test('only the names in a request count, not the words that say "play"', () => {
  assert.deepEqual(queryWords('play some Bob Marley songs please'), ['bob', 'marley']);
  assert.deepEqual(queryWords('the song Redemption Song'), ['redemption']);
  assert.deepEqual(queryWords('play some music'), []);
  assert.deepEqual(queryWords('Beyoncé'), ['beyonce']);
});

test('songs are found by name, artist folder or genre tag; every word has to fit', () => {
  const root = '/m';
  const files = ['/m/Bob Marley/Exodus/01 - Jamming.mp3', '/m/Bob Marley/Exodus/02 - One Love.mp3', '/m/Miles Davis/So What.flac', '/m/notes.txt'];
  const tags = new Map([['/m/Miles Davis/So What.flac', ['Jazz', 'Instrumental']]]);
  const sources = [{ root, files, tags }];
  assert.deepEqual(findTracks('bob marley', sources).map((t) => t.title), ['Jamming', 'One Love']);
  assert.deepEqual(findTracks('one love', sources).map((t) => t.title), ['One Love']);
  assert.deepEqual(findTracks('play some jazz', sources).map((t) => t.title), ['So What']);
  assert.deepEqual(findTracks('exodus', sources).map((t) => t.title), ['Jamming', 'One Love']);
  assert.deepEqual(findTracks('bob marley jazz', sources), []); // jazz is not Bob Marley
  assert.equal(findTracks('', sources).length, 3); // everything, shuffled; the .txt is not a song
  assert.equal(scoreTrack(['zzz'], '/m/a.mp3', { root }), 0);
  // The same file twice (the library and the folder) is one song.
  assert.equal(findTracks('', [{ root, files }, { root: '', files }]).length, 3);
});

test('a folder is scanned for songs only, not into hidden folders', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-music-'));
  try {
    fs.mkdirSync(path.join(dir, 'Album'));
    fs.mkdirSync(path.join(dir, '.hidden'));
    fs.writeFileSync(path.join(dir, 'a.mp3'), '');
    fs.writeFileSync(path.join(dir, 'Album', 'b.OGG'), '');
    fs.writeFileSync(path.join(dir, 'Album', 'cover.jpg'), '');
    fs.writeFileSync(path.join(dir, '.hidden', 'c.mp3'), '');
    assert.deepEqual(scanFolder(dir).map((p) => path.basename(p)).sort(), ['a.mp3', 'b.OGG']);
    assert.deepEqual(scanFolder(path.join(dir, 'missing')), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the player is told what to do, and answers in words', async () => {
  const sent = [];
  let state = null;
  const files = ['/m/Jazz/So What.flac', '/m/Reggae/One Love.mp3'];
  const authorized = [];
  const m = createMusic({ sources: async () => [{ root: '/m', files }], send: (c) => sent.push(c), state: () => state, authorize: (p) => authorized.push(...p), wait: async () => {} });
  assert.match(await m.run({ action: 'play', query: 'reggae' }), /Playing One Love/);
  assert.equal(sent[0].action, 'play');
  assert.deepEqual(sent[0].tracks.map((t) => t.title), ['One Love']);
  assert.deepEqual(authorized, ['/m/Reggae/One Love.mp3']);
  assert.match(await m.run({ action: 'play', query: '' }), /Playing .*and 1 more/);
  assert.equal(sent[1].shuffle, true);
  assert.match(await m.run({ action: 'play', query: 'polka' }), /Found no music matching "polka"/);
  assert.match(await m.run({ action: 'list', query: 'jazz' }), /1 song:\n- So What/);
  assert.match(await m.run({ action: 'next' }), /Nothing is playing/);
  state = { playing: true, title: 'One Love', index: 0, total: 2, volume: 0.8, shuffle: true, repeat: 'all' };
  assert.equal(await m.run({ action: 'now_playing' }), 'Playing: One Love (1 of 2). Volume 80%, shuffle on, repeat all.');
  assert.match(await m.run({ action: 'pause' }), /Playing: One Love/);
  assert.equal(sent.at(-1).action, 'pause');
  assert.equal(await m.run({ action: 'volume', amount: 40 }), 'Music volume 40%.');
  assert.equal(sent.at(-1).amount, 0.4);
  assert.equal(await m.run({ action: 'stop' }), 'Stopped the music.');
  await assert.rejects(() => m.run({ action: 'dance' }), /Unknown music action/);
  assert.equal(describeState(null), 'Nothing is playing.');
});

test('the queue: in order, shuffled once through, repeat all and one', () => {
  const tracks = ['a', 'b', 'c'].map((t) => ({ path: `/${t}`, title: t }));
  const q = new Queue(tracks);
  assert.equal(q.current.title, 'a');
  assert.equal(q.next('off').title, 'b');
  assert.equal(q.next('off').title, 'c');
  assert.equal(q.next('off'), null); // the end
  assert.equal(q.next('all').title, 'a'); // round again
  assert.equal(q.next('one').title, 'a'); // stays
  assert.equal(q.previous().title, 'c'); // from the first to the last
  const seen = new Set();
  const s = new Queue(tracks, { shuffle: true });
  seen.add(s.current.title);
  for (let i = 0; i < 2; i++) seen.add(s.next('off').title);
  assert.equal(seen.size, 3); // every song once
  assert.equal(s.next('off'), null);
  const keep = new Queue(tracks); keep.next(); keep.setShuffle(true);
  assert.equal(keep.current.title, 'b'); // shuffle starts at what is playing
  keep.setShuffle(false);
  assert.equal(keep.current.title, 'b');
  assert.equal(keep.next().title, 'c');
});

test('spoken music commands: play, pause, next, stop; and nothing else is taken for music', () => {
  const p = (t) => parseMusic(t);
  assert.deepEqual(p('play some music'), { action: 'play', query: '' });
  assert.deepEqual(p('Hey Scorpion, play Bob Marley'), { action: 'play', query: 'bob marley' });
  assert.deepEqual(p('play some jazz songs'), { action: 'play', query: 'some jazz songs' });
  assert.deepEqual(p('pause the music'), { action: 'pause' });
  assert.deepEqual(p('resume the music'), { action: 'resume' });
  assert.deepEqual(p('next song'), { action: 'next' });
  assert.deepEqual(p('skip this song'), { action: 'next' });
  assert.deepEqual(p('previous song'), { action: 'previous' });
  assert.deepEqual(p('stop the music'), { action: 'stop' });
  assert.deepEqual(p('what song is this'), { action: 'now_playing' });
  assert.deepEqual(p('turn shuffle off'), { action: 'shuffle', query: 'off' });
  assert.deepEqual(p('repeat all'), { action: 'repeat', query: 'all' });
  for (const no of ['stop', 'next', 'pause', 'play', 'play a game', 'play chess', 'play the video', 'what time is it', 'open music settings']) assert.equal(p(no), null, no);
  assert.equal(parseMusic('play some music', { lang: 'fr' }), null);
});
