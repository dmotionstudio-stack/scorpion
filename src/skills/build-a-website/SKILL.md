---
name: build-a-website
description: "Build a website or web page from an idea: plan, write the files, open it in the preview and fix what is wrong."
---

1. Ask one short question only if the goal is unclear (what is it for, what should it say). Otherwise start.
2. update_plan with 4 to 6 short steps: structure, content, style, behavior, check.
3. Write complete files in the workspace: `index.html`, `style.css` and `script.js` (or one file when it is small). Semantic HTML, responsive (works on a phone width), no external files unless the user asked. Real text, not "lorem ipsum".
4. start_server with `python -m http.server 8000` (or `npx serve`), then open_preview. Never use run_command for a server.
5. check_preview. Read the errors and the page text. Fix every error, then reload with open_preview and check again. Do this until the page has no errors and shows what was asked.
6. Finish with a short summary: the files, how to open the site, and what you would improve next.
