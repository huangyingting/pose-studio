import { newAnimation } from './animation';
import { sceneAt } from './evaluate';
import { newFigure, newScene } from './doc';
import { modelTemplate } from './model';
import { poseScene } from './poses';
import { angleAt, cameraAt, filmWith, newCamera, subjectAt, type CameraMove } from './cameras';
import { newShot } from './shots';
import { sharedRenderer } from './thumbnails';
import type { PoseAsset, Scene, Style } from './types';

/*
 * Previews for the library, shown while the pointer rests on an item: a pose as a still, a
 * motion playing (followed by a camera), and a camera move filming the open scene, so you see
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
  /** Whether it can be drawn yet (a character whose file is still coming): waited for. */
  ready?(): boolean;
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
    if (job.ready && !job.ready()) {
      later(step);
      return;
    }
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
    frame: () => sharedRenderer().render(poseScene(p), W, H, LINE, { style, faces: true, margin: 0.1, angle: p.view }).toDataURL('image/png'),
  };
}

/** A character: a figure drawn as it, standing (its file read first). */
export function characterPreview(id: string, style: Style): PreviewJob {
  const scene = newScene('Character', [newFigure({ model: id })]);
  return {
    key: `character:${style}:${id}`,
    count: 1,
    ready: () => !!modelTemplate(id),
    frame: () => sharedRenderer().render(scene, W, H, LINE, { style, faces: true, margin: 0.1, angle: { yaw: 20, pitch: 4, fov: 30 } }).toDataURL('image/png'),
  };
}

/** A scene template: playing (followed by a camera), or its people as they stand. */
export function templatePreview(id: string, build: () => Scene, style: Style): PreviewJob {
  const key = `template:${style}:${id}`;
  const scene = build();
  if (scene.animation) return filmed(key, () => filmWith(scene, 'static', { follow: true }), style);
  return { key, count: 1, frame: () => sharedRenderer().render(scene, W, H, LINE, { style, faces: true, margin: 0.1, angle: angleAt(scene) }).toDataURL('image/png') };
}

/** A motion playing, followed by a camera from its scene's angle. */
export function motionPreview(id: string, build: () => Scene, style: Style): PreviewJob {
  return filmed(`motion:${style}:${id}`, () => filmWith(build(), 'static', { follow: true }), style);
}

const sceneIds = new WeakMap<Scene, number>();
let nextScene = 0;

/** A camera move filming the open scene (a still scene for a few seconds). */
export function cameraPreview(move: CameraMove, scene: Scene, style: Style): PreviewJob {
  if (!sceneIds.has(scene)) sceneIds.set(scene, nextScene++);
  return filmed(`camera:${style}:${move.id}:${sceneIds.get(scene)}`, () => {
    const anim = scene.animation ?? { ...newAnimation(scene, 3), loop: false };
    // One shot over the whole animation (on the subject of the camera at its start), filmed by this
    // move, from the angle it is filmed from now.
    const subject = subjectAt(scene, 0);
    const cam = { ...newCamera(scene), id: 'preview', ...(subject ? { subject } : {}) };
    const base = angleAt(scene, 0);
    return filmWith({ ...scene, cameras: [cam], animation: { ...anim, shots: [newShot(0, 'Shot 1', cam.id, 'main')] } }, move.id, { base });
  }, style);
}
