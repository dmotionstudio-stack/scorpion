---
name: build-an-app
description: "Build a program or app end to end: plan, write it, install what it needs, run it and fix it until it works."
---

1. update_plan with short steps. Pick the simplest tool that works (a JavaScript or Python script before a framework).
2. Write complete, runnable files in the workspace. Put how to start it in a `README.md` (two lines).
3. If a library is missing, install it with install_package (npm for JavaScript, pip for Python). Say which package and why in one line.
4. Run it with run_command or run_code. A program that keeps running (a server, a window) goes through start_server and server_logs.
5. If it fails, read the error, fix the cause, run it again. Never say it works without having run it.
6. Add one small check (a test or a sample run) so the user can see it works.
7. Finish with: what you built, the files, the command to start it, and what it does not do yet.
