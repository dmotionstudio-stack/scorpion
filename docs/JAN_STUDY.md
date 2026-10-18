# Studying Jan (janhq/jan) — what Scorpion borrows

Jan is Apache-2.0 licensed (Copyright Menlo Research). Scorpion contains **no Jan
source code**; it re-implements the ideas below in its own Electron/Node code.
The shallow clone used for study lives in `_reference/jan` (not shipped).

## 1. Jan's shape

| Layer | Jan | Scorpion equivalent |
|---|---|---|
| Desktop shell | Tauri 2 (Rust) — `src-tauri/` | Electron (Node) — `src/main/` |
| UI | React + Vite — `web-app/` | Vanilla JS, no build step — `src/renderer/` |
| Plugin API | `core/` + `extensions/*` (llamacpp, rag, vector-db, assistant, conversational, download) | Plain modules: `engine.js`, `rag.js`, `models.js`, `store.js` |
| Local inference | Downloads a `llama-server` binary per OS/GPU and spawns it as a child process, talks OpenAI HTTP (`extensions/llamacpp-extension`, `plugins/tauri-plugin-llamacpp/process.rs`) | `node-llama-cpp` — llama.cpp compiled as a Node addon, prebuilt for Win x64/arm64 (CPU, CUDA, Vulkan) and macOS (Metal). No subprocess, no HTTP port |
| Agent loop | `src-tauri/src/core/agent/loop.rs` (12k lines): OpenAI tool-call loop, compaction, subagents, MCP | `agent.js`: node-llama-cpp function calling (grammar-constrained, so small local models emit valid JSON) |
| Permissions | `tauri-plugin-agent-tools/permissions.rs`: allow / deny / read-only defaults, deny wins, glob lists | `agent.js`: tools tagged `read` / `write` / `exec`; `write`+`exec` require an approval prompt unless auto-approve is on |
| Planning | `agent/plan.rs` read-only *plan mode* + `todo` tool | `update_plan` tool streamed to a live plan panel, plus a Plan-mode toggle that hides mutating tools |
| Sandboxing | `tools/jail.rs`, `sandbox.rs`: tools confined to a project root | All file tools resolve paths inside the chosen workspace and refuse escapes |
| RAG | `rag-extension` (chunk size/overlap in chars) + `vector-db` plugin (SQLite, cosine similarity on LE-byte vectors) + `parser.rs` (PDF/DOCX/text) | `rag.js`: chunk → local GGUF embedding model → JSON vector store with cosine search; PDF via `unpdf`, DOCX via `mammoth` |
| Threads | `conversational-extension`, JSON files in the data folder | `store.js`: one JSON file per thread in `userData/threads` |
| Models | Hub + downloader extension, GGUF metadata reader | `models.js`: curated catalog, one-time HF download *or* import a `.gguf` from disk / USB, or bundle in the installer |

## 2. Lessons taken from Jan

1. **Keep the engine behind one interface.** Jan's extensions all talk to an
   abstract engine; swapping llama.cpp ↔ MLX is a config change. Scorpion's
   `engine.js` is the only file that imports `node-llama-cpp`.
2. **Deny wins, mutations need consent.** Jan's gate classifies tools and
   blocks mutations in plan mode at the dispatcher — not just in the prompt.
   Scorpion does the same: plan mode removes write/exec tools from the list the
   model is even shown.
3. **Confine the agent to a root.** Every path is resolved and checked against
   the workspace before any fs call.
4. **Chunk by characters with overlap**, store vectors next to their source
   file id + order so citations can point back to the file.
5. **Offline means "no network at runtime"**, not "no model file". Jan still
   needs a GGUF on disk. Scorpion supports three offline paths: bundle the model
   in the installer, import a file you copied over, or download once.

## 3. What Scorpion deliberately skips (for now)

MCP servers, subagents, context compaction, MLX backend, remote providers,
mobile builds. All are visible in Jan's tree if we want them later
(`agent/compaction.rs`, `agent/subagent.rs`, `core/mcp/`).
