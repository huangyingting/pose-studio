import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { addCamera, addFigure, applyCameraMove, cutShot, deleteCamera, editCamera, editShot, frameShot, setCameraPoint, setFrameShape, setLens, setShotSubject, startAnimation, travelTo } from '@/lib/actions';
import { checkMotion } from '@/lib/qa';
import { parseScene } from '@/lib/doc';
import { describeShot } from '@/lib/prompt';
import { Rig } from '@/lib/relations';
import { fitCamera, videoSize, viewDirection } from '@/lib/render';
import { ASPECTS, SHOT_ASPECT, cameraAt, fovLens, frameAspect, framingFor, lensFov, liveCamera, placeCamera, sizeOf, subjectPlace, viewOf } from '@/lib/shot';
import { shotSpans } from '@/lib/shots';
import type { Scene } from '@/lib/types';
import { fresh } from '../fixtures/scenes';

/** Where on screen (−1 … 1, up +) a point is seen by the shot camera at t. */
function onScreen(scene: Scene, t: number, p: THREE.Vector3) {
  const cam = new THREE.PerspectiveCamera(30, SHOT_ASPECT);
  placeCamera(cam, cameraAt(scene, t), SHOT_ASPECT);
  return p.clone().project(cam);
}

/** The top of the head, the hips and the knees of a figure at t. */
function body(scene: Scene, id: string) {
  const rig = new Rig();
  const m = rig.model(scene.figures.find((f) => f.id === id)!);
  let top = -Infinity;
  m.forEachPoint((p) => { top = Math.max(top, p.y); });
  const at = (j: 'hips' | 'leftLowerLeg' | 'chest') => m.joints[j].getWorldPosition(new THREE.Vector3());
  const head = at('hips').setY(top);
  const out = { head, hips: at('hips'), knees: at('leftLowerLeg'), chest: at('chest') };
  rig.dispose();
  return out;
}

