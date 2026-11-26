// News and release notes, newest first. To post an update, add an entry at the
// top. `tag` is one of: release, feature, news. `version` is the Scorpion
// release it shipped in, or null for news that isn't tied to one.

export const UPDATES = [
  {
    date: '2026-11-26',
    version: '0.1.60',
    tag: 'release',
    title: "It waits until you are done, and listens for your voice",
    summary:
      "Scorpion no longer starts answering the moment you pause, and it ignores the room: fans, keyboards and hum.",
    points: [
      "A pause to think does not end your turn: it waits a second and a half or more, longer if you have been speaking a while or your sentence trails off",
      "Voice focus: only a human voice starts or continues a turn. Say \"block background noises\" or \"stop blocking background noise\" to change it",
      "Ask \"what's that noise?\" and it listens to the room for a few seconds and tells you what it hears. It is the only time it does, and nothing is kept",
      "Say \"turn off hand gestures\", \"turn on face tracking\", \"turn off talk mode\", \"turn off text\", \"turn the wake word on\" and more, and Scorpion flips its own switches",
    ],
  },
  {
    date: '2026-11-26',
    version: null,
    tag: 'news',
    title: "Scorpion is on scorpionai.tech, and Windows and Mac are free",
    summary:
      "The Windows and Mac installers are free to download from the Download page, always the newest version. The editions add Scorpion OS, the offline model pack and USB sticks.",
    points: [
      "The site runs on Cloudflare, with the big files in its own storage",
      "Pushing a release builds the installers, publishes them and updates the site by itself, the Scorpion OS image included",
      "Buyers can sign in with an email and a code to download again (My downloads)",
    ],
  },
  {
    date: '2026-11-26',
    version: '0.1.56',
    tag: 'release',
    title: "The orb and the humanoid are one",
    summary:
      "Say \"transform into the humanoid\" and the orb folds into a point of light and the humanoid grows from it, in slow motion. Say \"show me the orb\" to go back.",
    points: [
      "Eight ways for the humanoid to enter, picked at random, including growing from a seed of light on its chest",
      "The humanoid frames its whole figure inside its own tile when apps are open in the orb",
      "It answers your hands and voice: an open palm gets a hello, a thumbs-up a nod, \"goodbye\" a bow, and it turns to look at an app as it opens",
      "A livelier face: a soft breathing glow, blinking eye lights, branching veins and a beating heart orb; light runs up its body while it speaks",
      "Looks and sounds: Hologram, Glass or Wireframe, a Soft, Normal or Bright glow, background lines Subtle, Full or Off, and soft cues when it starts listening and finishes thinking",
    ],
  },
  {
    date: '2026-11-25',
    version: '0.1.51',
    tag: 'release',
    title: "The orb humanoid",
    summary:
      "A 3D hologram figure in your theme's colour that sits on the bottom edge of the screen, with a constellation of glowing veins behind it. It introduces itself, follows your hand, face and pointer, listens in the opposite colour, and speaks with light running up its body.",
    points: [
      "One continuous body: the head bends on the neck without a seam",
      "Settings → General → Orb look chooses the orb sphere or the humanoid",
      "The constellation launcher is gone; the summon shortcut is the orb shortcut",
    ],
  },
  {
    date: '2026-11-25',
    version: '0.1.49',
    tag: 'release',
    title: "The orb talks sooner, without pauses",
    summary:
      "Each spoken sentence is prepared as soon as it arrives instead of after the one before has finished, and a side taskbar stacks Home, Apps and Files.",
    points: [
      "An optional faster voice (Settings, Voice)",
      "Apps in the orb keep their own minimize, maximize and close buttons",
      "The intent wheel is removed everywhere",
    ],
  },
  {
    date: '2026-11-24',
    version: '0.1.47',
    tag: 'release',
    title: "Remote control, and Scorpion OS updates itself",
    summary:
      "See this computer's screen and work its mouse and keyboard from a phone, tablet or another computer's browser (Windows and Mac), paired, approved and logged. An installed Scorpion OS installs security fixes and new versions of Scorpion by itself every day.",
    points: [
      "Scorpion OS: a wrong clock (a PC that also runs Windows) no longer blocks updates",
      "Mods: small changes kept in Scorpion's data folder that change how it looks or acts, safely",
    ],
  },
  {
    date: '2026-11-17',
    version: '0.1.45',
    tag: 'release',
    title: "Build gets smarter, and Scorpion can install and change itself",
    summary:
      "Scorpion installs what a program needs, builds pages that open in the preview by themselves, runs several chats at once, and has five new agents and 16 new skills.",
    points: [
      "Agents: App Builder, Website Builder and more; 20 skills it follows when a job matches",
      "Build a webpage and Build an app are one click from an empty chat",
      "Scorpion can edit its own source, run its tests and restart to load the change (it always asks first)",
      "The internet when you allow it: search the web or read a page, asked for each time with Online off",
      "No more runaway builds: a task that keeps trying wraps up at 40 steps",
    ],
  },
  {
    date: '2026-11-14',
    version: '0.1.34',
    tag: 'release',
    title: "Its own browser, and you can watch it think",
    summary:
      "The Preview beside the chat is now a browser, the model's reasoning stays open and growing as it is written, and Scorpion can look through your files by name.",
    points: [
      "A browser with an address bar, back, forward and reload",
      "Find files anywhere (\"find my tax return\", \"*.pdf\") with full file access on",
      "More models: Qwen3.5 9B Defiant Fable, Qwopus3.5 9B",
    ],
  },
  {
    date: '2026-11-11',
    version: '0.1.24',
    tag: 'release',
    title: "The orb is the system",
    summary:
      "Every app you open while the orb is open gets a tile, up to six side by side like Windows Snap, and Home, the chat and Settings open as tiles beside the orb. The orb has its own conversation and its own taskbar.",
    points: [
      "Apps fit their tiles; resize from any edge; the title can move; apps that draw their own title bar open in the orb",
      "A floating orb when Scorpion's window is behind other windows: say \"Scorpion\" and it wakes",
      "The orb thinks only if you ask, and answers sooner: a short pause ends a short question",
      "Time, date, volume, \"open Safari\", a screenshot, dark mode and the battery are done at once, without the model",
      "Scorpion can run your Mac, and a taskbar you arrange yourself on Windows, Mac and the orb",
    ],
  },
  {
    date: '2026-11-10',
    version: '0.1.17',
    tag: 'release',
    title: "Thinking, automatic model choice, and the orb as a voice chat",
    summary:
      "A Thinking switch at the top of every chat, models that show how fast they will be on your computer, and the most capable model that answers comfortably chosen for you.",
    points: [
      "The orb is a voice chat once the voice is installed: say \"Scorpion\", ask, and the answer is spoken",
      "Trust a folder in Build: Scorpion creates files and runs commands there without asking each time",
      "Unrestricted mode (always asks first): Scorpion goes online and runs without asking at each step",
      "More models in the catalog, including Gemma 4 E4B and DeepSeek V4.1 Flash",
    ],
  },
  {
    date: '2026-11-08',
    version: '0.1.15',
    tag: 'release',
    title: "Scan this computer for models",
    summary:
      "Settings, Models, Scan this computer for models looks in the usual places (Downloads, LM Studio, GPT4All, Jan, the Hugging Face cache) and uses what it finds where it is, with nothing copied.",
    points: [
      "The orb's bubbles are yours to arrange (Settings, General)",
      "Hand tracking keeps up: its own thread, room on the graphics chip, a steady camera",
    ],
  },
  {
    date: '2026-10-29',
    version: '0.1.8',
    tag: 'release',
    title: 'The summon dot, Stage, and Ctrl+K',
    summary:
      'Installers for Windows and Mac. On Windows, Scorpion can now run your whole desktop and apps open full screen; everywhere, everything Scorpion can do is one keystroke away.',
    points: [
      'Scorpion as your Windows desktop or taskbar, with the Windows desktop always one switch away',
      'The summon dot and a new glass intent wheel, from anywhere with Win+Shift+Space',
      'Stage: touch the left edge and every open app slides in as a live picture',
      'Command palette (Ctrl+K): everything Scorpion can do, by keyboard, voice or the wheel',
      'A friendlier spoken first start, accessibility options and a Performance switch',
    ],
  },
  {
    date: '2026-10-29',
    version: '0.1.8',
    tag: 'feature',
    title: 'Full-screen apps, Stage, and a taskbar that hides',
    summary:
      'Apps open filling the screen, minimized ones fly into Stage, and the taskbar can get out of the way until you need it.',
    points: [
      'Apps open full screen; their dialogs keep their size',
      'Stage lists every open app; pick one and the window in front steps aside',
      'The taskbar can hide until the pointer touches its edge',
      'Choose what the taskbar shows (clock, network, battery, mail, chat, volume) and reorder its apps',
      'All of it in Settings, Windows and taskbar',
    ],
  },
  {
    date: '2026-10-28',
    version: '0.1.8',
    tag: 'feature',
    title: 'The summon dot and the glass wheel',
    summary:
      'Minimize Scorpion and a small glowing dot stays on your desktop. Click it and the intent wheel grows out of it over a frosted picture of your screen.',
    points: [
      'Drag the dot anywhere; it stays where you put it',
      'Write, Browse, Talk, Create, Files and Focus around the wheel: flick toward one, or press 1 to 6',
      'Your recent windows sit around it as tilted cards with their names',
      'Type on the wheel to search everything Scorpion can do',
    ],
  },
  {
    date: '2026-10-27',
    version: null,
    tag: 'news',
    title: 'Scorpion OS: updates, undo and apps from Flathub',
    summary:
      'Scorpion OS now keeps itself up to date, can put back a change that went wrong, and finds new apps when you ask.',
    points: [
      'Updates in Settings: what\'s new, install with progress, restart; "Updates ready" when there are some',
      'Undo a change: the system takes snapshots, and your files are never touched',
      'Get more apps: search finds apps on Flathub and installs them without a password',
      'Quick settings beside the rail: Wi-Fi, Bluetooth, volume, brightness and battery',
      'An Install button on the live USB, and Scorpion\'s mark on the sign-in screen',
    ],
  },
  {
    date: '2026-10-27',
    version: '0.1.8',
    tag: 'feature',
    title: 'A friendlier first start, and accessibility',
    summary:
      'The orb walks a new install through setup out loud, and anyone can turn on bigger text, a screen reader or an on-screen keyboard right after hello.',
    points: [
      'Spoken setup: the model, talking back, face recognition and a live hand-gesture tutorial',
      'Answer by voice, a click or your hand',
      'Bigger text, a screen reader (Narrator on Windows, Orca on Scorpion OS) and an on-screen keyboard',
      'Setup carries on while the model loads, instead of a Please wait screen',
    ],
  },
  {
    date: '2026-10-25',
    version: null,
    tag: 'news',
    title: 'Introducing Scorpion OS',
    summary:
      'Scorpion as a whole operating system. Boot it from a USB stick with nothing installed, or install it alone or alongside Windows.',
    points: [
      'Built on Ubuntu 24.04 LTS, with its drivers for Wi-Fi, sound, Bluetooth, graphics and printers',
      'Scorpion is the desktop, taskbar and launcher',
      'A model and the voice built in, so it chats and talks from the first minute with no internet',
      'Keep your changes on the USB stick and carry your whole AI from one computer to the next',
      'Signed updates through Software Updater, and system snapshots you can undo',
    ],
  },
  {
    date: '2026-10-25',
    version: null,
    tag: 'feature',
    title: 'Scorpion on Linux',
    summary:
      'Scorpion now runs on Linux too, as a .deb for Ubuntu and Debian or an AppImage for any distribution, and it can run the computer for you.',
    points: [
      'Chat, agents, voice, faces, hand gestures and the models work on any distribution',
      'The agent can handle Wi-Fi, Bluetooth, apps, volume, brightness and power',
      'Diagnose finds problems with sound, network, graphics, battery and storage',
      'Changes ask first, and installs take a system snapshot first where they can',
    ],
  },
  {
    date: '2026-10-25',
    version: '0.1.8',
    tag: 'feature',
    title: 'The edge rail, a Performance switch, and portable Windows',
    summary:
      'A glass rail down the right edge to glance at, a way to make Scorpion lighter on slower PCs, and a Windows version that runs from a USB stick.',
    points: [
      'Edge rail: clock, battery, network, notifications, mail and your apps, down the right edge',
      'Performance: Full, Balanced or Light, and Light automatically on battery',
      'The Windows installer asks: installed, or portable on a USB stick with nothing written to the PC',
      'One design system across every screen, and a readable Light theme',
    ],
  },
  {
    date: '2026-10-21',
    version: '0.1.8',
    tag: 'feature',
    title: 'The orb becomes the system',
    summary:
      'The Interact orb can now run your whole computer: apps open inside it, your hand can be the mouse, and projects become constellations.',
    points: [
      'Shortcuts and every open window orbit the orb; say a name, click, or point and pinch',
      'Apps open in a panel next to the orb, and come back as normal windows when you leave',
      'Your hand can move the real mouse pointer across the whole screen',
      'Constellation launcher: each project is a star with its apps, files and websites in orbit',
      'Full screen at start; Ctrl+Esc or Esc twice to leave',
    ],
  },
  {
    date: '2026-10-20',
    version: '0.1.7',
    tag: 'release',
    title: 'Scorpion becomes your Windows desktop',
    summary:
      'A new home screen with an ask box, a launcher for every tool, your workspaces and recent activity, plus agent tools made for Windows.',
    points: [
      'Home screen: ask anything, open any tool, and see what each one is doing',
      'Workspaces: save folders, start a chat in one, and every chat remembers where it started',
      'Scorpion runs Windows for you: apps, windows, files, settings, volume and power, asking first',
      'Restart and shut down always ask, and wait 30 seconds so you can cancel',
    ],
  },
  {
    date: '2026-10-19',
    version: '0.1.6',
    tag: 'feature',
    title: 'Face recognition, after SeetaFace2',
    summary:
      'Scorpion can learn the people you add, greet them by name in Interact, sort your photos by person, and lock itself to its owner.',
    points: [
      'Add people from photos or the camera (Settings, People)',
      'Interact turns the orb toward whoever is talking',
      'Face lock opens Scorpion only for you, with a PIN fallback',
      'Open models, one 39 MB download, processed on your computer',
    ],
  },
  {
    date: '2026-10-19',
    version: '0.1.6',
    tag: 'release',
    title: 'Hand gestures for the Interact orb',
    summary:
      'Spin and zoom the holographic orb with your hands through the webcam, and a new end-to-end check that the agent asks before touching folders.',
    points: [
      'Pinch, hold and move to spin; pinch with both hands and spread to zoom',
      'Point and pinch to click inside apps and on Scorpion\'s own screens',
      'Video stays on your computer and is never recorded or sent anywhere',
      'The folder-permission check is now tested with a real model',
    ],
  },
  {
    date: '2026-10-19',
    version: null,
    tag: 'feature',
    title: '22 languages, online mode and full file access',
    summary:
      'Talk to Scorpion in your language, let the agent search the web when you want it to, and give it the whole computer if you choose.',
    points: [
      'Thirteen languages with their own voice, including Haitian Creole and Yoruba',
      'Online mode (off by default) searches the web and names its sources',
      'Full file access, with system folders kept read-only',
    ],
  },
  {
    date: '2026-10-19',
    version: null,
    tag: 'feature',
    title: 'Meet Interact, and talk out loud',
    summary:
      'A full-screen holographic orb for face-to-face conversations, and offline voice with Whisper and Kokoro.',
    points: [
      'Hands-free conversation: talk, it answers aloud, then listens again',
      'Interrupt any time with Space',
      'Voice runs on your computer after a one-time 230 MB download',
    ],
  },
  {
    date: '2026-10-18',
    version: null,
    tag: 'news',
    title: 'Run Scorpion from a USB stick',
    summary:
      'Plug the stick into any Windows PC or Mac and Scorpion starts with its model ready. Your chats stay on the stick.',
    points: [
      'No install and no internet needed',
      'Windows and Mac share the same data folder on the stick',
      'Order a ready-made stick from the USB page',
    ],
  },
  {
    date: '2026-10-18',
    version: null,
    tag: 'release',
    title: 'Faster models and Apple Silicon',
    summary:
      'Six tested fast models, a default model picked to fit your computer, and the Mac build now runs models on Metal.',
    points: [
      'Install, uninstall and reinstall models one by one',
      'A faster CPU mode for computers without a graphics card',
      'Native Apple Silicon build',
    ],
  },
];

// Anchor id for an update, so other pages can link straight to it.
export const updateId = (u) => `${u.date}-${u.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')}`;
