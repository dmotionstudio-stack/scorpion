---
name: make-a-mod
description: "Change the installed Scorpion with a mod: a small change in its data folder that is checked, kept in versions and can be undone."
---

1. Call own_code. It gives the mods folder and the file layout. Call mod_list to see what is already there.
2. Pick the smallest mod that does the job: `style.css` for how something looks, `renderer.js` for a change in the screens (it is the body of a function with `scorpion` and `mod`), `main.mjs` for something inside Scorpion (`export default function (api) { ... }`).
3. Write the files with write_file at the full path `<mods folder>/<name>/<file>`. Use a short lowercase name with dashes. Add `mod.json` with a one-line `{ "description": "..." }`.
4. Call mod_apply with the name. If it reports a syntax error, fix that file and apply again. The screens reload by themselves; a `main.mjs` loads at the next restart.
5. Look at the result (check_preview does not show Scorpion's own screens: ask the user to look, or read what the mod logged). If it is wrong, call mod_rollback.
6. Never write a mod that deletes the user's files, changes their settings files or hides how to turn it off. If Scorpion fails to start twice, it starts in safe mode with mods off and puts them back as they were: tell the user this when the change is a risky one.
7. Tell the user what the mod does, its name, and that Settings → System → Mods can turn it off or roll it back.
