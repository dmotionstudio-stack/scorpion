---
name: review-code
description: "Review code for bugs, risks and clarity, and list concrete problems with fixes, ranked by importance."
---

1. Read what is being reviewed: read_file for each file, list_files to see the whole project. Run it or its tests (run_command) when that is possible, so you review facts and not guesses.
2. Look for, in this order: bugs and wrong results, crashes and unhandled errors, security problems (user input in commands or paths, secrets in code, unsafe downloads), missing checks, then clarity and style.
3. Report each problem as: **where** (file and line), **what is wrong**, **why it matters**, **the fix** in one or two lines. Rank them: must fix, should fix, nice to have.
4. Say what is good in one line. If there is nothing wrong, say that plainly; do not invent problems.
5. This is read only: change nothing unless the user asks you to fix them.
