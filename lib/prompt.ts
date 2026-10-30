import type { MoveKind, Scene } from './types';
import { angleOf, cameraAt, cameraById, sizeOf, type CameraView, type ShotSize } from './cameras';
import { newShot, shotSpans, type ShotSpan } from './shots';

/*
 * A plain-language description of a shot (framing, angle, lens, camera move, cast, action),
 * ready to paste into an AI video tool alongside a rendered clip or first frame.
 */

/** A camera move in a prompt's words (#16). */
const MOVE_WORDS: Record<MoveKind, string> = {
  push: 'push in', arc: 'arc shot around the subject', crane: 'crane shot', truck: 'trucking shot', pan: 'pan', tilt: 'tilt', zoom: 'zoom', dolly: 'dolly zoom', roll: 'rolling camera',
};

const FRAMING: Record<ShotSize, string> = {
  ews: 'extreme wide shot', ws: 'wide shot, full body', fs: 'full shot', mws: 'medium-wide shot',
  ms: 'medium shot', mcu: 'medium close-up', cu: 'close-up', ecu: 'extreme close-up',
};

function angle(pitch: number) {
  if (pitch > 60) return 'top-down view';
  if (pitch > 22) return 'high angle';
  if (pitch < -8) return 'low angle';
  return 'eye level';
}

function lens(view: CameraView) {
  const mm = Math.round(view.lens);
  return `${mm}mm ${mm < 28 ? 'wide-angle lens' : mm > 70 ? 'telephoto lens' : 'lens'}`;
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
  const cam = cameraById(scene, span.shot.camera) ?? scene.cameras[0];
  const moves: string[] = [];
  if (scene.animation && (cam.kind === 'rig' || cam.points.length > 1)) {
    // The camera over the shot, a few times: how near it is, its lens, angle and height.
    const n = 8;
    const views = Array.from({ length: n + 1 }, (_, i) => cameraAt(scene, span.start + ((span.end - 1e-3 - span.start) * i) / n));
    const first = views[0];
    const last = views[n];
    const near = (v: CameraView) => v.position.distanceTo(v.target) * Math.tan(((v.fov * Math.PI) / 180) / 2);
    const step = (p: number, q: number) => Math.abs(((q - p + 540) % 360) - 180);
    const turned = views.reduce((sum, v, i) => (i ? sum + step(angleOf(views[i - 1]).yaw, angleOf(v).yaw) : 0), 0);
    const tighter = near(first) / near(last);
    if (Math.abs(last.lens / first.lens - 1) > 0.5 && Math.abs(tighter - 1) < 0.2) moves.push('dolly zoom (the background stretches while the subject keeps its size)');
    else if (tighter > 1.2) moves.push('slow push in');
    else if (tighter < 1 / 1.2) moves.push('pull out to reveal the scene');
    if (turned >= 300) moves.push('a full 360° orbit around the subject');
    else if (turned > 25) moves.push(`the camera arcs about ${Math.round(turned / 5) * 5}° around the subject`);
    const rise = angleOf(last).pitch - angleOf(first).pitch;
    if (rise > 20) moves.push('crane up');
    else if (rise < -20) moves.push('crane down');
  }
  if (scene.animation && cam.kind === 'rig' && cam.rig.move) moves.push(MOVE_WORDS[cam.rig.move.kind]);
  if (scene.animation && cam.kind === 'rig' && cam.subject) moves.push(cam.rig.turn && Math.abs(cam.rig.yaw) > 135 ? 'following shot from behind the subject' : 'tracking shot that follows the subject');
  else if (scene.animation && cam.kind === 'path' && cam.anchor === 'subject') moves.push('tracking shot that follows the subject');
  if ((cam.shake ?? 0) > 0) moves.push('hand-held camera');
  return moves.length ? moves.join(', ') : 'static camera';
}

/** One shot of a scene (the whole pose or animation without cuts). */
export function describeSpan(scene: Scene, span: ShotSpan) {
  const view = cameraAt(scene, span.start);
  const a = scene.animation;
  const c = cast(scene);
  const parts = [
    `${FRAMING[sizeOf(scene, cameraById(scene, span.shot.camera) ?? scene.cameras[0], span.start, view)]}, ${angle(angleOf(view).pitch)}, ${lens(view)}.`,
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
  if (!a) return describeSpan(scene, { shot: newShot(0, scene.name, scene.cameras[0].id, 'main'), index: 0, start: 0, end: 0 });
  const spans = shotSpans(a);
  if (spans.length === 1) return describeSpan(scene, spans[0]);
  return spans.map((s) => `${s.shot.name} (${s.start.toFixed(1)}–${s.end.toFixed(1)} s): ${describeSpan(scene, s)}`).join('\n');
}
