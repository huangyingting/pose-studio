import type { Scene } from './types';
import { shotAt } from './shot';
import { keysInShot, shotSpans, type ShotSpan } from './shots';

/*
 * A plain-language description of a shot (framing, angle, lens, camera move, cast, action),
 * ready to paste into an AI video tool alongside a rendered clip or first frame.
 */

function framing(zoom: number) {
  if (zoom < 1.2) return 'wide shot, full body';
  if (zoom < 1.6) return 'medium-wide shot';
  if (zoom < 2.2) return 'medium shot';
  return 'close-up';
}

function angle(pitch: number) {
  if (pitch > 60) return 'top-down view';
  if (pitch > 22) return 'high angle';
  if (pitch < -8) return 'low angle';
  return 'eye level';
}

function lens(fov: number) {
  if (fov < 20) return 'telephoto lens';
  if (fov > 45) return 'wide-angle lens';
  return 'normal lens';
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

function cast(scene: Scene) {
  const visible = scene.figures.filter((f) => !f.hidden);
  const n = visible.length;
  if (n === 0) return 'an empty set';
  const kinds: [string, string, number][] = [
    ['man', 'men', 0], ['woman', 'women', 0], ['child', 'children', 0], ['stand-in', 'stand-ins', 0],
  ];
  for (const f of visible) kinds[f.proxy ? 3 : f.body.height < 1.4 ? 2 : f.body.sex < 0.5 ? 0 : 1][2]++;
  const parts = kinds.filter((k) => k[2]).map(([one, many, c]) => (c === 1 ? `a ${one}` : `${WORDS[c] ?? c} ${many}`));
  const who = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return n === 1 ? `one mannequin figure (${who})` : `${WORDS[n] ?? n} mannequin figures (${who})`;
}

function movement(scene: Scene, span: ShotSpan) {
  const a = scene.animation;
  const moves: string[] = [];
  if (a) {
    const cut = (a.shots?.length ?? 0) > 1;
    const keys = keysInShot(a, span);
    if (keys.length > 1) {
      const first = shotAt(scene, span.start);
      const last = shotAt(scene, Math.min(span.end - 1e-3, keys[keys.length - 1].t));
      const step = (p: number, q: number) => Math.abs(((q - p + 540) % 360) - 180);
      // A loop (without cuts) also turns from its last key back to the first.
      const turned = keys.reduce((sum, k, i) => (i ? sum + step(keys[i - 1].yaw, k.yaw) : 0), 0)
        + (a.loop && !cut ? step(keys[keys.length - 1].yaw, keys[0].yaw) : 0);
      if (Math.abs(last.fov - first.fov) > 20 && Math.abs(last.zoom - first.zoom) < 0.2) moves.push('dolly zoom (the background stretches while the subject keeps its size)');
      else if (last.zoom - first.zoom > 0.2) moves.push('slow push in');
      else if (first.zoom - last.zoom > 0.2) moves.push('pull out to reveal the scene');
      if (turned >= 300) moves.push('a full 360° orbit around the subject');
      else if (turned > 25) moves.push(`the camera arcs about ${Math.round(turned / 5) * 5}° around the subject`);
      if (last.pitch - first.pitch > 20) moves.push('crane up');
      else if (first.pitch - last.pitch > 20) moves.push('crane down');
    }
    if (a.camera?.follow) moves.push('tracking shot that follows the subject');
    if ((a.camera?.shake ?? 0) > 0) moves.push('hand-held camera');
  }
  return moves.length ? moves.join(', ') : 'static camera';
}

/** One shot of a scene (the whole pose or animation without cuts). */
export function describeSpan(scene: Scene, span: ShotSpan) {
  const shot = shotAt(scene, span.start);
  const a = scene.animation;
  const c = cast(scene);
  const parts = [
    `${framing(shot.zoom)}, ${angle(shot.pitch)}, ${lens(shot.fov)}.`,
    `Camera: ${movement(scene, span)}.`,
    `${c[0].toUpperCase()}${c.slice(1)}: ${(span.shot.caption || scene.name).toLowerCase()}.`,
  ];
  if (a) {
    const cut = (a.shots?.length ?? 0) > 1;
    parts.push(`${(span.end - span.start).toFixed(1)} seconds${a.loop && !cut ? ', seamless loop' : ''}.`);
  }
  return parts.join(' ');
}

/** The whole scene: one line per shot when it has cuts. */
export function describeShot(scene: Scene) {
  const a = scene.animation;
  if (!a) return describeSpan(scene, { shot: { id: 'main', start: 0, name: scene.name }, index: 0, start: 0, end: 0 });
  const spans = shotSpans(a);
  if (spans.length === 1) return describeSpan(scene, spans[0]);
  return spans.map((s) => `${s.shot.name} (${s.start.toFixed(1)}–${s.end.toFixed(1)} s): ${describeSpan(scene, s)}`).join('\n');
}
