---
name: write-documentation
description: "Write a README or how-to for a project: what it is, how to install, how to use it, from the real files."
---

1. Learn the project from its files, not from guesses: list_files, then read_file on `package.json` or `requirements.txt`, the main entry file and any existing docs.
2. Run what the README will tell people to run (install and start commands) with run_command, to be sure they work.
3. Write `README.md` with these parts: a one-line description, what it does (3 to 5 bullets), requirements, install, how to use it (a real example with its output), how to run the tests if there are any, and the licence if a file says one.
4. Use short sentences and copy-paste commands in code blocks. Do not promise features that are not in the code.
5. If a README exists, edit_file the parts that are wrong or missing instead of replacing all of it.
