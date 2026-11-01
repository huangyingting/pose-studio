import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import { withBase } from './paths';

/** The detector's runtime and model, served by the app itself (scripts/setup-mediapipe.mjs puts them there): nothing fetched from elsewhere. */
const LOCAL = { wasm: withBase('/mediapipe/wasm'), model: withBase('/mediapipe/pose_landmarker_full.task') };

export interface DetectedPerson {
  /** World landmarks in metres (MediaPipe frame: x right, y down, z away). */
  world: { x: number; y: number; z: number; visibility?: number }[];
  /** Normalised image landmarks (0..1). */
  image: { x: number; y: number; visibility?: number }[];
}

let landmarker: Promise<PoseLandmarker> | null = null;

async function exists(url: string) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

/*
 * MediaPipe Tasks sends usage statistics to Google every minute and offers no switch to turn
 * them off. The CSP would block the request anyway (with console errors); answer it locally
 * instead, so nothing about the user's photos or usage leaves the device.
 */
const TELEMETRY = 'https://odml.pa.googleapis.com/';
let telemetryBlocked = false;

function blockTelemetry() {
  if (telemetryBlocked || typeof window === 'undefined') return;
  telemetryBlocked = true;
  const original = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(TELEMETRY)) return Promise.resolve(new Response(null, { status: 204 }));
    return original(input, init);
  };
}

async function create(): Promise<PoseLandmarker> {
  blockTelemetry();
  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
  if (!(await exists(`${LOCAL.wasm}/vision_wasm_internal.wasm`)) || !(await exists(LOCAL.model))) throw new Error('The pose detector is not installed (npm run setup:mediapipe)');
  const src = LOCAL;
  const fileset = await FilesetResolver.forVisionTasks(src.wasm);
  const options = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath: src.model, delegate },
    runningMode: 'IMAGE' as const,
    numPoses: 4,
    minPoseDetectionConfidence: 0.4,
    minPosePresenceConfidence: 0.4,
  });
  try {
    return await PoseLandmarker.createFromOptions(fileset, options('GPU'));
  } catch {
    return PoseLandmarker.createFromOptions(fileset, options('CPU'));
  }
}

/** Detect up to four people in an image. The model (~9 MB) is loaded on first use. */
export async function detectPeople(image: HTMLImageElement | HTMLCanvasElement): Promise<DetectedPerson[]> {
  landmarker ??= create().catch((err) => {
    landmarker = null;
    throw err;
  });
  const result = (await landmarker).detect(image);
  return result.worldLandmarks.map((world, i) => ({ world, image: result.landmarks[i] ?? [] }));
}

export function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read the image'));
    img.src = src;
  });
}
