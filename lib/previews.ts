import { LIBRARY, clipsPlayedIn, hasClip } from './assets';
import { loadThumb, saveThumb } from './assetstore';
import { fetchLibraryClips } from './librarymotions';

import { sceneAt } from './evaluate';
import { newFigure, newScene } from './doc';
import { bodyFor, modelTemplate } from './model';
import { builtInPoses, poseScene } from './poses';
import { angleAt, cameraAt, filmWith } from './cameras';

import { withBase } from './paths';
import { setFurnished } from './sets';
import { SCENE_TEMPLATES } from './templates';
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

/** A character: a figure drawn as it (the mannequin: null), standing (its file read first). */
export function characterPreview(id: string | null, style: Style): PreviewJob {
  const scene = newScene('Character', [newFigure(id ? { model: id } : {})]);
  return {
    key: `character:${style}:${id ?? 'mannequin'}`,
    count: 1,
    ready: () => !id || !!modelTemplate(id),
    frame: () => sharedRenderer().render(scene, W, H, LINE, { style, margin: 0.1, angle: { yaw: 20, pitch: 4, fov: 30 } }).toDataURL('image/png'),
  };
}

/** A scene template: playing (followed by a camera), or its people as they stand. */
export function templatePreview(id: string, build: () => Scene, style: Style): PreviewJob {
  const key = `template:${style}:${id}`;
  const scene = build();
  if (scene.animation) {
    // (The Library's motions it plays, fetched first: a staged one's.)
    const clips = clipsPlayedIn([scene]).filter((id) => id.startsWith(LIBRARY));
    void fetchLibraryClips(clips);
    return { ...filmed(key, () => filmWith(scene, 'static', { follow: true }), style), ready: () => clips.every(hasClip) };
  }
  return { key, count: 1, frame: () => sharedRenderer().render(scene, W, H, LINE, { style, margin: 0.1, angle: angleAt(scene) }).toDataURL('image/png') };
}

/** A lighting scheme: a figure in Clay lit by it, seen from the front-right (in the style it shows in). */
export function lightingPreview(id: string, lighting: Lighting): PreviewJob {
  return { key: `lighting:${id}`, count: 1, frame: () => sharedRenderer().render(lightingScene(lighting), W, H, LINE, { style: 'shaded', margin: 0.1, angle: LIGHTING_VIEW }).toDataURL('image/png') };
}

/** Built-in thumbnails drawn here all the same (?draw-thumbs): how `npm run thumbs` takes them from the app. */
const drawThumbs = () => typeof location !== 'undefined' && new URLSearchParams(location.search).has('draw-thumbs');

/** A lighting scheme's thumbnail: made by `npm run thumbs` (drawn here with ?draw-thumbs, as for a template's). */
export const lightingThumb = (id: string, lighting: Lighting): { url: string } | { key: string; make(): string } =>
  drawThumbs()
    ? { key: `lighting:${id}:${JSON.stringify(lighting)}`, make: () => sharedRenderer().render(lightingScene(lighting), 144, 144, 1.2, { style: 'shaded', margin: 0.08, angle: LIGHTING_VIEW }).toDataURL('image/png') }
    : { url: withBase(`/lighting/thumbs/${id}.webp`) };
const LIGHTING_VIEW = { yaw: 20, pitch: 10, fov: 30 };
const lightingScene = (lighting: Lighting): Scene => ({ ...poseScene(builtInPoses()[0]), lighting });

/** A set, a figure in it for its size, seen from in front and a little above (all of it). */
export function setPreview(id: string, style: Style): PreviewJob {
  return { key: `set:${style}:${id}`, count: 1, ready: () => setFurnished(id), frame: () => sharedRenderer().render(setScene(id), W, H, LINE, { style, margin: 0.04, angle: SET_VIEW, wholeSet: true }).toDataURL('image/png') };
}

/**
 * A set's thumbnail: its preview in line art with all its models (or its scene) in, made by `npm run
 * set-thumbs` (drawn here, it would fetch every set's models to show the Library's grid).
 */
export const setThumb = (id: string) => ({ url: withBase(`/sets/thumbs/${id}.webp`) });
const SET_VIEW = { yaw: 20, pitch: 22, fov: 40 };
const setScene = (id: string): Scene => ({ ...newScene('Set', [newFigure()]), set: id });

/** A motion playing, followed by a camera from its scene's angle. */
export function motionPreview(id: string, build: () => Scene, style: Style): PreviewJob {
  return filmed(`motion:${style}:${id}`, () => filmWith(build(), 'static', { follow: true }), style);
}

/*
 * Thumbnails: small stills for the library's grids and rows (a pose, a template, a character), in
 * one neutral line style on a transparent background so they read in either theme and whatever
 * the project's style. Rendered when the page is idle, one at a time, and kept.
 */

const THUMB = 144;
const thumbs = new Map<string, string>();
/**
 * (`ready`: whether what it shows has come, a set's models: waited for from its turn (`since`). Not
 * come in WAIT_MS, it is drawn as it is for now (`shown`), not kept, and drawn again and kept when it
 * has come; given up on, unkept, after THUMB_GIVE_UP. `kept`: what an earlier visit kept, once looked for.)
 */
