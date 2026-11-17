---
name: fix-a-bug
description: "Find and fix a bug in code: reproduce it, read the code, make the smallest fix and prove it with a run."
---

1. Reproduce first: run the failing command or test with run_command and read the exact error.
2. Find where it comes from: search_files for the error text or the function, then read_file around it. Read before you change anything.
3. Say in one sentence what is wrong and why.
4. Fix it with edit_file, the smallest change that solves the cause (not the symptom). Do not reformat or rewrite other code.
5. Run the same command or test again. If it still fails, read the new error and go back to step 2.
6. Run the other tests too, to be sure nothing else broke.
7. Finish with: the cause, the change (file and what), and the run that proves it.
