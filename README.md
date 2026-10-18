# Kenzo

An offline AI assistant and agent for Windows and macOS. Kenzo runs open-weight
GGUF models on your own computer with llama.cpp. You don't need an API key, an
account, or an internet connection to chat.

- **Chat** with local models (Qwen, Llama, any GGUF file), with streaming and Markdown.
- **Agent**: Kenzo reads, writes and edits files and runs terminal commands inside a
  workspace folder you choose. Changes and commands wait for your approval unless
  you turn on Auto-approve.
- **Multi-step planning**: for bigger tasks the agent writes a plan, then updates it
  live as it works. Plan mode is read-only: it explores and plans but can't change anything.
- **Chat with documents**: you add PDF, Word or text files. Kenzo indexes them on your
  machine and the agent searches them and names its sources.
- **Private by design**: Kenzo stores data only in your OS app-data folder, makes no
  network calls while you chat, has a sandboxed UI and a locked-down IPC bridge.

Architecture notes, and what Kenzo learned from studying [Jan](https://github.com/janhq/jan),
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

Kenzo needs a model file once. You can get one in any of three ways:

1. **Download inside the app**: a one-time download from Hugging Face.
2. **Import**: on another computer, download a `.gguf` and copy it over on a USB
   drive, then use **Models → Import .gguf file**.
3. **Bundle it in the installer**: put `.gguf` files in `resources/models/` before you
   build. The installer then ships with the model, and Kenzo picks it automatically
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
| Windows | `npm run dist:win` | `release/Kenzo Setup x.y.z.exe` |
| macOS | `npm run dist:mac` (on a Mac) | `release/Kenzo-x.y.z-arm64.dmg` |

You can only build a macOS installer on a Mac. The included GitHub Actions workflow
(`.github/workflows/release.yml`) builds Windows, Apple Silicon and Intel Mac
installers in the cloud. Run it from the Actions tab and, if you want, list model
ids to bundle.

Unsigned builds show a warning on first launch. On Windows that's SmartScreen:
choose *More info → Run anyway*. On macOS that's Gatekeeper: right-click the app
and choose *Open*. To remove these warnings you need a code-signing certificate.

## Hardware acceleration

llama.cpp binaries come prebuilt, and Kenzo picks one automatically:

- macOS: Metal (Apple Silicon)
- Windows: CUDA (NVIDIA), Vulkan (AMD, Intel, NVIDIA), or CPU

The active backend is shown on the Models page.

## Tests

```bash
npm test
```

```bash
node scripts/e2e-agent.mjs path/to/chat.gguf path/to/embed.gguf
```

## Security model

- File tools resolve every path inside the workspace and follow symlinks, so the
  agent can't escape the folder.
- `write_file`, `edit_file` and `run_command` need your approval unless you turn on
  Auto-approve. Plan mode hides those tools from the model completely.
- `run_command` runs a real shell in the workspace folder. Approval is the only
  safeguard, so read commands before you allow them.
- The UI runs with `contextIsolation`, `sandbox` and a strict CSP, and has no Node access.

## License

Apache-2.0. Kenzo's design was informed by studying Jan (Apache-2.0, © Menlo Research).
Kenzo contains none of Jan's source code.
