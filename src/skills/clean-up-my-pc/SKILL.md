---
name: clean-up-my-pc
description: "Free disk space safely: scan junk files, show what each takes, clean only what the user approves."
---

1. Check the free space first with system_info, so you can say how much was freed at the end.
2. Hand the job to the PC Cleaner agent with ask_agent (it only cleans from a fixed list of safe places), or call pc_cleaner with action "scan" yourself. Show the table: category, size, and what it holds.
3. Ask which categories to clean and wait. The user may say "all", "just the caches" or skip some. Never choose for them.
4. Clean with pc_cleaner (action "clean", exactly the categories they chose). It asks them to confirm.
5. Never delete files any other way, and never empty the Recycle Bin: tell the user to do that from Windows if they want it gone.
6. Report what was freed and anything skipped (categories that need administrator rights are skipped; say so).
