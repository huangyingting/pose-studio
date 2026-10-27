import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  addFigure, addProp, addScene, applyMotion, arrange, cutShot, dribbleProp, editShot, holdProp, moveProp, saveMotion, setGaze, setSceneLight, throwProp,
  travelTo,
} from '@/lib/actions';
import { frameTimes, sceneAt } from '@/lib/animation';
import { readMotionFile, retargetMotion } from '@/lib/importmotion';
import { LIGHT_PRESETS } from '@/lib/lighting';
import { handPosition, rimOf, worldOfProp } from '@/lib/propmotion';
import { buildMotion } from '@/lib/motions';
import { checkMotion } from '@/lib/qa';
import { SceneView } from '@/lib/sceneview';
import { Store } from '@/lib/store';
import type { Scene } from '@/lib/types';
import { CMU, bvh } from '../fixtures/bvh';

/*
 * Whole scenes made the way a user makes them (the same actions as the menus), for the use case of
 * filming several people moving together: sport, fights, gymnastics, props passed between them.
 * Each must come out clean: the motion check finds nothing, nobody goes through the floor, held
 * props stay in the hand, and nothing jumps from one frame to the next.
 */

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

const fresh = () => {
  const store = new Store(new MemoryStorage());
  return { store, a: store.figure!.id };
};

const figureAt = (scene: Scene) => (id: string, t: number) => sceneAt(scene, t).figures.find((f) => f.id === id) ?? null;

/** What a viewer would notice, frame by frame. */
function audit(scene: Scene) {
  const sv = new SceneView();
  const at = figureAt(scene);
  let lowest = 0;
  let handGap = 0;
  let rootStep = 0;
  const last = new Map<string, THREE.Vector3>();
  for (const t of frameTimes(scene.animation!)) {
    const s = sceneAt(scene, t);
    sv.sync(s);
    for (const f of s.figures) {
      const m = sv.figures.get(f.id)!;
      lowest = Math.min(lowest, m.lowest());
      const root = m.joints.root.getWorldPosition(new THREE.Vector3());
      const prev = last.get(f.id);
      if (prev) rootStep = Math.max(rootStep, prev.distanceTo(root));
      last.set(f.id, root);
    }
    for (const p of s.props) {
      if (!p.hold) continue;
      const w = worldOfProp(scene, p.id, at, t)!.position;
      const h = handPosition(at(p.hold.figure, t)!, p.hold.hand, s.props);
      handGap = Math.max(handGap, Math.hypot(w[0] - h[0], w[1] - h[1], w[2] - h[2]));
    }
  }
  sv.dispose();
  return { issues: checkMotion(scene).map((i) => i.message), lowest, handGap, rootStep };
}

/** Clean: no issues, on or above the floor, props in the hand (a ball's centre sits a palm away), no frame-to-frame jumps beyond a sprint. */
function expectClean(scene: Scene) {
  const r = audit(scene);
  expect(r.issues).toEqual([]);
  expect(r.lowest).toBeGreaterThan(-0.01);
  expect(r.handGap).toBeLessThan(0.25);
  expect(r.rootStep).toBeLessThan(0.25);
  return r;
}

