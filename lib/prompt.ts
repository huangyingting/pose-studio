import type { Scene } from './types';
import { shotAt } from './shot';

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

function cast(scene: Scene) {
  const visible = scene.figures.filter((f) => !f.hidden);
  const who = visible.map((f) => (f.body.height < 1.4 ? 'a child' : f.body.sex < 0.5 ? 'a man' : 'a woman'));
  const words = ['', 'one', 'two', 'three', 'four', 'five'];
  const n = visible.length;
  if (n === 1) return `one mannequin figure (${who[0]})`;
  return `${words[n] ?? n} mannequin figures (${who.slice(0, -1).join(', ')} and ${who[n - 1]})`;
}

function movement(scene: Scene) {
  const a = scene.animation;
  const keys = a?.camera?.keys ?? [];
  const moves: string[] = [];
  if (a && keys.length > 1) {
    const first = shotAt(scene, 0);
    const last = shotAt(scene, keys[keys.length - 1].t);
    const step = (p: number, q: number) => Math.abs(((q - p + 540) % 360) - 180);
    // A loop also turns from its last key back to the first.
    const turned = keys.reduce((sum, k, i) => (i ? sum + step(keys[i - 1].yaw, k.yaw) : 0), 0) + (a.loop ? step(keys[keys.length - 1].yaw, keys[0].yaw) : 0);
    if (Math.abs(last.fov - first.fov) > 20 && Math.abs(last.zoom - first.zoom) < 0.2) moves.push('dolly zoom (the background stretches while the subject keeps its size)');
    else if (last.zoom - first.zoom > 0.2) moves.push('slow push in');
    else if (first.zoom - last.zoom > 0.2) moves.push('pull out to reveal the scene');
    if (turned >= 300) moves.push('a full 360° orbit around the subject');
    else if (turned > 25) moves.push(`the camera arcs about ${Math.round(turned / 5) * 5}° around the subject`);
    if (last.pitch - first.pitch > 20) moves.push('crane up');
    else if (first.pitch - last.pitch > 20) moves.push('crane down');
  }
  if (a?.camera?.follow) moves.push('tracking shot that follows the subject');
  if ((a?.camera?.shake ?? 0) > 0) moves.push('hand-held camera');
  return moves.length ? moves.join(', ') : 'static camera';
}

export function describeShot(scene: Scene) {
  const shot = shotAt(scene, 0);
  const a = scene.animation;
  const parts = [
    `${framing(shot.zoom)}, ${angle(shot.pitch)}, ${lens(shot.fov)}.`,
    `Camera: ${movement(scene)}.`,
    `${cast(scene)[0].toUpperCase()}${cast(scene).slice(1)}: ${scene.name.toLowerCase()}.`,
  ];
  if (a) parts.push(`${a.duration.toFixed(1)} seconds${a.loop ? ', seamless loop' : ''}.`);
  return parts.join(' ');
}
