"""Chat with Qwen3 4B Instruct, the model Scorpion recommends, running on this
Space's CPU through llama.cpp. Nothing is sent to another service."""

import os

import gradio as gr
from huggingface_hub import hf_hub_download
from llama_cpp import Llama

REPO = "unsloth/Qwen3-4B-Instruct-2507-GGUF"
FILE = "Qwen3-4B-Instruct-2507-Q4_K_M.gguf"  # the same 2.5 GB file Scorpion downloads

model_path = hf_hub_download(REPO, FILE)
llm = Llama(model_path=model_path, n_ctx=4096, n_threads=os.cpu_count() or 2, verbose=False)

SYSTEM = (
    "You are a helpful assistant running as Qwen3 4B Instruct on a small CPU, "
    "the same model Scorpion uses on people's own computers. Answer clearly and briefly."
)


def reply(message, history):
    messages = [{"role": "system", "content": SYSTEM}]
    for turn in history:
        if isinstance(turn.get("content"), str):
            messages.append({"role": turn["role"], "content": turn["content"]})
    messages.append({"role": "user", "content": message})

    text = ""
    for chunk in llm.create_chat_completion(
        messages=messages, max_tokens=512, temperature=0.7, stream=True
    ):
        delta = chunk["choices"][0]["delta"].get("content")
        if delta:
            text += delta
            yield text


demo = gr.ChatInterface(
    reply,
    type="messages",
    title="Qwen3 4B, the model inside Scorpion",
    description=(
        "A small open model answering on a shared CPU, so replies are slower than on "
        "your own computer. [Scorpion](https://github.com/dmotionstudio-stack/scorpion) "
        "runs it offline on Windows, Mac and Linux."
    ),
    examples=[
        "Explain what a USB-bootable operating system is in two sentences.",
        "Write a Python function that sorts a folder's files by extension.",
        "Give me three tips for writing a clear email.",
    ],
)

if __name__ == "__main__":
    demo.launch()
