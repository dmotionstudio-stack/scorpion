---
name: analyze-spreadsheet
description: "Read a spreadsheet or CSV, calculate exactly and report trends, totals and odd values in a small table."
---

1. Look at the structure first with read_spreadsheet: sheets, columns, how many rows, what each column holds.
2. Say what you will measure (totals, averages, by category, over time) before you do it.
3. Never do arithmetic in your head: use calculator for a few numbers, or run_code (JavaScript) for many rows.
4. Check the data: empty cells, duplicates, text where numbers should be, extreme values. Say what you found and how you handled it.
5. Report in this shape: **In short** (one or two sentences), a Markdown table of the key numbers, then notable trends or oddities, then your assumptions.
6. If the user wants it saved, write a summary file next to the original (`<name>-analysis.md`).
