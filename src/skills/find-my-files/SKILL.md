---
name: find-my-files
description: "Find files and folders on this computer by name, type or content, and open them."
---

1. Use the exact folder paths listed in the prompt for "my downloads", "my pictures", "my documents" and the like.
2. Search by name with find_files (a part of the name is enough; add the file type when known). Search inside text files with search_files. List a folder with list_files.
3. If there are many matches, show the five most likely: name, folder, size and date. Ask which one rather than guessing.
4. Read what is needed with read_file, read_document (PDF, Word) or read_spreadsheet.
5. Open a file or folder for the user with open_path when they ask to see it.
6. Never move, rename or delete anything unless the user asked; changes need Build mode.
