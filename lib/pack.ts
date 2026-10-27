import { sceneAt } from './evaluate';
import { buildOtio } from './otio';
import { describeShot, describeSpan } from './prompt';
import { canvasToBlob, safeFilename, type Pass } from './render';
import { cameraAt, cameraPath } from './cameras';
import type { StoryShot } from './board';
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

prompt.txt and cutlist.otio at the top level cover the whole sequence (the scene, or the story).
Give a video model the first (and last) frame, the greybox clip as a motion/camera reference
and the prompt, so it follows the blocking instead of guessing.
`;

/** A keyframe pack of shots (a scene's, or the whole story's), named `name`. */
export async function keyframePack(shots: StoryShot[], name: string, o: PackOptions, onProgress?: (fraction: number) => void, signal?: AbortSignal) {
  const animated = shots.some((x) => x.span);
  const greybox = animated && o.greybox && videoSupported();
  const scenes = new Set(shots.map((x) => x.scene.id)).size;
  const entries: ZipEntry[] = [
    { name: 'README.txt', data: README },
    { name: 'prompt.txt', data: shots.map((x) => (x.span ? describeSpan(x.scene, x.span) : describeShot(x.scene))).join('\n\n') + '\n' },
  ];
  // The cut list points at the video of the same shots (one scene's is at its own rate; the story's at 24 fps).
  const rate = scenes === 1 ? shots[0].scene.animation?.fps ?? 24 : 24;
  if (animated) entries.push({ name: 'cutlist.otio', data: JSON.stringify(buildOtio(shots, name, 'video.mp4', rate), null, 2) });
  const renderer = sharedRenderer();
  const steps = shots.length * (greybox ? 7 : 6);
  let done = 0;
  const tick = () => onProgress?.(++done / steps);
  const png = async (scene: Scene, t: number, pass: Pass) => {
    const c = renderer.renderShot(sceneAt(scene, t), o.width, o.height, o.lineWidth, {
      style: o.style, faces: o.faces, pass, camera: cameraAt(scene, t, o.width / o.height),
    });
    const blob = await canvasToBlob(c, 'png');
    return new Uint8Array(await blob.arrayBuffer());
  };

  for (const [i, x] of shots.entries()) {
    if (signal?.aborted) throw new Error('Cancelled');
    const label = x.span ? (scenes > 1 ? `${x.scene.name} ${x.span.shot.name}` : x.span.shot.name) : x.scene.name;
    const dir = `${String(i + 1).padStart(2, '0')}_${safeFilename(label, 'shot')}`;
    const fps = x.scene.animation?.fps ?? 24;
    const [first, last] = x.span ? [x.span.start, Math.max(x.span.start, x.span.end - 1 / fps)] : [0, 0];
    for (const [which, t] of [['first', first], ['last', last]] as const) {
      entries.push({ name: `${dir}/${which}.png`, data: await png(x.scene, t, 'beauty') });
      tick();
      entries.push({ name: `${dir}/${which}_depth.png`, data: await png(x.scene, t, 'depth') });
      tick();
      entries.push({ name: `${dir}/${which}_normal.png`, data: await png(x.scene, t, 'normal') });
      tick();
    }
    entries.push({ name: `${dir}/prompt.txt`, data: (x.span ? describeSpan(x.scene, x.span) : describeShot(x.scene)) + '\n' });
    entries.push({ name: `${dir}/camera.json`, data: JSON.stringify(cameraPath(x.scene, first, x.span ? x.span.end : 0, o.width / o.height), null, 2) });
    if (greybox && x.span) {
      const clip = await recordVideo(x.scene, { ...o, style: 'shaded', loops: 1, range: [x.span.start, x.span.end] }, undefined, signal);
      entries.push({ name: `${dir}/greybox.${clip.ext}`, data: new Uint8Array(await clip.blob.arrayBuffer()) });
      tick();
    }
  }
  return zip(entries);
}
