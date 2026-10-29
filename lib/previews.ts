import { LIBRARY, hasClip } from './assets';
import { loadThumb, saveThumb } from './assetstore';
import { fetchLibraryClips } from './librarymotions';
import { newAnimation } from './animation';
import { sceneAt } from './evaluate';
import { newFigure, newScene } from './doc';
import { bodyFor, modelTemplate } from './model';
import { builtInPoses, poseScene } from './poses';
import { angleAt, cameraAt, filmWith, newCamera, subjectAt, type CameraMove } from './cameras';
import { newShot } from './shots';
import { sharedRenderer } from './thumbnails';
import type { Lighting, PoseAsset, Scene, Style, View } from './types';

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
/** How long a preview waits for what it shows (a character's file) before giving up. */
const WAIT_MS = 15_000;

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
  const since = Date.now();
  const step = () => {
    if (stopped) return;
    if (job.ready && !job.ready()) {
      // Waited for long enough (a file that does not come: offline): no preview.
      if (Date.now() - since < WAIT_MS) later(() => setTimeout(step, 250));
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
      return sharedRenderer().renderShot(sceneAt(scene, t, true), W, H, LINE, { style, camera: cameraAt(scene, t, W / H) }).toDataURL('image/png');
    },
  };
}

/** A pose on a figure, framed to fit. */
export function posePreview(p: PoseAsset, style: Style): PreviewJob {
  return {
    key: `pose:${style}:${p.id}:${JSON.stringify(p.bones)}`,
    count: 1,
    frame: () => sharedRenderer().render(poseScene(p), W, H, LINE, { style, margin: 0.1, angle: p.view }).toDataURL('image/png'),
  };
}

/** A character: a figure drawn as it, standing (its file read first). */
export function characterPreview(id: string, style: Style): PreviewJob {
  const scene = newScene('Character', [newFigure({ model: id })]);
  return {
    key: `character:${style}:${id}`,
    count: 1,
    ready: () => !!modelTemplate(id),
    frame: () => sharedRenderer().render(scene, W, H, LINE, { style, margin: 0.1, angle: { yaw: 20, pitch: 4, fov: 30 } }).toDataURL('image/png'),
  };
}

/** A scene template: playing (followed by a camera), or its people as they stand. */
export function templatePreview(id: string, build: () => Scene, style: Style): PreviewJob {
  const key = `template:${style}:${id}`;
  const scene = build();
  if (scene.animation) {
    // (The Library's motions it plays, fetched first: a film's.)
    const clips = [...new Set(scene.animation.actions.flatMap((x) => (x.source.kind === 'clip' && x.source.clip.startsWith(LIBRARY) ? [x.source.clip] : [])))];
    void fetchLibraryClips(clips);
    return { ...filmed(key, () => filmWith(scene, 'static', { follow: true }), style), ready: () => clips.every(hasClip) };
  }
  return { key, count: 1, frame: () => sharedRenderer().render(scene, W, H, LINE, { style, margin: 0.1, angle: angleAt(scene) }).toDataURL('image/png') };
}

/** A lighting scheme: a figure in Clay lit by it, seen from the front-right (in the style it shows in). */
export function lightingPreview(id: string, lighting: Lighting): PreviewJob {
  return { key: `lighting:${id}`, count: 1, frame: () => sharedRenderer().render(lightingScene(lighting), W, H, LINE, { style: 'shaded', margin: 0.1, angle: LIGHTING_VIEW }).toDataURL('image/png') };
}

/** A lighting scheme's thumbnail. */
export const lightingThumb = (id: string, lighting: Lighting) => ({
  key: `lighting:${id}:${JSON.stringify(lighting)}`,
  make: () => sharedRenderer().render(lightingScene(lighting), 144, 144, 1.2, { style: 'shaded', margin: 0.08, angle: LIGHTING_VIEW }).toDataURL('image/png'),
});
const LIGHTING_VIEW = { yaw: 20, pitch: 10, fov: 30 };
const lightingScene = (lighting: Lighting): Scene => ({ ...poseScene(builtInPoses()[0]), lighting });

