import { sceneAt } from './evaluate';
import { buildOtio } from './otio';
import { describeShot, describeSpan } from './prompt';
import { canvasToBlob, safeFilename, type Pass } from './render';
import { cameraAt, cameraPath } from './shot';
import { newShot, shotSpans, type ShotSpan } from './shots';
import { sharedRenderer } from './thumbnails';
import type { Scene, Style } from './types';
import { recordVideo, videoSupported } from './video';
import { zip, type ZipEntry } from './zip';

/*
 * Keyframe pack: everything an AI video model needs to follow the blocking, per shot — the
 * first and last frame (picture, depth and normals), a greybox clip of the motion and camera,
 * the camera path, and a prompt that describes the real framing — plus the cut list.
 */

export interface PackOptions {
  width: number;
  height: number;
  style: Style;
  lineWidth: number;
  faces: boolean;
  /** Add a clay-shaded clip of each shot (animations only; takes longest). */
  greybox: boolean;
}

const README = `Pose Studio keyframe pack

Each shot folder holds:
  first.png, last.png               the first and last frame of the shot
  first_depth.png, last_depth.png   depth (near = white, far = black)
  first_normal.png, last_normal.png view-space normals
  greybox.mp4                       the shot's motion and camera in clay shading (animations)
  camera.json                       the camera for every frame: position, look-at target, vertical FOV
  prompt.txt                        the shot described for an AI video model

prompt.txt and cutlist.otio at the top level cover the whole sequence.
Give a video model the first (and last) frame, the greybox clip as a motion/camera reference
and the prompt, so it follows the blocking instead of guessing.
`;

export async function keyframePack(scene: Scene, o: PackOptions, onProgress?: (fraction: number) => void, signal?: AbortSignal) {
  const a = scene.animation;
  const spans: ShotSpan[] = a ? shotSpans(a) : [{ shot: newShot(0, scene.name, 'main'), index: 0, start: 0, end: 0 }];
  const greybox = !!a && o.greybox && videoSupported();
  const entries: ZipEntry[] = [{ name: 'README.txt', data: README }, { name: 'prompt.txt', data: describeShot(scene) + '\n' }];
  if (a) entries.push({ name: 'cutlist.otio', data: JSON.stringify(buildOtio(scene, 'video.mp4'), null, 2) });
  const renderer = sharedRenderer();
  const steps = spans.length * (greybox ? 7 : 6);
  let done = 0;
  const tick = () => onProgress?.(++done / steps);
  const png = async (t: number, pass: Pass) => {
    const c = renderer.renderShot(sceneAt(scene, t), o.width, o.height, o.lineWidth, {
      style: o.style, faces: o.faces, pass, camera: cameraAt(scene, t, o.width / o.height),
    });
    const blob = await canvasToBlob(c, 'png');
    return new Uint8Array(await blob.arrayBuffer());
  };

  for (const span of spans) {
    if (signal?.aborted) throw new Error('Cancelled');
    const dir = `${String(span.index + 1).padStart(2, '0')}_${safeFilename(span.shot.name, 'shot')}`;
    const fps = a?.fps ?? 24;
    const last = a ? Math.max(span.start, span.end - 1 / fps) : 0;
    for (const [label, t] of [['first', span.start], ['last', last]] as const) {
      entries.push({ name: `${dir}/${label}.png`, data: await png(t, 'beauty') });
      tick();
      entries.push({ name: `${dir}/${label}_depth.png`, data: await png(t, 'depth') });
      tick();
      entries.push({ name: `${dir}/${label}_normal.png`, data: await png(t, 'normal') });
      tick();
    }
    entries.push({ name: `${dir}/prompt.txt`, data: describeSpan(scene, span) + '\n' });
    entries.push({ name: `${dir}/camera.json`, data: JSON.stringify(cameraPath(scene, span.start, a ? span.end : 0, o.width / o.height), null, 2) });
    if (greybox) {
      const clip = await recordVideo(scene, { ...o, style: 'shaded', loops: 1, range: [span.start, span.end] }, undefined, signal);
      entries.push({ name: `${dir}/greybox.${clip.ext}`, data: new Uint8Array(await clip.blob.arrayBuffer()) });
      tick();
    }
  }
  return zip(entries);
}
