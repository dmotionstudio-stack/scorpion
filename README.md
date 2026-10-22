# Scorpion

An offline AI assistant and agent for Windows and macOS. Scorpion runs open-weight
GGUF models on your own computer with llama.cpp. You don't need an API key, an
account, or an internet connection to chat.

- **Home screen** (the Scorpion shell): Scorpion opens on a home screen with an ask box
  and all its tools as holographic tiles (each with a live status line) that fill the
  screen. The sidebar can be hidden for more room (the button in its corner, or
  Ctrl+B). Everything underneath is the same local AI.
- **Chat** with local models (Qwen, Llama, any GGUF file), with streaming and Markdown.
- **Agent**: Scorpion reads, writes and edits files and runs terminal commands inside a
  workspace folder you choose. For files anywhere else it asks first: *Allow*,
  *Don't allow*, or *Always allow this folder* (you can remove those in Settings).
  With no workspace set, it asks you to choose one the first time it needs files.
  Changes and commands wait for your approval unless you turn on Auto-approve.
- **Multi-step planning**: for bigger tasks the agent writes a plan, then updates it
  live as it works. Plan mode is read-only: it explores and plans but can't change anything.
- **Specialist agents**: you choose who answers each chat. Scorpion (general) or a
  specialist: Coder, Researcher, Writer, Data Analyst, File Organizer or Reviewer.
  You can also create your own agents with their own instructions and tools.
- **Agents working together**: any agent can hand a subtask to a specialist with
  `ask_agent`, for example "write this, then have the Reviewer check it". The
  helper's steps appear nested in the chat.
- **Scheduled agents**: an agent can run on a timer, every day at a set time, or
  when files in a folder change. Each run posts a report to the agent's own chat
  and shows a notification. These agents are read-only unless you allow changes.
  Scorpion keeps running in the system tray, and can start at login.
- **Tools**: files, shell commands, run code (JavaScript always works offline;
  Python works if installed), an exact calculator, spreadsheets (.xlsx/.csv), and
  reading PDF and Word files.
- **Memory across chats**: Scorpion saves lasting facts about you, such as your name, preferences and projects, and knows them in every new chat. Ask it to forget something, or view, edit and delete memories on the Memory page. It also recalls relevant parts of earlier conversations, and you can turn either feature off in Settings.
- **Chat with documents**: you add PDF, Word or text files. Scorpion indexes them on your
  machine and the agent searches them and names its sources.
- **Voice**: talk to Scorpion and hear it answer. the microphone button speaks one message, the conversation button starts a
  hands-free conversation (talk, it answers aloud, then listens again; say "stop" to
  end), and the speaker button reads every reply aloud. Spoken replies are short and quick, like
  talking to a person, and you can interrupt Scorpion with Space. Listening uses
  Whisper and speaking uses Kokoro (English) or Meta's MMS voices, all on your
  computer: a one-time ~230 MB download (Settings → Voice → Install) plus ~38 MB
  per extra language voice.
- **Languages**: English, French, Haitian Creole, Spanish, Portuguese, German,
  Russian, Arabic, Hindi, Vietnamese, Korean, Romanian and Yoruba with their own
  voice; Italian, Chinese, Japanese, Dutch, Polish, Turkish, Ukrainian, Indonesian
  and Swahili use your computer's voice for that language. Scorpion listens in the
  language you choose and replies in it, typed or spoken. Haitian Creole has no
  dedicated voice yet, so the French voice reads it (with a French accent), and
  Gemma 3 4B writes the most natural Creole.
