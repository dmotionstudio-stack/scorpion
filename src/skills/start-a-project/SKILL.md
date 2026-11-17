---
name: start-a-project
description: "Set up a new project folder: structure, config, first file, version control and a test that runs."
---

1. Ask what kind of project it is and where to put it, if it is not clear. Use a new folder inside the workspace named in lowercase words with dashes.
2. update_plan with short steps. Pick the lightest setup that fits (a plain script, a Node project, a Python project, a static website).
3. Create the structure with write_file: a README with two lines, a `.gitignore` for the language, the entry file with a working "hello" version, and a `package.json` or `requirements.txt` when it has dependencies.
4. Install what it needs with install_package (npm or pip). Say which packages and why.
5. Start version control with run_command: `git init`, `git add .` and a first commit, if git is installed (check with `git --version`; if it is missing, offer to install it with install_package).
6. Run the first file to prove it works, and add a tiny test or sample run.
7. Finish with the folder tree, the command to run it and the next step to take.
