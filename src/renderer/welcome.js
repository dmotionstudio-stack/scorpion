// The first start: the orb walks the person through setup out loud, one card
// at a time: easier to see, hear or type (accessibility), the internet (Wi-Fi, on Scorpion OS), the AI model, whether
// Scorpion talks back, and calling it by name (the floating orb). Every step can be
// answered by voice ("yes", "no", "next", "skip") or by clicking. Shown once
// (settings.welcomeDone); Settings can show it again.
//   ctx: { api, $, S, speaker, listen, toast, errText, installVoice }
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// What a spoken answer means.
export function spokenChoice(text) {
  const t = String(text || '').toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').trim();
  if (!t) return null;
  // The accessibility step's three switches.
  if (/\b(bigger|larger|big) (text|letters|writing)\b|\bbigger\b/.test(t)) return 'bigText';
  if (/\bscreen ?reader\b|\bread (it|the screen|aloud)\b/.test(t)) return 'screenReader';
  if (/\bkeyboard\b/.test(t)) return 'keyboard';
  if (/\b(skip|later|not now|maybe later)\b/.test(t)) return 'skip';
  if (/\b(no|nope|don ?t|do not|text only|quiet)\b/.test(t)) return 'no';
  if (/\b(yes|yeah|yep|sure|ok|okay|please|do it|start|go)\b/.test(t)) return 'yes';
  if (/\b(next|continue|done|finish|ready)\b/.test(t)) return 'next';
  return null;
}

