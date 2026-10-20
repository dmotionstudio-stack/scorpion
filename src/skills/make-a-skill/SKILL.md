---
name: make-a-skill
description: "How to write a good new skill when the user teaches you a procedure or asks you to remember how to do a job."
---

A skill is a reusable recipe. Write one when the user explains how they want a recurring job done, or after you finish a multi-step task they say they will ask for again.

1. Name it with two to four lowercase words joined by dashes, naming the job: `weekly-sales-report`, `resize-photos-for-web`.
2. Description: one sentence that says what it does and when to use it. This is all you will see later when deciding to use it, so include the words the user would say.
3. Instructions: numbered steps, each one action. Name the tools to use, the files or folders involved, the exact output format, and the checks to do before finishing.
4. Put the user's preferences in the steps (tone, file names, where to save), not just the general method.
5. Leave out anything secret (passwords, keys) and anything true only for today.
6. Save it with save_skill. To improve an existing skill, call use_skill to read it first, then save_skill with the same name and the full new text.
