---
name: back-up-folder
description: "Copy a folder to a dated backup folder safely, and check that everything was copied."
---

1. Ask where the backup should go if the user did not say (another drive or a folder they name). Never put the backup inside the folder being backed up.
2. list_files the source and note how many files and folders are in it. Tell the user roughly how big it is when that can be seen.
3. Copy with copy_path into a new folder named `<folder>-backup-<year-month-day>`. Never overwrite an older backup: if the name exists, add " (2)".
4. list_files the copy and compare the count with the source. Report any file that is missing and why (in use, no permission, too long a path).
5. Finish with: what was copied, where it is, the count check, and how to restore it (copy it back). Never delete the original or any old backup.
