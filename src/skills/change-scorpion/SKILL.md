---
name: change-scorpion
description: "Change Scorpion itself: add or fix a feature in its own source, run its tests and restart it."
---

1. Call own_code to find the source folder. If this copy is the installed one (sealed), ask the user for the folder that holds Scorpion's source (the one with package.json and src/).
2. update_plan with short steps. Say which files you expect to change (the engine and tools are in src/main, the screens in src/renderer, tests in test/).
3. Read each file before you edit it. Make small, focused edits with edit_file and match the existing style. The user is asked to allow the folder first.
4. Add or update a test in test/ for what you changed.
5. Run `npm test` with run_command (subdir "."). Fix what fails; never weaken a test to pass it.
6. Tell the user what you changed in two or three lines, then call restart_scorpion last so the change loads (it asks first).
7. Never edit files outside Scorpion's source, and never touch the user's chats or settings files.
