// Copies the MediaPipe WASM runtime into public/ and downloads the pose model, so
// "Pose from photo" works without third-party requests at runtime.
// Runs on `npm install` (postinstall). Failures are reported, not fatal: until it has run, the
// app's "Pose from photo" says the detector is not installed.
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'mediapipe');
const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task';
const modelPath = join(outDir, 'pose_landmarker_full.task');

mkdirSync(join(outDir, 'wasm'), { recursive: true });

if (existsSync(wasmSrc)) {
  for (const f of readdirSync(wasmSrc)) copyFileSync(join(wasmSrc, f), join(outDir, 'wasm', f));
  console.log('[mediapipe] copied wasm runtime');
} else {
  console.warn('[mediapipe] @mediapipe/tasks-vision not installed; skipping wasm copy');
}

if (existsSync(modelPath) && !process.argv.includes('--force')) {
  console.log('[mediapipe] pose model already present');
} else {
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(modelPath, Buffer.from(await res.arrayBuffer()));
    console.log('[mediapipe] downloaded pose model');
  } catch (err) {
    console.warn(`[mediapipe] could not download pose model (${err.message}); run npm run setup:mediapipe once online`);
  }
}