- **Interact**: a holographic orb that takes over the whole screen for talking face
  to face (Interact in the sidebar, or Ctrl+I). The orb shows what Scorpion is
  doing (standby, listening, thinking, speaking) and pulses with your voice and its
  own. Captions show what you said and the reply. Switch language right there.
  Drag to spin, scroll to zoom, Space to talk or interrupt, Esc to leave. Its
  colours follow your theme. Optional [hand gestures](#hand-gestures) spin and zoom
  the orb with your webcam.
- **Face recognition** (optional, Settings → People): add people from photos or
  the camera. Interact then tracks faces, turns the orb toward the person and
  knows who is talking (it greets them and answers them by name); the agent can
  find people in your photos and group a folder of photos by person; and face
  lock opens Scorpion only for its owner (with a PIN fallback). Modelled on
  SeetaFace2's pipeline, with open models: a one-time ~39 MB download.
- **Online mode** (off by default): the agent can search the web (DuckDuckGo, with
  Wikipedia as a fallback) and read pages for current information, and names its
  sources. Turn it on in Settings or by clicking the Offline badge in the sidebar.
- **Full file access** (optional): Settings → File access → *Full access* lets the
  agent read, create, edit and move files anywhere on the computer without asking
  which folder. Changes and commands still need your OK unless Auto-approve is on,
  and system folders (Windows, Program Files, /System, /usr…) stay read-only.
- **Skills** (Settings → Skills): folders with a `SKILL.md` that teach the agent how
  to do a kind of job your way. Only names and one-line descriptions sit in the
  prompt; the agent reads a whole skill when a task matches. Four come built in,
  the agent can write new ones ("make a skill from this"), every change can be
  undone, and OpenClaw or Claude skill folders import as they are.
- **Personality and check-ins** (Settings → Personality): a `SOUL.md` you write sets
  Scorpion's tone. Check-ins run your `HEARTBEAT.md` checklist on a timer during the
  hours you choose, read-only, and only notify you when something needs you.
- **Smarter memory**: long chats are summarized instead of cut off (the full chat
  stays saved); once a day, while the computer is idle, *dreaming* turns what you
  said into lasting memories (with a diary, using only a model on your computer or
  network); and *standing intents* remember "when X comes up, remind me of Y".
- **More model sources** (Settings → Connections): Ollama, LM Studio, or any
  OpenAI-compatible server, on your computer or in the cloud with your own key
  (stored encrypted), with a fallback model if the chosen one fails.
- **MCP tool servers**: plug in tools from other programs (stdio, Streamable HTTP or
  SSE). Read-only tools run freely; the others ask first unless you trust the server.
- **Scorpion's browser**: in Online mode the agent can use its own separate browser
  window to click, type and fill forms. Typing, and buttons like Buy, Send or Delete,
  ask you first; downloads and pop-ups are blocked.
- **Chat from your phone**: through your own Telegram bot, by text or voice message.
  Strangers must be approved with a pairing code, and changes and commands ask with
  Allow / Deny buttons on the phone.
- **Safety guards**: a task stops when the same step fails three times in a row, and
  "Always allow this command" lets safe repeat commands run without asking.
- **Runs Windows for you** (Windows only, in any mode, by typing or voice): open,
  switch, minimize, maximize and close apps and windows (desktop and Store apps); open
  files in their app or folders in File Explorer; copy files and folders, or move them to
  the Recycle Bin; open any Windows Settings page; control volume, media, brightness,
  dark/light mode, screenshots, lock and sleep; restart or shut down; and report CPU,
  memory, disks, battery and network. Anything that changes something asks first;
  restart, shut down and emptying the Recycle Bin always ask (even with Auto-approve),
  restart and shut down wait 30 seconds and can be cancelled, apps are closed like
  pressing their X (never force-quit), and Windows' own system folders stay read-only.
- **Scorpion as the Windows desktop** (Windows only, Settings → General → Windows
  desktop): Scorpion starts in place of the Windows taskbar and Start menu when you sign
  in, with its own taskbar (open windows, network, battery, volume, clock, power menu),
  an Apps screen and a Files screen. The switch changes only your own account and is
  yours to press. Without it, "Use Scorpion's holographic taskbar" (same place, on by
  default) puts Scorpion's taskbar in place of the Windows one whenever Scorpion runs,
  on top even when Scorpion is full screen (its screens end above it): the Windows
  taskbar is only hidden, comes back when Scorpion quits (or at its next start after a
  crash), and restarting Explorer also brings it back. If Scorpion
  fails to start three times in a row, the Windows desktop starts instead, and
  Ctrl+Alt+Delete → Task Manager → Run new task → `explorer.exe` always brings it back.
- **Apps screen and taskbar** (Windows): the Apps screen shows every installed app with
  its own icon (from the program, its Start menu shortcut, or a Store app's logo),
  pinned apps first, then A to Z in letter sections with a letter bar to jump; search
  shows the best matches. Right-click an app there, or a window on the taskbar, to pin
  it to the taskbar. The taskbar shows the pinned apps and the open windows with their
  icons (a pinned app's windows share its button: a dot while it runs, a lit bar when
  it is in front). Right-click an empty part of the taskbar to customize it: app names
  or icons only, centered, small, normal or large, a holographic, neon, glass or solid
  look, and which of network, battery, volume and clock show.
- **Mini orb**: the orb's **Minimize** button (or opening a place over the orb) shrinks
  it to a small living orb that floats over everything; click it to bring the orb back,
  drag it anywhere (it stays where you put it).
- **Constellation launcher** (an optional look for the orb's screen, in Settings →
  General → Orb look; the orb sphere is the default): instead of "which app do I
  need?", it asks "what am I working on?". Each project is a constellation: a warm star with its
  apps (coloured planets, with their icons), folders and documents (moons) and
  websites orbiting it. Orbit distance is relevance (recent, frequent, usual at this
  hour, open now; recommendations can be turned off), brightness is recent use, lines
  are your connections, open apps carry their windows as satellites, missing files show
  as red eclipses, and archived projects are dimmed. Click an item to open it, the star
  to **resume** the project (its saved session, from **Save session**), drag an item
  onto another to connect them or anywhere to pin it there for good, scroll or pinch
  out to the galaxy of all projects, drag the background to look around, and type to
  search (matches light up; Enter opens the first). Hover or focus an item for a preview:
  a live picture of its window, or the document's thumbnail. **+ Add** offers apps (with
  icons), recent and recently changed files, websites, files and folders; files dragged
  in from File Explorer join the project. **List** shows everything as plain lists for
  screen readers and keyboards; arrow keys walk the orbits; motion, bigger items and high
  contrast are in Settings → General → Orb look, with the summon shortcut
  (Win+Space if Windows lets go of it, otherwise Win+Alt+Space). Projects are saved on
  this computer and can be exported and imported in a shared format
  (`scorpion-constellations/1`). The classic 3D orb is still there as an option.
- **The orb as the system**: in Interact (and as the desktop) shortcuts orbit the orb:
  Apps, Files, Library, Chats, People, Settings and every open window, with its icon.
  Pick one by saying its name ("files", "switch to Outlook"), clicking it, or with
  Gestures on: point with an open hand and pinch quickly. Sweep your hand sideways to
  switch windows; say "back" or push your open hand toward the screen to return to the
  orb. Spoken requests run Windows through the agent, and anything that changes
  something is asked out loud ("Should I close Word? Say yes or no"). The orb shows
  what it's doing (listening, thinking, working, waiting for you), pulses for low
  battery, finished downloads, schedules and check-ins (and says them, if you turn that
  on), greets you by name at sign-in when face recognition is installed, and with the
  wake word on, saying "Scorpion" starts listening (speech is turned into text on your
  computer; nothing is kept).
- **Apps open inside the orb** (Windows): while the orb is open, the app you bring to
  the front (from the orb, the taskbar, by voice, or a file opened from Files) loses its
  title bar and fills a panel next to the orb, which moves to the right. Scorpion's strip
  above it switches apps, goes back to the orb (the app waits, minimized), pops it out
  as a normal window, or closes it (it can still ask to save). One app at a time; the
  others are ordinary minimized windows. Leaving the orb or quitting Scorpion gives every
  app its normal window back, and so does the next start if Scorpion ever stops
  unexpectedly. Apps running as administrator can't be framed and open normally. Turn it
  off in Settings → General → Windows desktop.
- **Full screen** (Settings → General → Full screen, on by default): Scorpion starts
  filling the whole screen, over every other window, with no title bar or window
  buttons. Leave it with **Ctrl+Esc** or **Esc pressed twice** (both work even while an
  app inside the orb has the keyboard, and Ctrl+Esc doesn't open the Start menu while
  Scorpion is full screen); **F11** goes back. Apps you open from Scorpion show inside
  the orb, on top of it. Windows itself (Ctrl+Alt+Delete, sign-in, its alerts) can still
  come in front.
- **Private by design**: Scorpion stores data only in your OS app-data folder, makes no
  network calls while you chat unless you turn on Online mode, has a sandboxed UI and
  a locked-down IPC bridge.

Architecture notes, and what Scorpion learned from studying [Jan](https://github.com/janhq/jan),
are in [docs/JAN_STUDY.md](docs/JAN_STUDY.md). Skills, SOUL.md, check-ins, dreaming,
standing intents, the agent browser, MCP servers, model sources, phone chats and the
loop guard follow ideas from [OpenClaw](https://github.com/openclaw/openclaw) (MIT),
written fresh for Scorpion.

## Install

### Get the installer

1. Sign in to GitHub and open this repository's **Actions** tab.
2. Click the newest successful **Release** run, then **Summary** in the left sidebar.
3. Scroll to **Artifacts** at the bottom and download the one for your computer:

| Your computer | Download | File inside the zip |
|---|---|---|
| Windows 10 or 11 (64-bit) | `scorpion-windows-latest` | `Scorpion Setup x.y.z.exe` |
| Mac with Apple Silicon (M1, M2, M3, M4) | `scorpion-macos-latest` | `Scorpion-x.y.z-arm64.dmg` |
| Mac with an Intel processor | `scorpion-macos-15-intel` | `Scorpion-x.y.z.dmg` |

Not sure which Mac you have? Apple menu → **About This Mac**: it says **Chip**
(Apple Silicon) or **Processor** (Intel).

### Windows

1. Unzip the download and double-click **Scorpion Setup x.y.z.exe**.
2. If Windows shows *"Windows protected your PC"*, click **More info → Run anyway**.
   This appears because the installer isn't signed with a paid certificate.
3. Choose where to install (the default is fine) and click **Install**.
4. Open **Scorpion** from the Start menu or the desktop shortcut.

To uninstall: **Settings → Apps → Installed apps → Scorpion → Uninstall**.
Your chats, memories and models stay in `%APPDATA%\Scorpion` until you delete
that folder.

### Mac

1. Unzip the download and double-click the **.dmg** file.
2. In the window that opens, drag **Scorpion** onto the **Applications** folder.
3. Open **Scorpion** from Applications. The first time, macOS says *"Apple could
   not verify Scorpion is free of malware"*. Click **Done** (not Move to Trash).
4. Open **System Settings → Privacy & Security**, scroll to **Security**, click
   **Open Anyway** next to *"Scorpion" was blocked*, and enter your Mac password.
5. Open Scorpion again and click **Open Anyway**. From now on it opens normally.

On macOS 14 or older, steps 3 to 5 are simpler: right-click **Scorpion** in
Applications, choose **Open**, then click **Open**.

If you prefer Terminal, or macOS says the app *"is damaged"*, run this once and
then open Scorpion normally:

```bash
xattr -dr com.apple.quarantine /Applications/Scorpion.app
```

To uninstall: drag **Scorpion** from Applications to the Trash. Your chats,
memories and models stay in `~/Library/Application Support/Scorpion` until you
delete that folder.

### First start: get a model

Scorpion needs one model file. You need internet once for this, or none at all
if you copy the file from another computer.

- **Download**: open **Settings → Models** and click **Download** next to
  **Qwen3 4B** (2.5 GB, the recommended model).
- **Copy from another computer**: copy a `.gguf` file onto a USB drive, then use
  **Settings → Models → Import .gguf file…**. On Windows, Scorpion keeps its
  models in `%APPDATA%\Scorpion\models`; on a Mac, in
  `~/Library/Application Support/Scorpion/models`.

After that Scorpion works fully offline.

## Run from source

Requirements: Node.js 20+.

```bash
npm install
```

```bash
npm start
```

Open **Models** and download a model, or import a `.gguf` file you already have.
Choose a workspace folder (the folder button in the top bar), then try:
*"List the files in my workspace and summarize the project."*

## Voice

1. Open **Settings → Voice** and click **Install voice** (about 230 MB, once).
2. Click the microphone button below the message box and speak. Scorpion sends
   your message when you pause. Click it again to send early.
3. For a conversation, click the conversation button (the sound wave). Scorpion
   listens, answers aloud, then listens again. Say "stop" or click it to end.
4. The speaker button reads every reply aloud. While it's speaking, click it to stop.

Choose your language, the voice and the speed in **Settings → Voice** (or the
language menu in Interact). Picking a language with its own voice downloads that
voice once (~38 MB). The microphone is only used while the microphone or conversation button is listening.
Audio never leaves the computer. The page can't use the camera (except for
Interact's hand gestures, while you have them on) or the screen.

Spoken turns are answered in one to three short sentences, and Scorpion starts
talking as soon as the first phrase is ready. For the quickest replies use Qwen3
4B; it starts answering in about a quarter of a second on a 4 GB graphics card.

If Scorpion says the microphone is muted or blocked: on Windows, check the mic
key on your keyboard and **Settings → Privacy & security → Microphone** ("Let
desktop apps access your microphone"); on a Mac, allow Scorpion in **System
Settings → Privacy & Security → Microphone**.

## Hand gestures

**Your hand replaces the mouse** (Windows, Settings → General → Hand gestures, on by
default): hand tracking runs whenever Scorpion is open, even behind other windows, and
rests only while Scorpion is minimized. Your index finger moves the real Windows
pointer over the whole screen; a quick pinch clicks, thumb + middle right-clicks, a
fist then open hand double-clicks, a held pinch drags, two fingers up scroll, and both
hands spreading or closing zoom (Ctrl + wheel). This works in every app, in Scorpion
and on its taskbar. Sweeps, push, thumbs and signs keep their meanings below, and a
**held fist pauses** everything until you hold a fist again. Turn the camera off with
**G** in the orb, **Off** under the camera preview, or the switch in Settings; turn off
"Hands replace the mouse" to go back to gestures only inside the orb.

In the orb your hands are also drawn over it as glowing skeletons, with what each hand
is doing written by the wrist. With no hand in view the tracker checks only every
third camera frame, to save power.

The same gestures work on the orb, inside the apps it opens (your hand moves the
real mouse pointer) and in the places that open over it (Files, Apps, Library,
Settings…, with a hand cursor). Press **?** or **H** (or **Gesture guide** under
the camera preview) for this list on screen:

| Gesture | On the orb | Inside an app / a place |
|---|---|---|
| Point (index finger up) | Aim at a shortcut; **hold 1 s to open it** | Move the pointer / hand cursor |
| Quick pinch, thumb + index | Open the shortcut | Click |
| Quick pinch, thumb + middle | | Right-click |
| Pinch, hold and move | Spin the orb | Drag |
| Fist, then open wide ("zoom in") | Open the shortcut | Double-click (open a file or folder) |
| Both hands pinched, spread | Aimed at a shortcut: **fly into it and open it**; else zoom in | Files: **open the folder**; apps: zoom in |
| Both hands pinched, close | Zoom out | Files: **up a folder**; apps: zoom out |
| Two fingers up, move up or down | Turn the shortcut rings | Scroll |
| Three fingers up | Files | Files |
| Open hand, sweep left or right | Previous / next app | Previous / next app |
| Open hand, sweep up | Home | Home (the orb; the app waits, minimized) |
| Open hand, sweep down | Apps | Apps |
| Open hand, push toward the screen | Back | Back |
| Thumb + little finger out | Talk / stop talking | same |
| Thumb up or down, held | Yes / No to a question | same |
| Open palm, held still | Stop (Scorpion stops speaking) | same |
| Fist, held | Pause / resume your hands | same |

Inside an app the hand moves the real mouse pointer, but only within that app's
panel: a gesture can never click anything else. On Scorpion's screens: point to move the hand cursor, quick pinch to click, fist-then-open to double-click (open a file in Files), thumb + middle for the right-click menu, two fingers to scroll; sweeping left or right brings your other apps forward. Press **G** again to turn
gestures and the camera off.

A small mirrored camera preview shows the hand points Scorpion sees and a status
line (how many hands and what they're doing; each gesture shows its name as it happens). Hand tracking uses
Google's MediaPipe hand landmarker, which runs inside Scorpion. The first time you
turn gestures on, Scorpion downloads its hand model once (about 8 MB); after that
it works offline.

The camera is off by default. It is only on while gestures are on, and goes off
when you leave Interact. Video stays on your computer and is never recorded or
sent anywhere. If the preview says the camera is blocked: on Windows, allow
**Settings → Privacy & security → Camera** ("Let desktop apps access your
camera"); on a Mac, allow Scorpion in **System Settings → Privacy & Security →
Camera**.

## Face recognition

Scorpion's face features follow the pipeline of [SeetaFace2](https://github.com/seetafaceengine/SeetaFace2):
detect faces, find 5 landmarks, align the face, turn it into a face print, and
compare prints, plus tracking and a quality check. Instead of compiling
SeetaFace2's C++ (and its 2020 models), it uses open models on the ONNX engine
Scorpion already ships, so it works the same on Windows and Mac:

| SeetaFace2 module | In Scorpion |
|---|---|
| FaceDetector + 5-point FaceLandmarker | YuNet (OpenCV Zoo, MIT) |
| FaceRecognizer | SFace (OpenCV Zoo, Apache-2.0): 128-number face prints, same person above 0.363 cosine similarity |
| FaceTracker | Keeps each face's id and name steady between camera frames |
| QualityAssessor | Size, light, sharpness and pose checks; poor photos are skipped with the reason |

1. Open **Settings → People** and click **Install face recognition** (~39 MB, once).
2. Type a name and click **Add from photos…** (2–5 clear photos) or **Add with
   camera** (five shots a moment apart). The first person added is the owner.
3. In **Interact**, press **FACE** (or F). Scorpion tracks faces, turns the orb
   toward you, shows who is talking, greets people it knows and answers them by
   name.
4. In a Build or Plan chat, ask things like *"Group the photos in Pictures/2024
   by person"* or *"Which photos in this folder show Dor?"*. Scorpion can then
   sort them into folders with your approval.
5. **Face lock**: set a PIN, then tick *Lock Scorpion until it recognizes the
   owner*. Scorpion opens locked; it unlocks for the owner's face or the PIN.
   Ctrl+L locks it right away. While locked, the app refuses every request for
   your data, not just the screen. It does not encrypt files on disk, and a
   printed photo of the owner might fool it.

People are stored as face prints (and a small thumbnail) in `faces.json` in
Scorpion's data folder. Photos are never copied or uploaded, and the camera is
only on while FACE, gestures, enrolling or the lock screen is using it.

## Getting a model with no internet at all

Scorpion keeps its own model library and doesn't share models with other apps,
so any model can be uninstalled (Models → Uninstall) and installed again at any
time. Partly downloaded files are cleaned up automatically.

Scorpion needs a model file once. You can get one in any of three ways:

1. **Download inside the app**: a one-time download from Hugging Face.
2. **Import**: on another computer, download a `.gguf` and copy it over on a USB
   drive, then use **Models → Import .gguf file**.
3. **Bundle it in the installer**: put `.gguf` files in `resources/models/` before you
   build. The installer then ships with the model, and Scorpion picks it automatically
   the first time it starts.
   ```bash
   node scripts/fetch-models.mjs resources/models qwen3-4b nomic-embed
   ```

| Catalog id | Use | Size |
|---|---|---|
| `qwen3-4b` | Recommended chat + agent model | 2.5 GB |
| `qwen3.5-4b` | Newest Qwen; best Qwen for Haitian Creole | 2.7 GB |
| `llama3.2-3b` | Fast general chat | 2.0 GB |
| `llama3.2-1b` | Low-memory computers | 0.8 GB |
| `nomic-embed` | Required for documents | 140 MB |

## Build installers

| Platform | Command | Output |
|---|---|---|
| Windows | `npm run dist:win` | `release/Scorpion Setup x.y.z.exe` |
| macOS | `npm run dist:mac` (on a Mac) | `release/Scorpion-x.y.z-arm64.dmg` (Apple Silicon) or `release/Scorpion-x.y.z.dmg` (Intel) |

You can only build a macOS installer on a Mac. The included GitHub Actions workflow
(`.github/workflows/release.yml`) builds Windows, Apple Silicon and Intel Mac
installers in the cloud. Run it from the Actions tab and, if you want, list model
ids to bundle.

Unsigned builds show a warning on first launch. On Windows that's SmartScreen:
choose *More info → Run anyway*. On macOS that's Gatekeeper: drag Scorpion to
Applications, open it once, then go to *System Settings → Privacy & Security* and
click *Open Anyway* (on macOS 14 and older, right-click the app and choose *Open*).
The Mac app is ad-hoc signed, so it runs on Apple Silicon without a certificate. To
remove these warnings you need an Apple Developer ID certificate.

## Hardware acceleration

llama.cpp binaries come prebuilt, and Scorpion picks one automatically:

- macOS: Metal (Apple Silicon)
- Windows: Vulkan (NVIDIA, AMD and Intel graphics) or CPU

The Windows build ships without the CUDA libraries (about 545 MB): Vulkan
already drives NVIDIA cards, and the installer is 121 MB instead of 392 MB.
Flash attention is on wherever the model supports it.

The Models page shows the active backend, how many layers are on the GPU,
and a tag on every model: *Fast here* (fits in graphics memory), *Slower here*
(part runs on the CPU), or *Too big*.

### Speed tips

- Pick a model tagged *Fast here*. On a 4 GB laptop GPU, Qwen3 4B Instruct writes about
  45 tokens/second; an 8-bit 4B model that doesn't fit managed about 6.
- "Thinking" models write hidden reasoning before every answer, so they feel
  much slower to start.
- `node scripts/bench.mjs <model.gguf>` measures speed on your machine, and
  `node scripts/prompt-size.mjs <model.gguf>` shows how much every new chat
  has to read before answering.

## Tests

```bash
npm test
```

```bash
node scripts/e2e-agent.mjs path/to/chat.gguf path/to/embed.gguf
```

```bash
node scripts/e2e-memory.mjs path/to/chat.gguf
```

```bash
node scripts/e2e-team.mjs path/to/chat.gguf
```

### How helper agents share memory

A helper agent needs a context of its own. If your GPU or RAM has room, Scorpion
keeps a second context sequence for helpers, so they run alongside the main chat.
If not (common on laptops with integrated graphics), the helper borrows the main
chat's context while the main chat waits. The main chat then re-reads its history
when it continues. This works on any machine; it's just slower.

## Security model

- File tools resolve every path and follow symlinks, so the agent can only reach
  the workspace and folders you allowed. Any other folder needs your *Allow*
  first, and scheduled agents never ask: they only get the workspace and the
  folders you marked *Always allow*. With *Full access* every drive is allowed.
- Operating-system folders (Windows, Program Files, ProgramData; /System, /usr,
  /bin, /etc, /Library…) can be read but never changed, whatever the setting.
- Online mode is off until you turn it on. Web pages are treated as untrusted
  data, and addresses on your own computer or local network (localhost, router,
  NAS, 192.168.x.x and the like) are refused, including through redirects.
- `write_file`, `edit_file` and `run_command` need your approval unless you turn on
  Auto-approve. Plan mode hides those tools from the model completely.
- `run_command` and `run_code` run real programs. Approval is the only safeguard,
  so read them before you allow them.
- Each agent sees only the tools it is allowed to use, and helper agents can't
  delegate further. A scheduled agent runs with nobody watching, so its file
  changes and commands are refused unless you tick "Allow it to change files" for
  that schedule.
- Face lock: while locked, the main process refuses every request except the lock
  screen's own; the PIN is stored only as a salted scrypt hash in `lock.json`.
- The UI runs with `contextIsolation`, `sandbox` and a strict CSP, and has no Node access.

## License

Apache-2.0.

The Interact orb is adapted from [ULTRON Orb UI](https://github.com/SAGAR-TAMANG/ultron-by-sagar-builds)
by Sagar Tamang (MIT, see `src/renderer/ORB-LICENSE.txt`). It uses
[three.js](https://threejs.org) (MIT); the few add-ons it needs are copied in
`src/vendor/three-addons` because installers leave out `node_modules` example folders.
Its hand gestures follow the same project's hand tracker and use
[MediaPipe Tasks Vision](https://www.npmjs.com/package/@mediapipe/tasks-vision)
(Apache-2.0, © Google), whose hand model is downloaded from Google on first use.

Face recognition uses YuNet (MIT, © Shiqi Yu) and SFace (Apache-2.0) from the
OpenCV Model Zoo, downloaded from Hugging Face on first use; its design follows
SeetaFace2 (BSD-2, © SeetaTech / ICT CAS), whose code is not included.

Scorpion's design was informed by studying Jan (Apache-2.0, © Menlo Research).
Scorpion contains none of Jan's source code.