/** A set, a figure in it for its size, seen from in front and a little above (all of it). */
export function setPreview(id: string, style: Style): PreviewJob {
  return { key: `set:${style}:${id}`, count: 1, frame: () => sharedRenderer().render(setScene(id), W, H, LINE, { style, margin: 0.04, angle: SET_VIEW, wholeSet: true }).toDataURL('image/png') };
}

/** A set's thumbnail (in line art). */
export const setThumb = (id: string) => ({
  key: `set:${id}`,
  make: () => sharedRenderer().render(setScene(id), 144, 144, 1.1, { style: 'line', margin: 0.04, angle: SET_VIEW, wholeSet: true }).toDataURL('image/png'),
});
const SET_VIEW = { yaw: 20, pitch: 22, fov: 40 };
const setScene = (id: string): Scene => ({ ...newScene('Set', [newFigure()]), set: id });

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

/*
 * Thumbnails: small stills for the library's grids and rows (a pose, a template, a character), in
 * one neutral line style on a transparent background so they read in either theme and whatever
 * the film's style. Rendered when the page is idle, one at a time, and kept.
 */

const THUMB = 144;
const thumbs = new Map<string, string>();
const waiting = new Map<string, { make(): string; done: Set<(url: string) => void> }>();
let draining = false;
// When the page is idle (not waiting for long).
const idle = (fn: () => void) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 100 }) : setTimeout(fn, 0));

async function drain() {
  const next = waiting.entries().next();
  if (next.done) {
    draining = false;
    return;
  }
  const [key, job] = next.value;
  waiting.delete(key);
  try {
    // Kept from an earlier visit (this build's); or drawn now, and kept.
    const kept = await loadThumb(key);
    const url = kept ?? job.make();
    if (!kept) void saveThumb(key, url).catch(() => {});
    thumbs.set(key, url);
    job.done.forEach((fn) => fn(url));
  } catch (err) {
    // One that cannot be drawn (a template that fails to build) stays blank; the others still come.
    console.warn(`Could not draw the thumbnail ${key}:`, err);
  }
  idle(() => void drain());
}

/** A thumbnail: at once if it was drawn before, or later (`onUrl`). Returns a function that stops waiting. */
export function requestThumb(key: string, make: () => string, onUrl: (url: string) => void): () => void {
  const had = thumbs.get(key);
  if (had) {
    onUrl(had);
    return () => {};
  }
  const job = waiting.get(key) ?? { make, done: new Set() };
  job.done.add(onUrl);
  waiting.set(key, job);
  if (!draining) {
    draining = true;
    idle(() => void drain());
  }
  return () => job.done.delete(onUrl);
}

/** A scene as a thumbnail, from an angle. */
export function drawThumb(scene: Scene, angle: View) {
  return sharedRenderer().render(scene, THUMB, THUMB, 1.2, { style: 'line', transparent: true, margin: 0.08, angle }).toDataURL('image/png');
}

/** A pose's thumbnail: its key and how to draw it. */
export const poseThumb = (p: PoseAsset) => ({ key: `pose:${p.id}:${JSON.stringify(p.bones)}`, make: () => drawThumb(poseScene(p), p.view) });

/** A template's: its people as they start, from the angle it is filmed from. */
export const templateThumb = (id: string, build: () => Scene) => ({
  key: `template:${id}`,
  make: () => {
    const scene = build();
    return drawThumb(scene.animation ? sceneAt(scene, 0) : scene, angleAt(scene));
  },
});

/** A character's (drawn when its file is here: the mannequin's always, an imported one's as it is imported). */
export const characterThumb = (id: string | null) => ({
  key: `character:${id ?? 'mannequin'}`,
  make: () => {
    const f = newFigure();
    return drawThumb(newScene('Character', [id ? { ...f, model: id, body: bodyFor(f, id) } : f]), { yaw: 20, pitch: 4, fov: 30 });
  },
});
