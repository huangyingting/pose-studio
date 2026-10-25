import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import { withBase } from './paths';

const LOCAL = { wasm: withBase('/mediapipe/wasm'), model: withBase('/mediapipe/pose_landmarker_full.task') };
const CDN = {
  wasm: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm',
  model: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
};

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

async function create(): Promise<PoseLandmarker> {
  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
  const local = (await exists(`${LOCAL.wasm}/vision_wasm_internal.wasm`)) && (await exists(LOCAL.model));
  const src = local ? LOCAL : CDN;
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
