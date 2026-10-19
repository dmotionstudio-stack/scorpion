# Scorpion

An offline AI assistant and agent for Windows and macOS. Scorpion runs open-weight
GGUF models on your own computer with llama.cpp. You don't need an API key, an
account, or an internet connection to chat.

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
- **Voice**: talk to Scorpion and hear it answer. 🎤 speaks one message, 🗣 starts a
  hands-free conversation (talk, it answers aloud, then listens again; say "stop" to
  end), and 🔊 reads every reply aloud. Spoken replies are short and quick, like
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
  to face (◉ Interact in the sidebar, or Ctrl+I). The orb shows what Scorpion is
  doing (standby, listening, thinking, speaking) and pulses with your voice and its
  own. Captions show what you said and the reply. Switch language right there.
  Drag to spin, scroll to zoom, Space to talk or interrupt, Esc to leave. Its
  colours follow your theme. Optional [hand gestures](#hand-gestures) spin and zoom
  the orb with your webcam.
- **Online mode** (off by default): the agent can search the web (DuckDuckGo, with
  Wikipedia as a fallback) and read pages for current information, and names its
  sources. Turn it on in Settings or by clicking the Offline badge in the sidebar.
- **Full file access** (optional): Settings → File access → *Full access* lets the
  agent read, create, edit and move files anywhere on the computer without asking
  which folder. Changes and commands still need your OK unless Auto-approve is on,
  and system folders (Windows, Program Files, /System, /usr…) stay read-only.
- **Private by design**: Scorpion stores data only in your OS app-data folder, makes no
  network calls while you chat unless you turn on Online mode, has a sandboxed UI and
  a locked-down IPC bridge.

Architecture notes, and what Scorpion learned from studying [Jan](https://github.com/janhq/jan),
are in [docs/JAN_STUDY.md](docs/JAN_STUDY.md).

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
Choose a workspace folder (📁 in the top bar), then try:
*"List the files in my workspace and summarize the project."*

## Voice

1. Open **Settings → Voice** and click **Install voice** (about 230 MB, once).
2. Click 🎤 below the message box and speak. Scorpion sends your message when you
   pause. Click 🎤 again to send early.
3. For a conversation, click 🗣. Scorpion listens, answers aloud, then listens
   again. Say "stop" or click 🗣 to end it.
4. 🔊 reads every reply aloud. While it's speaking, click it to stop.

Choose your language, the voice and the speed in **Settings → Voice** (or the
language menu in Interact). Picking a language with its own voice downloads that
voice once (~38 MB). The microphone is only used while 🎤 or 🗣 is listening.
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

In Interact, press **G** or click **GESTURES OFF** to steer the orb with your
hands through the webcam:

- **Spin**: pinch your thumb and index finger together on one hand and move it.
- **Zoom**: pinch with both hands, then spread them apart to zoom in or bring
  them together to zoom out.
- Let go of the pinch to stop. Press **G** again to turn gestures and the camera off.

A small mirrored camera preview shows the hand points Scorpion sees and a status
line (how many hands, and whether you're spinning or zooming). Hand tracking uses
Google's MediaPipe hand landmarker, which runs inside Scorpion. The first time you
turn gestures on, Scorpion downloads its hand model once (about 8 MB); after that
it works offline.

The camera is off by default. It is only on while gestures are on, and goes off
when you leave Interact. Video stays on your computer and is never recorded or
sent anywhere. If the preview says the camera is blocked: on Windows, allow
**Settings → Privacy & security → Camera** ("Let desktop apps access your
camera"); on a Mac, allow Scorpion in **System Settings → Privacy & Security →
Camera**.

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
| `qwen2.5-7b` | Smarter, needs 16 GB RAM or a GPU | 4.7 GB |
| `llama3.2-3b` | Fast general chat | 2.0 GB |
| `qwen2.5-1.5b` | Low-memory computers | 1.0 GB |
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
and a tag on every model: ⚡ fast here (fits in graphics memory), 🐢 slower
here (part runs on the CPU), or ⛔ too big.

### Speed tips

- Pick a model tagged ⚡. On a 4 GB laptop GPU, Qwen3 4B Instruct writes about
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

Scorpion's design was informed by studying Jan (Apache-2.0, © Menlo Research).
Scorpion contains none of Jan's source code.