interface ThumbJob { make(): string; ready?(): boolean; since?: number; shown?: boolean; kept?: string | null; done: Set<(url: string) => void> }
/** How long a thumbnail drawn before what it shows has come is waited on, to be drawn again (ms from its turn). */
const THUMB_GIVE_UP = 120_000;
const waiting = new Map<string, ThumbJob>();
let draining = false;
// When the page is idle (not waiting for long).
const idle = (fn: () => void) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 100 }) : setTimeout(fn, 0));

function finish(key: string, job: ThumbJob, url: string) {
  waiting.delete(key);
  thumbs.set(key, url);
  job.done.forEach((fn) => fn(url));
}

async function drain() {
  for (const [key, job] of waiting) {
    try {
      // Kept from an earlier visit (this build's): at once, whatever it shows still to come.
      if (job.kept === undefined) {
        job.kept = await loadThumb(key);
        if (job.kept) {
          finish(key, job, job.kept);
          return idle(() => void drain());
        }
      }
      // Else drawn, and kept, once what it shows has come (its set's models…). (Waited for from its
      // turn: those before it, drawn slowly, do not use up its wait. With ?draw-thumbs, for as long
      // as it takes: what `npm run thumbs` ships is never drawn without them.)
      if (job.ready && !job.ready()) {
        const waited = Date.now() - (job.since ??= Date.now());
        if (waited >= THUMB_GIVE_UP && !drawThumbs()) { waiting.delete(key); continue; }
        if (job.shown || waited < WAIT_MS || drawThumbs()) continue;
        // (Shown as it is for now, not kept: drawn again when it has come.)
        job.shown = true;
        const url = job.make();
        job.done.forEach((fn) => fn(url));
        return idle(() => void drain());
      }
      const url = job.make();
      void saveThumb(key, url).catch(() => {});
      finish(key, job, url);
    } catch (err) {
      // One that cannot be drawn (a template that fails to build) stays blank; the others still come.
      waiting.delete(key);
      console.warn(`Could not draw the thumbnail ${key}:`, err);
    }
    return idle(() => void drain());
  }
  // (Those left wait for what they show.)
  if (waiting.size) setTimeout(() => idle(() => void drain()), 250);
  else draining = false;
}

/** A thumbnail: at once if it was drawn before, or later (`onUrl`). Returns a function that stops waiting. */
export function requestThumb(key: string, make: () => string, onUrl: (url: string) => void, ready?: () => boolean): () => void {
  const had = thumbs.get(key);
  if (had) {
    onUrl(had);
    return () => {};
  }
  const job: ThumbJob = waiting.get(key) ?? { make, ...(ready ? { ready } : {}), done: new Set() };
  job.done.add(onUrl);
  waiting.set(key, job);
  if (!draining) {
    draining = true;
    idle(() => void drain());
  }
  // (No longer waited for by anyone, a grid closed or scrolled away: not drawn.)
  return () => {
    job.done.delete(onUrl);
    if (!job.done.size && waiting.get(key) === job) waiting.delete(key);
  };
}

/** A scene as a thumbnail, from an angle (`people`: framing them only, what is round them cropped). */
function drawThumb(scene: Scene, angle: View, people = false) {
  return sharedRenderer().render(scene, THUMB, THUMB, 1.2, { style: 'line', transparent: true, margin: 0.08, angle, people }).toDataURL('image/png');
}

/** A pose's thumbnail: its key and how to draw it. */
export const poseThumb = (p: PoseAsset) => ({ key: `pose:${p.id}:${JSON.stringify(p.bones)}`, make: () => drawThumb(poseScene(p), p.view) });

/**
 * A template's: its people as they start, from the angle it is filmed from. The built-in ones' (but
 * people standing together: two, and no set) are made by `npm run thumbs`: drawn here,
 * their sets would hold the page up for seconds where the GPU is slow or there is none. Drawn here
 * all the same with ?draw-thumbs, which is how that takes them from the app.
 */
export function templateThumb(id: string, build: () => Scene): { url: string } | { key: string; make(): string; ready(): boolean } {
  if (SCENE_TEMPLATES.some((t) => t.id === id && t.group !== 'Standing together') && !drawThumbs()) return { url: withBase(`/templates/thumbs/${id}.webp`) };
  // (Made as the app makes it, its Library motions to hand first: a staged one times what its
  // people do by them. Then drawn once what it shows has come: its set's models and its people's
  // characters, each fetched now. Drawn without them, it would be kept so: a mannequin is another
  // shape, and what is cut away for them to be seen another too.)
  let scene: Scene | null = null;
  const built = () => (scene ??= build());
  const ready = () => {
    const missing = clipsPlayedIn([built()]).filter((c) => c.startsWith(LIBRARY) && !hasClip(c));
    if (missing.length) {
      void fetchLibraryClips(missing).then(() => { scene = null; });
      return false;
    }
    const cast = built().figures.every((f) => !f.model || !!modelTemplate(f.model));
    return cast && (!built().set || setFurnished(built().set!));
  };
  return {
    key: `template:${id}`,
    ready,
    make: () => drawThumb(built().animation ? sceneAt(built(), 0) : built(), angleAt(built()), true),
  };
}

/** A character's (drawn when its file is here: the mannequin's always, an imported one's as it is imported). */
export const characterThumb = (id: string | null) => ({
  key: `character:${id ?? 'mannequin'}`,
  make: () => {
    const f = newFigure();
    return drawThumb(newScene('Character', [id ? { ...f, model: id, body: bodyFor(f, id) } : f]), { yaw: 20, pitch: 4, fov: 30 });
  },
});
