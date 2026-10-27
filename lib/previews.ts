import { newAnimation } from './animation';
import { sceneAt } from './evaluate';
import { poseScene } from './poses';
import { cameraAt, filmWith, type CameraMove } from './shot';
import { newShot } from './shots';
import { sharedRenderer } from './thumbnails';
import type { PoseAsset, Scene, Style } from './types';

/*
 * Previews for the library, shown while the pointer rests on an item: a pose as a still, a
 * motion playing (filmed by its own camera), and a camera move filming the open scene, so you see
 * what an item does before you use it. Frames are rendered off-screen one at a time (the page
 * stays responsive, the first shows at once) and kept once complete.
 */

const W = 200;
const H = 240;
const FRAMES = 12;
const LINE = 1.4;

export const PREVIEW_SIZE = { width: W, height: H };

/** A preview to render: how many frames, and how to draw each (as an image URL). */
export interface PreviewJob {
  key: string;
  count: number;
  frame(i: number): string;
}

const done = new Map<string, string[]>();

/**
 * Render a preview's frames, a frame per task, handing them over as they come (all at once if
 * it was rendered before). Returns a function that stops it.
 */
export function runPreview(job: PreviewJob, onFrames: (frames: string[]) => void): () => void {
  const cached = done.get(job.key);
  if (cached) {
    onFrames(cached);
    return () => {};
  }
  const frames: string[] = [];
  let stopped = false;
  // When the page is idle: playback, dragging and typing come first.
  const later = (fn: () => void) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 200 }) : setTimeout(fn, 0));
  const step = () => {
    if (stopped) return;
    frames.push(job.frame(frames.length));
    onFrames([...frames]);
    if (frames.length < job.count) later(step);
    else done.set(job.key, frames);
  };
  later(step);
  return () => {
    stopped = true;
  };
}

/** Frames of an animated scene through its shot camera, evenly over its length. */
function filmed(key: string, make: () => Scene, style: Style): PreviewJob {
  let scene: Scene | null = null;
  return {
    key,
    count: FRAMES,
    frame(i) {
      scene ??= make();
      const a = scene.animation!;
      const t = (a.duration * i) / (a.loop ? FRAMES : FRAMES - 1);
      return sharedRenderer().renderShot(sceneAt(scene, t), W, H, LINE, { style, faces: true, camera: cameraAt(scene, t, W / H) }).toDataURL('image/png');
    },
  };
}

/** A pose on a figure, framed to fit. */
export function posePreview(p: PoseAsset, style: Style): PreviewJob {
  return {
    key: `pose:${style}:${p.id}:${JSON.stringify(p.bones)}`,
    count: 1,
    frame: () => sharedRenderer().render(poseScene(p), W, H, LINE, { style, faces: true, margin: 0.1 }).toDataURL('image/png'),
  };
}

/** A motion playing, filmed by the camera it comes with. */
export function motionPreview(id: string, build: () => Scene, style: Style): PreviewJob {
  return filmed(`motion:${style}:${id}`, build, style);
}

const sceneIds = new WeakMap<Scene, number>();
let nextScene = 0;

/** A camera move filming the open scene (a still scene for a few seconds). */
export function cameraPreview(move: CameraMove, scene: Scene, style: Style): PreviewJob {
  if (!sceneIds.has(scene)) sceneIds.set(scene, nextScene++);
  return filmed(`camera:${style}:${move.id}:${sceneIds.get(scene)}`, () => {
    const anim = scene.animation ?? { ...newAnimation(scene, 3), loop: false };
    // One shot over the whole animation (about the subject of the shot at its start), filmed by this move.
    const { shots, ...whole } = anim;
    const subject = shots?.[0]?.subject;
    return filmWith({ ...scene, animation: { ...whole, shots: [{ ...newShot(0, 'Shot 1', 'main'), ...(subject ? { subject } : {}) }] } }, move.id);
  }, style);
}
