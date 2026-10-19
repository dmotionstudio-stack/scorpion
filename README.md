# Scorpion

An offline AI assistant and agent for Windows and macOS. Scorpion runs open-weight
GGUF models on your own computer with llama.cpp. You don't need an API key, an
account, or an internet connection to chat.

- **Chat** with local models (Qwen, Llama, any GGUF file), with streaming and Markdown.
- **Agent**: Scorpion reads, writes and edits files and runs terminal commands inside a
  workspace folder you choose. Changes and commands wait for your approval unless
  you turn on Auto-approve.
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
- **Private by design**: Scorpion stores data only in your OS app-data folder, makes no
  network calls while you chat, has a sandboxed UI and a locked-down IPC bridge.

Architecture notes, and what Scorpion learned from studying [Jan](https://github.com/janhq/jan),
are in [docs/JAN_STUDY.md](docs/JAN_STUDY.md).

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
| macOS | `npm run dist:mac` (on a Mac) | `release/Scorpion-x.y.z-arm64.dmg` |

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

- File tools resolve every path inside the workspace and follow symlinks, so the
  agent can't escape the folder.
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

Apache-2.0. Scorpion's design was informed by studying Jan (Apache-2.0, © Menlo Research).
Scorpion contains none of Jan's source code.