export function initWelcome(ctx) {
  const { api, S, speaker } = ctx;
  let box = null;
  let running = false;
  let answer = null; // resolves the step waiting for a choice
  let early = null; // a click on this card while Scorpion was still talking

  const talks = () => Boolean(S.voice?.installed) && S.settings.voiceSpeak !== false;
  // Say it (when the voice is there), then let the person answer.
  async function say(text) {
    if (!talks()) return;
    speaker.say(text);
    for (let i = 0; i < 120 && speaker.busy && early === null; i++) await sleep(200);
  }
  // One spoken answer, when Scorpion can hear (no microphone: clicks only).
  let hasMic = null;
  async function hear() {
    if (!S.voice?.installed || !running) return;
    hasMic ??= await navigator.mediaDevices?.enumerateDevices?.().then((d) => d.some((x) => x.kind === 'audioinput'), () => false) ?? false;
    if (!hasMic || !running) return;
    ctx.listen((text) => {
      const c = spokenChoice(text);
      if (c && answer) answer(c);
      else if (running && answer) hear(); // didn't catch it: listen again
    }).catch?.(() => {});
  }

  function card({ title, body = '', choices = [], extra = '' }) {
    early = null;
    box.querySelector('.wl-card').innerHTML = `
      <div class="wl-title">${esc(title)}</div>
      ${body ? `<div class="wl-body">${body}</div>` : ''}
      ${extra}
      <div class="wl-choices">${choices.map(([label, value], i) => `<button class="wl-btn${i === 0 ? ' primary' : ''}" data-choice="${esc(value)}">${esc(label)}</button>`).join('')}</div>`;
    box.querySelector('.wl-steps').innerHTML = STEPS.map((s) => `<span class="${s.id === current ? 'on' : done.has(s.id) ? 'done' : ''}"></span>`).join('');
  }
  // Waits for a click or a spoken answer; resolves with the choice's value.
  function choose(spokenMap = {}) {
    if (early !== null) { const c = early; early = null; return Promise.resolve(spokenMap[c] ?? c); }
    return new Promise((resolve) => {
      answer = (c) => { answer = null; resolve(spokenMap[c] ?? c); };
      hear();
    });
  }

  let current = null;
  const done = new Set();
  const STEPS = [
    {
      id: 'hello',
      async run() {
        card({ title: 'Hi, I\'m Scorpion.', body: 'I run entirely on this computer. Let\'s set things up together; it takes about a minute. Answer out loud or click.', choices: [['Let\'s start', 'yes'], ['Skip setup', 'skip']] });
        await say('Hi, I\'m Scorpion. I run entirely on this computer. Let\'s set things up together. It takes about a minute. Shall we start?');
        return (await choose({ next: 'yes' })) === 'skip' ? 'stop' : 'ok';
      },
    },
    {
      id: 'access',
      async run() {
        // Bigger text, a screen reader, a keyboard on the screen: each one on
        // or off at once, as many as wanted, then Next.
        const A = { bigText: false, screenReader: false, keyboard: false, ...(S.settings.access || {}) };
        const FEATURES = [['bigText', 'Bigger text'], ['screenReader', 'Screen reader'], ['keyboard', 'Keyboard on the screen']];
        const show = () => card({
          title: 'Easier to see, hear or type?',
          body: 'Turn on any of these now; they are also in Settings → General.',
          extra: `<div class="wl-list">${FEATURES.map(([id, label]) => `<button class="wl-net wl-toggle" data-choice="${id}" aria-pressed="${A[id]}">${esc(label)}<span>${A[id] ? 'On' : 'Off'}</span></button>`).join('')}</div>`,
          choices: [['Next', 'next']],
        });
        show();
        await say('If you\'d like bigger text, a screen reader that reads the screen aloud, or a keyboard on the screen, say which one, or say next.');
        for (;;) {
          const c = await choose({ yes: 'next', no: 'next', skip: 'next' });
          if (!FEATURES.some(([id]) => id === c)) return 'ok';
          try {
            Object.assign(A, await api.sysAccess({ feature: c, on: !A[c] }));
            S.settings.access = { ...A };
            if (c !== 'screenReader') await say(A[c] ? 'Done.' : 'Turned off.');
          } catch (err) {
            ctx.toast(ctx.errText(err), 8000);
          }
          show();
        }
      },
    },
    {
      id: 'internet',
      async run() {
        const status = await api.sysWifi({ action: 'status' }).catch(() => null);
        if (!status?.supported || status.online) return 'ok'; // Windows/Mac handle their own, or already online
        let nets = await api.sysWifi({ action: 'list' }).catch(() => []);
        const pick = async () => {
          card({
            title: 'Connect to the internet',
            body: 'Only needed for downloads and updates; I work offline. Pick your Wi-Fi network.',
            extra: `<div class="wl-list">${nets.slice(0, 8).map((n) => `<button class="wl-net" data-ssid="${esc(n.ssid)}">${esc(n.ssid)}<span>${n.secure ? 'secured, ' : ''}${n.signal}%</span></button>`).join('') || '<div class="wl-dim">No Wi-Fi networks found.</div>'}</div>`,
            choices: [['Skip', 'skip'], ['Look again', 'again']],
          });
          return choose();
        };
        await say('First, the internet. You only need it for downloads and updates. Pick your Wi-Fi network, or say skip.');
        for (;;) {
          const c = await pick();
          if (c === 'skip' || c === 'no' || c === 'next') return 'ok';
          if (c === 'again') { nets = await api.sysWifi({ action: 'list' }).catch(() => []); continue; }
          const net = nets.find((n) => n.ssid === c);
          if (!net) continue;
          let password = '';
          if (net.secure) {
            card({ title: net.ssid, body: 'Type the Wi-Fi password.', extra: '<input class="wl-input" type="password" id="wl-pass" autocomplete="off">', choices: [['Connect', 'connect'], ['Back', 'back']] });
            setTimeout(() => box.querySelector('#wl-pass')?.focus(), 50);
            box.querySelector('#wl-pass').onkeydown = (e) => { if (e.key === 'Enter') answer?.('connect'); };
            const c2 = await choose();
            if (c2 !== 'connect') continue;
            password = box.querySelector('#wl-pass')?.value || '';
          }
          card({ title: net.ssid, body: 'Connecting…' });
          try {
            await api.sysWifi({ action: 'connect', ssid: net.ssid, password });
            await say(`Connected to ${net.ssid}.`);
            return 'ok';
          } catch (err) {
            ctx.toast(`Couldn't connect: ${ctx.errText(err)}`, 8000);
            await say('That didn\'t work. Check the password and try again.');
          }
        }
      },
    },
    {
      id: 'model',
      async run() {
        const chat = (S.models || []).find((m) => m.kind === 'chat');
        if (chat || S.settings.chatModel) {
          const name = chat?.name || 'your model';
          // On the first start the model is often still loading: say so, and carry on.
          const loading = Boolean(S.modelStatus?.loading);
          card({ title: loading ? 'Your AI is getting ready' : 'Your AI is ready', body: loading
            ? `I think with <b>${esc(name)}</b>, right here on this computer. It's loading in the background (the first time takes a minute or two); we can carry on meanwhile.`
            : `I think with <b>${esc(name)}</b>, right here on this computer.${S.settings.modelAuto === false ? '' : ' I picked it to suit this computer\'s speed.'} You can choose another in Settings → Models.`, choices: [['Next', 'next']] });
          await say(loading ? `I think with ${name}, right here on this computer. It's getting ready in the background, so let's carry on.` : `My brain is ready: ${name}, right here on this computer.`);
          await choose({ yes: 'next' });
          return 'ok';
        }
        card({ title: 'I need a model to think with', body: 'The recommended one is <b>Qwen3.5 4B</b>: a 2.7 GB download, once. After that I work without the internet.', choices: [['Download it', 'yes'], ['Later', 'skip']] });
        await say('I need a model to think with. The recommended one is a two point seven gigabyte download, once. Shall I download it?');
        if ((await choose()) === 'yes') {
          api.downloadModel('qwen3.5-4b').catch((err) => ctx.toast(`Model download failed: ${ctx.errText(err)}`, 8000));
          ctx.toast('Downloading Qwen3.5 4B in the background (Settings → Models shows progress).', 6000);
        }
        return 'ok';
      },
    },
    {
      id: 'voice',
      async run() {
        card({ title: 'Should I talk back?', body: 'I can answer out loud, or only in writing. You can change this any time.', choices: [['Yes, talk', 'yes'], ['Text only', 'no']] });
        await say('Should I talk back to you out loud?');
        const c = await choose({ next: 'yes', skip: 'no' });
        S.settings = await api.updateSettings({ voiceSpeak: c === 'yes' });
        if (c === 'yes' && !S.voice?.installed) await ctx.installVoice?.();
        if (c === 'yes') await say('Great. I\'ll talk.');
        return 'ok';
      },
    },
    {
      id: 'orb',
      async run() {
        if (!S.voice?.installed) return 'ok';
        card({ title: 'Call me by name', body: 'Say <b>“Scorpion”</b> any time: a small orb floats over your windows, says hello and listens. It only listens for my name while it floats, on this computer, and nothing is kept.', choices: [['Keep it on', 'yes'], ['Turn it off', 'no']] });
        await say('You can call me by name. Say Scorpion, any time, and a small orb will float over your windows, say hello, and listen. Shall I keep that on?');
        const c = await choose({ next: 'yes', skip: 'yes' });
        S.settings = await api.updateSettings({ orbFloat: c !== 'no' });
        return 'ok';
      },
    },
    {
      id: 'done',
      async run() {
        card({ title: 'All set', body: 'Say <b>“Scorpion”</b> to talk to me from anywhere, or press <b>Space</b> in the orb. Everything is in Settings, and you can see this welcome again there.', choices: [['Start using Scorpion', 'next']] });
        await say('All set. Say Scorpion, any time, to talk to me.');
        await choose({ yes: 'next' });
        return 'ok';
      },
    },
  ];

  async function start({ force = false } = {}) {
    if (running || (!force && S.settings.welcomeDone)) return;
    running = true;
    done.clear();
    box = document.createElement('div');
    box.className = 'welcome';
    box.innerHTML = '<div class="wl-card" role="dialog" aria-live="polite"></div><div class="wl-steps"></div>';
    document.body.appendChild(box);
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-choice], [data-ssid]');
      if (!b) return;
      // While Scorpion is still saying the card, a click stops it and counts.
      if (answer) answer(b.dataset.choice ?? b.dataset.ssid);
      else { early = b.dataset.choice ?? b.dataset.ssid; speaker.stop?.(); }
    });
    try {
      for (const step of STEPS) {
        current = step.id;
        if ((await step.run()) === 'stop') break;
        done.add(step.id);
      }
    } catch (err) {
      ctx.toast(`Setup stopped: ${ctx.errText(err)}`, 8000);
    } finally {
      running = false;
      answer = null;
      box.remove();
      box = null;
      S.settings = await api.updateSettings({ welcomeDone: true }).catch(() => S.settings);
    }
  }

  return {
    start,
    get running() { return running; },
  };
}
