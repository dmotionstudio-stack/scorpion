import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainLoadFailure } from '../src/main/engine.js';

// The lines llama.cpp printed for a real file that wouldn't load
// (a Qwen3.5 "vision" GGUF converted for another engine version).
const VISION = [
  'llama_model_load: error loading model: error loading model hyperparameters: key qwen35.rope.dimension_sections has wrong array length; expected 4, got 3',
  'llama_model_load_from_file_impl: failed to load model',
];

test('a file made for another engine version says so, and that it is not damaged', () => {
  const m = explainLoadFailure(VISION, 'Qwen3.5-9B-vision');
  assert.match(m, /^Qwen3\.5-9B-vision was made for a different version of the engine/);
  assert.match(m, /rope\.dimension_sections has wrong array length; expected 4, got 3/);
  assert.match(m, /not damaged/);
  assert.match(m, /text-only version/);
  assert.doesNotMatch(m, /download it again|damaged or incomplete/);
});

test('an architecture the engine does not know', () => {
  const m = explainLoadFailure(["llama_model_load: error loading model: error loading model architecture: unknown model architecture: 'qwen4moe'", 'llama_model_load_from_file_impl: failed to load model'], 'Qwen4');
  assert.match(m, /Qwen4 is a "qwen4moe" model/);
  assert.match(m, /newer Scorpion/);
});

test('too big for the memory, with the graphics card or without', () => {
  for (const line of ['ggml_vulkan: Device memory allocation of size 1066410496 failed.', 'ggml_backend_buft_alloc_buffer: failed to allocate CPU buffer of size 18000000000', 'ggml_vulkan: vk::Device::allocateMemory: ErrorOutOfDeviceMemory']) {
    assert.match(explainLoadFailure([line, 'llama_model_load_from_file_impl: failed to load model'], 'Big'), /needs more memory than this computer can give it/);
  }
});

test('a model that loads but whose working memory (context) does not fit says so and what to lower', () => {
  for (const line of ['Failed to create context', 'llama_init_from_model: failed to initialize the context: failed to allocate compute pp buffers']) {
    const m = explainLoadFailure(['ggml_vulkan: Device memory allocation of size 542117888 failed.', line], 'Defiant');
    assert.match(m, /^Defiant loads, but there isn't enough memory left for its working space/);
    assert.match(m, /Lower the context size/);
  }
});

test('extra parts built into the file (vision, prediction heads) are named as the likely cause', () => {
  const m = explainLoadFailure(['llama_model_load: error loading model: done_getting_tensors: wrong number of tensors; expected 883, got 427', 'llama_model_load_from_file_impl: failed to load model'], 'WithVision');
  assert.match(m, /has parts the engine doesn't expect/);
  assert.match(m, /text-only version/);
});

test('a cut-off or damaged file is still called damaged, and only then', () => {
  for (const line of ['gguf_init_from_file_impl: invalid magic characters', 'llama_model_loader: tensor data is not within file bounds, model is corrupted or incomplete']) {
    assert.match(explainLoadFailure([line, 'failed to load model'], 'Half'), /looks damaged or incomplete/);
  }
});

test('anything else keeps llama.cpp\'s own words, and with no words still says something useful', () => {
  assert.match(explainLoadFailure(['llama_model_load: error loading model: some new complaint nobody has seen', 'failed to load model'], 'X'), /^X could not be loaded: some new complaint nobody has seen/);
  assert.match(explainLoadFailure([], 'Y'), /^Y could not be loaded\. If the file is fine/);
});
