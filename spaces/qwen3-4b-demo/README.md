---
title: Qwen3 4B Demo
colorFrom: yellow
colorTo: gray
sdk: gradio
sdk_version: 5.49.1
app_file: app.py
pinned: false
license: apache-2.0
short_description: Chat with Qwen3 4B, the model inside Scorpion
models:
  - unsloth/Qwen3-4B-Instruct-2507-GGUF
---

# Qwen3 4B demo

A chat demo of Qwen3 4B Instruct (the 4-bit `Q4_K_M` file, 2.5 GB) running on
the Space's CPU through llama.cpp. It's the same model
[Scorpion](https://github.com/dmotionstudio-stack/scorpion) recommends for
running an AI on your own computer, offline.

The first start downloads the model, so the Space takes a few minutes to wake.
Replies stream slowly on a shared CPU; on a laptop with a graphics card they are
much quicker.
