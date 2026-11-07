---
title: Scorpion
colorFrom: yellow
colorTo: gray
sdk: docker
app_port: 7860
pinned: true
short_description: The offline AI assistant and agent, and Scorpion OS
---

# Scorpion

The website for Scorpion, the AI assistant and agent that runs on your own
computer: an app for Windows, Mac and Linux, your desktop, or Scorpion OS from a
USB stick.

This Space runs the site's Node server (see `Dockerfile`). Payments need these
Space secrets: `STRIPE_SECRET_KEY`, `DOWNLOAD_BASE_URL`, and `SITE_URL` (the
Space's public address, or your own domain). Without them, checkout shows that
payments aren't switched on yet.

The source lives in the `website` folder of
[dmotionstudio-stack/scorpion](https://github.com/dmotionstudio-stack/scorpion).
