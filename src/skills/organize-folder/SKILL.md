---
name: organize-folder
description: "Tidy a messy folder (like Downloads) into subfolders by type or topic, safely and with a plan first."
---

1. list_files the folder (depth 1). Count files by kind: documents, images, videos, music, archives, installers, code, other.
2. Propose a layout with update_plan before moving anything, for example:
   `Documents/`, `Images/`, `Videos/`, `Music/`, `Archives/`, `Installers/`, `Other/`.
   Use the user's own folder names if they already exist. Say how many files go where.
3. Wait for the user to agree if more than 20 files would move, or if any file looks important (contracts, tax, IDs).
4. Move with move_file, one file per call. Never delete, rename or overwrite: if a file with the same name exists at the destination, add " (2)" before the extension.
5. Skip files in use or hidden/system files (names starting with "." or "~$").
6. Finish with a short table: folder, number of files moved, anything left in place and why.