describe('scenes from the use case', () => {
  it('a run up court, a pass, and a jump up onto a box; light and a shot that follows the catcher', () => {
    const { store, a } = fresh();
    addFigure(store, [2, 0, 0]);
    const b = store.getState().activeFigure!;
    addProp(store, 'sphere', [0.5, 0, 0.5]);
    const ball = store.scene.props[0].id;
    moveProp(store, ball, { scale: [0.24, 0.24, 0.24] });
    holdProp(store, ball, { figure: a, hand: 'R' });
    addProp(store, 'box', [2, 0, 6.5]);
    moveProp(store, store.scene.props[1].id, { scale: [0.8, 0.5, 0.8] });
    const runA = travelTo(store, a, [0, 4], 'run')!;
    store.setTime(0);
    travelTo(store, b, [2, 4], 'run');
    store.setTime(runA.to);
    const pass = throwProp(store, ball, { figure: b, hand: 'L' })!;
    store.setTime(pass.to + 0.2);
    travelTo(store, b, [2, 6.5], 'jump', { height: 0.6 });
    setGaze(store, a, { figure: b });
    setSceneLight(store, LIGHT_PRESETS.find((p) => p.id === 'noon')!.light);
    store.setTime(runA.to);
    cutShot(store);
    editShot(store, store.scene.animation!.shots![1].id, { subject: b });

    expectClean(store.scene);
    const end = sceneAt(store.scene, store.scene.animation!.duration);
    // B ends standing on the box with the ball.
    expect(end.props[0].hold?.figure).toBe(b);
    const sv = new SceneView();
    sv.sync(end);
    expect(sv.figures.get(b)!.lowest()).toBeCloseTo(0.5, 1);
    sv.dispose();
  }, 60_000);

  it('a pass on the run is caught in the hand, mid-stride', () => {
    const { store, a } = fresh();
    addFigure(store, [2, 0, 0]);
    const b = store.getState().activeFigure!;
    addProp(store, 'sphere', [0.5, 0, 0.5]);
    const ball = store.scene.props[0].id;
    moveProp(store, ball, { scale: [0.24, 0.24, 0.24] });
    holdProp(store, ball, { figure: a, hand: 'L' });
    store.setTime(0);
    const run = travelTo(store, a, [0, 8], 'run')!;
    store.setTime(0);
    travelTo(store, b, [2, 8], 'run');
    store.setTime(run.to / 2);
    const pass = throwProp(store, ball, { figure: b, hand: 'R' })!;
    expectClean(store.scene);
    const at = figureAt(store.scene);
    const w = worldOfProp(store.scene, ball, at, pass.to)!.position;
    const h = handPosition(at(b, pass.to)!, 'R', store.scene.props);
    expect(Math.hypot(w[0] - h[0], w[1] - h[1], w[2] - h[2])).toBeLessThan(0.25);
    expect(sceneAt(store.scene, pass.to + 0.3).props[0].hold?.figure).toBe(b);
  }, 60_000);

  it('a boxing exchange from library moves on two figures facing each other', () => {
    const { store, a } = fresh();
    addFigure(store, [0, 0, 1.2]);
    const b = store.getState().activeFigure!;
    arrange(store, a, b, 'faceEachOther');
    store.setTime(0);
    applyMotion(store, a, 'jab-cross');
    store.setTime(0);
    applyMotion(store, b, 'block-duck');
    store.setTime(1.2);
    applyMotion(store, b, 'hit');
    setGaze(store, a, { figure: b });
    setGaze(store, b, { figure: a });
    expectClean(store.scene);
  }, 60_000);

  it('a run-up, a jump onto a box, a walk across it, a jump down and side steps back', () => {
    const { store, a } = fresh();
    addProp(store, 'box', [0, 0, 4]);
    moveProp(store, store.scene.props[0].id, { scale: [1.2, 0.45, 1.6] });
    travelTo(store, a, [0, 2.6], 'run');
    travelTo(store, a, [0, 3.6], 'jump', { height: 0.5 });
    travelTo(store, a, [0, 4.4], 'walk');
    travelTo(store, a, [0, 5.6], 'jump', { height: 0.3 });
    travelTo(store, a, [0, 4.8], 'walk', { strafe: true });
    expectClean(store.scene);
  }, 60_000);

  it('a floor routine chained at the playhead: cartwheel, pirouette, run off', () => {
    const { store, a } = fresh();
    applyMotion(store, a, 'cartwheel');
    store.setTime(store.scene.animation!.duration);
    applyMotion(store, a, 'pirouette');
    store.setTime(store.scene.animation!.duration);
    const where = store.scene.figures[0].position;
    // The pirouette starts where the cartwheel ended.
    expect(where[0]).toBeLessThan(-1.5);
    travelTo(store, a, [where[0] - 3, where[2]], 'run');
    expectClean(store.scene);
  }, 60_000);

  it('an imported motion, then walking on from where it ends', async () => {
    const { store, a } = fresh();
    const motion = retargetMotion(await readMotionFile('Step forward.bvh', new TextEncoder().encode(bvh(CMU)).buffer as ArrayBuffer));
    saveMotion(store, motion);
    applyMotion(store, a, motion.id);
    store.setTime(store.scene.animation!.duration);
    travelTo(store, a, [1, 2], 'walk');
    expectClean(store.scene);
  }, 60_000);

  it('steps up onto a low step, but walks into (not up) a tall box, and says so', () => {
    const low = fresh();
    addProp(low.store, 'box', [0, 0, 2]);
    moveProp(low.store, low.store.scene.props[0].id, { scale: [1.2, 0.2, 1.2] });
    travelTo(low.store, low.a, [0, 2], 'walk');
    expectClean(low.store.scene);

    const tall = fresh();
    addProp(tall.store, 'box', [0, 0, 2]);
    moveProp(tall.store, tall.store.scene.props[0].id, { scale: [0.6, 1, 0.6] });
    travelTo(tall.store, tall.a, [0, 4], 'walk');
    const r = audit(tall.store.scene);
    expect(r.issues.some((m) => /goes through a prop/.test(m))).toBe(true);
    // Not by climbing a metre in a stride.
    expect(r.issues.filter((m) => /past its natural range/.test(m))).toEqual([]);
  }, 60_000);

  it('basketball: dribbling up court on the run, then a shot that drops through the hoop', () => {
    const { store, a } = fresh();
    store.updateScene((s) => ({ ...s, view: { yaw: 90, pitch: 6, fov: 40 } }));
    addProp(store, 'sphere', [0.5, 0, 0.5]);
    const ball = store.scene.props[0].id;
    moveProp(store, ball, { scale: [0.24, 0.24, 0.24] });
    holdProp(store, ball, { figure: a, hand: 'R' });
    addProp(store, 'hoop', [0, 0, 7.5]);
    const hoop = store.scene.props[1].id;
    moveProp(store, hoop, { rotation: [0, 180, 0] });
    store.setTime(0);
    const run = travelTo(store, a, [0, 4], 'run')!;
    store.setTime(0);
    const dribble = dribbleProp(store, ball, 3)!;
    expect(dribble.to).toBeLessThan(run.to);
    store.setTime(run.to);
    const shot = throwProp(store, ball, { hoop })!;
    expectClean(store.scene);
    const at = figureAt(store.scene);
    // Pushed down, off the floor a third of the way through each dribble, met by the hand on its
    // way up; the hand rides it to the top, lower as it lets go.
    expect(worldOfProp(store.scene, ball, at, 4 / 24)!.position[1]).toBeCloseTo(0, 2);
    expect(sceneAt(store.scene, 8 / 24).props[0].hold?.figure).toBe(a);
    const wrist = (t: number) => handPosition(at(a, t)!, 'R', store.scene.props)[1];
    expect(wrist(9 / 24) - wrist(12 / 24)).toBeGreaterThan(0.1);
    // Through the rim (its centre there), then down on the floor.
    const rim = rimOf(store.scene.props[1]);
    const through = worldOfProp(store.scene, ball, at, shot.to)!.position;
    expect(Math.hypot(through[0] - rim[0], through[2] - rim[2])).toBeLessThan(0.05);
    expect(rim[1] - through[1]).toBeCloseTo(store.scene.props[0].scale[1] / 2, 2);
    const end = sceneAt(store.scene, store.scene.animation!.duration).props[0];
    expect(end.hold).toBeUndefined();
    expect(end.position[1]).toBeCloseTo(0, 2);
  }, 60_000);

  it('basketball: a shot off the rim bounces back out towards the shooter', () => {
    const { store, a } = fresh();
    store.updateScene((s) => ({ ...s, view: { yaw: 90, pitch: 6, fov: 40 } }));
    addProp(store, 'sphere', [0.5, 0, 0.5]);
    const ball = store.scene.props[0].id;
    moveProp(store, ball, { scale: [0.24, 0.24, 0.24] });
    holdProp(store, ball, { figure: a, hand: 'R' });
    addProp(store, 'hoop');
    const hoop = store.scene.props[1];
    // Put ahead of the figure, its board facing it.
    expect(hoop.position[2]).toBeCloseTo(5, 3);
    const shot = throwProp(store, ball, { hoop: hoop.id, miss: true })!;
    expectClean(store.scene);
    const at = figureAt(store.scene);
    const rim = rimOf(hoop);
    const hit = worldOfProp(store.scene, ball, at, shot.to)!.position;
    // At the rim's front edge, not through its middle.
    expect(rim[2] - hit[2]).toBeGreaterThan(0.25);
    const end = sceneAt(store.scene, store.scene.animation!.duration).props[0];
    expect(end.position[1]).toBeCloseTo(0, 2);
    expect(end.position[2]).toBeLessThan(hit[2] - 1.5);
  }, 60_000);

  it('basketball: dribbling standing still, with the left hand', () => {
    const { store, a } = fresh();
    addProp(store, 'sphere', [0.5, 0, 0.5]);
    const ball = store.scene.props[0].id;
    moveProp(store, ball, { scale: [0.24, 0.24, 0.24] });
    holdProp(store, ball, { figure: a, hand: 'L' });
    dribbleProp(store, ball);
    expectClean(store.scene);
    expect(sceneAt(store.scene, store.scene.animation!.duration).props[0].hold).toEqual({ figure: a, hand: 'L' });
  }, 60_000);

  it('high jump: the flop clears its bar, back first, onto the mat; a jump too low is caught going through the bar', () => {
    const { store } = fresh();
    addScene(store, buildMotion('high-jump')!);
    expectClean(store.scene);
    const jumper = store.scene.figures[0].id;
    const [bar, mat] = store.scene.props;
    const sv = new SceneView();
    // Over the bar: the hips above it, face up (the chest's front points up).
    let over = 0;
    for (const t of frameTimes(store.scene.animation!)) {
      sv.sync(sceneAt(store.scene, t));
      const m = sv.figures.get(jumper)!;
      const hips = m.joints.root.getWorldPosition(new THREE.Vector3());
      if (Math.abs(hips.z - bar.position[2]) < 0.15) {
        over++;
        expect(hips.y).toBeGreaterThan(bar.scale[1] + 0.15);
        expect(new THREE.Vector3(0, 0, 1).applyQuaternion(m.joints.chest.getWorldQuaternion(new THREE.Quaternion())).y).toBeGreaterThan(0.5);
      }
    }
    expect(over).toBeGreaterThan(0);
    // Lying on the mat at the end.
    sv.sync(sceneAt(store.scene, store.scene.animation!.duration));
    expect(sv.figures.get(jumper)!.lowest()).toBeCloseTo(mat.scale[1] * 0.4, 1);
    sv.dispose();

    const low = fresh();
    addProp(low.store, 'bar', [0, 0, 3]);
    moveProp(low.store, low.store.scene.props[0].id, { scale: [1, 1.3, 1] });
    travelTo(low.store, low.a, [0, 2.2], 'run');
    travelTo(low.store, low.a, [0, 3.8], 'jump', { height: 0.3 });
    expect(audit(low.store.scene).issues.some((m) => /goes through a prop/.test(m))).toBe(true);
  }, 60_000);

  it('wrestling: a clinch and a takedown, then a boxing exchange in the next scene', () => {
    const { store } = fresh();
    addScene(store, buildMotion('takedown')!);
    expectClean(store.scene);
    addScene(store, buildMotion('boxing')!);
    expectClean(store.scene);
  }, 60_000);

  it('rhythmic gymnastics: a split leap, the hoop tossed up and caught, a cartwheel', () => {
    const { store, a } = fresh();
    addProp(store, 'ring');
    const ring = store.scene.props[0].id;
    expect(store.scene.props[0].hold).toEqual({ figure: a, hand: 'R' });
    applyMotion(store, a, 'leap');
    store.setTime(store.scene.animation!.duration);
    const toss = throwProp(store, ring, { figure: a, hand: 'R' })!;
    // Up two metres over the hand, about 1.3 s in the air.
    expect(toss.to - toss.from).toBeGreaterThan(1.1);
    store.setTime(toss.to);
    applyMotion(store, a, 'cartwheel');
    expectClean(store.scene);
    expect(sceneAt(store.scene, store.scene.animation!.duration).props[0].hold?.figure).toBe(a);
  }, 60_000);

  it('rhythmic gymnastics: a ribbon trails the stick through a pirouette, its own length, above the floor', () => {
    const { store, a } = fresh();
    addProp(store, 'ribbon');
    const ribbon = store.scene.props[0];
    expect(ribbon.hold).toEqual({ figure: a, hand: 'R' });
    applyMotion(store, a, 'pirouette');
    expectClean(store.scene);
    const at = figureAt(store.scene);
    const lengths = (trail: number[][]) => trail.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - trail[i][0], p[1] - trail[i][1], p[2] - trail[i][2]), 0);
    const started = performance.now();
    const times = [0, 0.8, 1.1, 1.4];
    for (const t of times) {
      const trail = sceneAt(store.scene, t).props[0].trail!;
      // From the stick's tip, four metres long, never under the floor.
      const tip = worldOfProp(store.scene, ribbon.id, at, t)!;
      expect(Math.hypot(trail[0][0] - tip.position[0], trail[0][2] - tip.position[2])).toBeLessThan(0.7);
      expect(lengths(trail)).toBeCloseTo(4, 1);
      expect(Math.min(...trail.map((p) => p[1]))).toBeGreaterThan(0);
    }
    // Quick enough to play (a frame's worth of ribbon in well under a frame).
    expect((performance.now() - started) / times.length).toBeLessThan(40);
    // At rest it hangs from the tip and lies on the floor; turning, it flies out.
    const still = sceneAt(store.scene, 0).props[0].trail!;
    expect(still.at(-1)![1]).toBeLessThan(0.01);
    const turning = sceneAt(store.scene, 1.1).props[0].trail!;
    expect(Math.max(...turning.map((p) => p[1]))).toBeGreaterThan(0.5);
  }, 60_000);

  it('a figure walking behind a wall is reported hidden from the shot camera', () => {
    const { store, a } = fresh();
    travelTo(store, a, [-2, -3], 'walk');
    travelTo(store, a, [2, -3], 'walk');
    addProp(store, 'wall', [0, 0, -1.5]);
    expect(checkMotion(store.scene).filter((i) => i.kind === 'hidden')).not.toEqual([]);
  }, 60_000);
});