describe('the shot camera: lens, shot sizes and an editable path', () => {
  it('converts focal lengths and fields of view both ways (full frame)', () => {
    // A 50 mm lens on a 16:9 frame of a full-frame sensor (36 × 20.25 mm): about 22.9° high.
    expect(lensFov(50)).toBeCloseTo(22.9, 1);
    for (const mm of [14, 24, 35, 50, 85, 200]) expect(fovLens(lensFov(mm))).toBeCloseTo(mm, 6);
    // On a taller frame the sensor's 24 mm height is used.
    expect(lensFov(50, 1)).toBeCloseTo(27, 0);
  });

  it('frames the intended part of the body at each shot size, at any lens', () => {
    const { store, a } = fresh();
    startAnimation(store, 2);
    for (const lens of [24, 85]) {
      frameShot(store, 'ms', { lens });
      let b = body(store.scene, a);
      // A medium shot: from above the head to the waist.
      expect(onScreen(store.scene, 0, b.head).y).toBeLessThan(1);
      expect(onScreen(store.scene, 0, b.head).y).toBeGreaterThan(0.7);
      expect(onScreen(store.scene, 0, b.hips).y).toBeGreaterThan(-1);
      expect(onScreen(store.scene, 0, b.hips).y).toBeLessThan(-0.4);
      expect(onScreen(store.scene, 0, b.knees).y).toBeLessThan(-1);
      expect(sizeOf(store.scene, liveCamera(store.scene, 0), 0, cameraAt(store.scene, 0))).toBe('ms');
      // A close-up: the head and shoulders; the hips are out of frame.
      frameShot(store, 'cu', { lens });
      b = body(store.scene, a);
      expect(onScreen(store.scene, 0, b.head).y).toBeLessThan(1);
      expect(onScreen(store.scene, 0, b.hips).y).toBeLessThan(-1);
      expect(Math.round(fovLens(cameraAt(store.scene, 0).fov))).toBe(lens);
    }
    // On the left third: the subject a third of the way in from the left.
    frameShot(store, 'ms', { lens: 50, place: 'left' });
    expect(onScreen(store.scene, 0, body(store.scene, a).chest).x).toBeCloseTo(-1 / 3, 1);
    expect(describeShot(store.scene)).toMatch(/^medium shot, eye level, 50mm lens/);
  });

  it('changes the lens keeping the subject\'s size (the camera moves) or the camera\'s place (it zooms)', () => {
    const { store } = fresh();
    startAnimation(store, 2);
    frameShot(store, 'fs', { lens: 35 });
    const before = cameraAt(store.scene, 0);
    setLens(store, 70, 'size');
    const dolly = cameraAt(store.scene, 0);
    expect(dolly.position.distanceTo(dolly.target)).toBeCloseTo(before.position.distanceTo(before.target) * 2, 1);
    expect(sizeOf(store.scene, liveCamera(store.scene, 0), 0, dolly)).toBe('fs');
    setLens(store, 140, 'place');
    const zoom = cameraAt(store.scene, 0);
    expect(zoom.position.distanceTo(dolly.position)).toBeLessThan(1e-3);
    expect(fovLens(zoom.fov)).toBeCloseTo(140, 1);
  });

  it('moves along a smooth path, fixed in the scene or riding along with its subject', () => {
    const { store, a } = fresh();
    store.setTime(0);
    const walk = travelTo(store, a, [0, 4], 'walk')!;
    store.setTime(0);
    applyCameraMove(store, 'orbit360');
    // Continuous: no jumps between frames (no step much longer than the average).
    let last = cameraAt(store.scene, 0).position;
    const steps: number[] = [];
    for (let t = 1 / 24; t <= walk.to; t += 1 / 24) {
      const p = cameraAt(store.scene, t).position;
      steps.push(p.distanceTo(last));
      last = p;
    }
    expect(Math.max(...steps)).toBeLessThan((2.5 * steps.reduce((x, y) => x + y, 0)) / steps.length);
    // Riding along: the camera keeps its place beside the walker as it goes; it stays where it was when restated.
    const at = cameraAt(store.scene, 0).position;
    editCamera(store, liveCamera(store.scene, 0)!.id, { subject: a, anchor: 'subject', aim: 'subject' });
    expect(cameraAt(store.scene, 0).position.distanceTo(at)).toBeLessThan(0.01);
    applyCameraMove(store, 'tracking');
    const cam = liveCamera(store.scene, 0);
    const beside = (t: number) => cameraAt(store.scene, t).position.sub(subjectPlace(store.scene, cam, t));
    expect(beside(0).distanceTo(beside(walk.to))).toBeLessThan(0.01);
    expect(cameraAt(store.scene, walk.to).position.z - cameraAt(store.scene, 0).position.z).toBeGreaterThan(3);
    expect(describeShot(store.scene)).toMatch(/tracking shot/);
  });

  it('converts camera keys saved before shots had paths, the camera where it was (one-time converter)', () => {
    const { store } = fresh();
    addFigure(store, [1, 0, 0]);
    startAnimation(store, 4);
    const scene = store.scene;
    const keys = [
      { t: 0, yaw: 20, pitch: 8, fov: 30, zoom: 1, pan: [0, 0] },
      { t: 2, yaw: 80, pitch: 15, fov: 26, zoom: 1.4, pan: [0.05, 0.1] },
      { t: 4, yaw: 120, pitch: 5, fov: 40, zoom: 1.2, pan: [0, 0] },
    ];
    const old = JSON.parse(JSON.stringify(scene));
    old.animation.camera = { keys, follow: false, shake: 0 };
    const converted = parseScene(old);
    // Where the old camera was at each key: an orbit around everyone in frame, a zoom and a pan.
    const f = framingFor(converted, 12);
    for (const k of keys) {
      const cam = new THREE.PerspectiveCamera(k.fov, SHOT_ASPECT);
      const view = { yaw: k.yaw, pitch: k.pitch, fov: k.fov };
      const target = fitCamera(cam, { forEachPoint: (cb) => f.points.forEach(cb) }, view, 0.1);
      const dist = target.distance / k.zoom;
      const dir = viewDirection(view);
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
      const up = new THREE.Vector3().crossVectors(dir, right);
      const tanV = Math.tan((k.fov * Math.PI) / 360);
      const look = target.clone().addScaledVector(right, k.pan[0] * dist * tanV * SHOT_ASPECT).addScaledVector(up, k.pan[1] * dist * tanV);
      const was = look.clone().addScaledVector(dir, dist);
      const now = cameraAt(converted, Math.min(k.t, 4 - 1e-3));
      expect(now.position.distanceTo(was), String(k.t)).toBeLessThan(0.01);
      expect(now.fov).toBeCloseTo(k.fov, 1);
    }
    // Kept as converted.
    expect(parseScene(JSON.parse(JSON.stringify(converted)))).toEqual(converted);
  });

  it('films in the scene\'s frame shape: the lens sees as on that frame, videos come out that shape', () => {
    const { store } = fresh();
    startAnimation(store, 2);
    frameShot(store, 'fs', { lens: 50 });
    expect(cameraAt(store.scene, 0).fov).toBeCloseTo(lensFov(50, 16 / 9), 3);
    setFrameShape(store, '9:16');
    expect(store.scene.animation!.frame).toBe('9:16');
    // The same lens on a tall frame sees more height (the sensor's 24 mm).
    expect(cameraAt(store.scene, 0).fov).toBeCloseTo(lensFov(50, 9 / 16), 3);
    expect(videoSize('1080p', frameAspect(store.scene))).toMatchObject({ width: 1080, height: 1920 });
    expect(videoSize('720p', ASPECTS['2.39:1'])).toMatchObject({ width: 1720, height: 720 });
    expect(parseScene(JSON.parse(JSON.stringify(store.scene))).animation!.frame).toBe('9:16');
  });

  it('reports the camera going through someone', () => {
    const { store, a } = fresh();
    startAnimation(store, 2);
    // A camera point inside the figure's chest, looking out.
    const chest = new THREE.Vector3(...store.scene.figures[0].position).setY(1.25);
    setCameraPoint(store, chest, chest.clone().add(new THREE.Vector3(0, 0, 3)), 40);
    const issues = checkMotion(store.scene).filter((i) => i.kind === 'camera');
    expect(issues.map((i) => i.figure)).toEqual([a]);
    expect(issues[0].message).toMatch(/camera of Shot 1 goes through Figure/);
  });

  it('keeps cameras apart from shots: a cut films on with the same camera, another camera cuts or blends in', () => {
    const { store, a } = fresh();
    store.setTime(0);
    const walk = travelTo(store, a, [0, 4], 'walk')!;
    store.setTime(0);
    applyCameraMove(store, 'orbit90');
    const one = liveCamera(store.scene, 0)!;
    const before = [0.5, 1, 1.5, 2].map((t) => cameraAt(store.scene, t).position);
    // A cut changes nothing on screen: the new shot films with the same camera.
    store.setTime(1);
    cutShot(store);
    const spans = shotSpans(store.scene.animation!);
    expect(spans.map((s) => s.shot.camera)).toEqual([one.id, one.id]);
    [0.5, 1, 1.5, 2].forEach((t, i) => expect(cameraAt(store.scene, t).position.distanceTo(before[i])).toBeLessThan(1e-6));
    // Another camera for the second shot: the first shot is as it was.
    const two = addCamera(store)!;
    editCamera(store, two, { name: 'Wide' });
    store.setTime(1.5);
    frameShot(store, 'ws', { lens: 24 });
    expect(store.scene.animation!.cameras!.map((c) => c.name)).toEqual([one.name, 'Wide']);
    expect(cameraAt(store.scene, 0.5).position.distanceTo(before[0])).toBeLessThan(1e-6);
    const wide = store.scene.animation!.cameras![1];
    expect(cameraAt(store.scene, 1.5).position.distanceTo(viewOf(store.scene, wide, 1.5).position)).toBeLessThan(1e-6);
    // Blending in over half a second: from where the first camera would be, to the second, smoothly.
    editShot(store, spans[1].shot.id, { blend: 0.5 });
    const from = viewOf(store.scene, one, 1).position;
    expect(cameraAt(store.scene, 1).position.distanceTo(from)).toBeLessThan(1e-6);
    expect(cameraAt(store.scene, 1.5).position.distanceTo(viewOf(store.scene, wide, 1.5).position)).toBeLessThan(1e-6);
    const mid = cameraAt(store.scene, 1.25).position;
    const ends = [viewOf(store.scene, one, 1.25).position, viewOf(store.scene, wide, 1.25).position];
    expect(mid.distanceTo(ends[0]) + mid.distanceTo(ends[1])).toBeLessThan(ends[0].distanceTo(ends[1]) * 1.01);
    // Kept as saved; a camera removed leaves its shots to the still camera.
    expect(parseScene(JSON.parse(JSON.stringify(store.scene)))).toEqual(store.scene);
    deleteCamera(store, wide.id);
    expect(store.scene.animation!.shots![1].camera).toBeUndefined();
    // A subject for a shot: on its camera when no other shot films with it.
    setShotSubject(store, spans[0].shot.id, a);
    expect(store.scene.animation!.shots![0].camera).toBe(one.id);
    expect(store.scene.animation!.cameras!.map((c) => c.subject)).toEqual([a]);
    expect(walk.to).toBeGreaterThan(1.5);
  });

  it('converts shots saved with camera paths of their own into cameras, the camera where it was (one-time converter)', () => {
    const { store } = fresh();
    startAnimation(store, 3);
    store.setTime(0);
    applyCameraMove(store, 'orbit90');
    store.setTime(1.5);
    cutShot(store);
    applyCameraMove(store, 'push');
    const scene = store.scene;
    // As saved then: each shot with its path, the points' times from the shot's start.
    const old = JSON.parse(JSON.stringify(scene));
    old.animation.shots = shotSpans(scene.animation!).map(({ shot, start }) => {
      const cam = scene.animation!.cameras!.find((c) => c.id === shot.camera)!;
      return { id: shot.id, start, name: shot.name, anchor: cam.anchor, aim: cam.aim, points: cam.points.map((p) => ({ ...p, t: p.t - start })) };
    });
    delete old.animation.cameras;
    const converted = parseScene(old);
    expect(converted.animation!.cameras).toHaveLength(2);
    for (const t of [0, 0.7, 1.4, 1.5, 2.2, 2.9]) expect(cameraAt(converted, t).position.distanceTo(cameraAt(scene, t).position), String(t)).toBeLessThan(0.01);
  });
});
