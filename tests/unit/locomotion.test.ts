import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { motionScene } from '../fixtures/scenes';
import { addProp, moveProp, setTravel, travelTo, turnTo } from '@/lib/actions';
import { frameTimes } from '@/lib/animation';
import { sceneAt } from '@/lib/evaluate';
import { legsOf } from '@/lib/locomotion';
import { checkMotion } from '@/lib/qa';
import { SceneView } from '@/lib/sceneview';
import { Store } from '@/lib/store';
import type { Scene } from '@/lib/types';
import { angle, facingOf } from '../../lib/pose';
import { actionsOf } from '@/lib/evaluate';
import { actionLabel } from '@/lib/track';

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
  return { store, id: store.figure!.id };
};

/** The figure's feet, root and lowest point at every frame, as drawn. */
function track(scene: Scene, id: string) {
  const sv = new SceneView();
  const frames = frameTimes(scene.animation!).map((t) => {
    sv.sync(sceneAt(scene, t));
    const m = sv.figures.get(id)!;
    const at = (j: 'leftFoot' | 'rightFoot' | 'hips') => m.joints[j].getWorldPosition(new THREE.Vector3());
    return { t, L: at('leftFoot'), R: at('rightFoot'), root: at('hips'), low: m.lowest(), yaw: facingOf(sceneAt(scene, t).figures.find((f) => f.id === id)!.bones) };
  });
  sv.dispose();
  return frames;
}

/** Largest drift of a foot between consecutive frames while it is on the ground (not lifting). */
function plantedDrift(frames: ReturnType<typeof track>, ankleY: number, ground = 0) {
  let worst = 0;
  for (let i = 1; i < frames.length; i++) {
    for (const side of ['L', 'R'] as const) {
      const a = frames[i - 1][side];
      const b = frames[i][side];
      if (a.y < ground + ankleY + 0.004 && b.y < ground + ankleY + 0.004) worst = Math.max(worst, Math.hypot(b.x - a.x, b.z - a.z));
    }
  }
  return worst;
}

describe('walking, running and jumping from mark to mark', () => {
  it('walks to a point in a natural time, facing the way it goes, and its planted feet do not slide', () => {
    const { store, id } = fresh();
    travelTo(store, id, [0, 4], 'walk');
    const scene = store.scene;
    const a = scene.animation!;
    // About 3 s for 4 m, and the playhead waits at the new mark.
    expect(a.duration).toBeGreaterThan(2.5);
    expect(a.duration).toBeLessThan(4);
    expect(store.getState().time).toBeCloseTo(a.duration, 1);
    const end = sceneAt(scene, a.duration).figures[0];
    expect(end.position[0]).toBeCloseTo(0, 2);
    expect(end.position[2]).toBeCloseTo(4, 2);
    const frames = track(scene, id);
    const legs = legsOf(scene.figures[0].body);
    expect(plantedDrift(frames, legs.ankleY)).toBeLessThan(0.01);
    // Never through the floor; it really walks (the feet leave the floor in turn).
    expect(Math.min(...frames.map((f) => f.low))).toBeGreaterThan(-0.01);
    expect(Math.max(...frames.map((f) => Math.max(f.L.y, f.R.y)))).toBeGreaterThan(legs.ankleY + 0.03);
    expect(checkMotion(scene).filter((i) => i.kind === 'slide')).toEqual([]);
  });

  it('turns to its path, chains marks into one walk, and side-steps or backs up when told to keep facing', () => {
    const { store, id } = fresh();
    travelTo(store, id, [2, 0], 'walk');
    let frames = track(store.scene, id);
    // Facing +X (90°) on the way.
    expect(frames[Math.floor(frames.length / 2)].yaw).toBeCloseTo(90, 0);
    travelTo(store, id, [2, 2], 'walk');
    frames = track(store.scene, id);
    expect(plantedDrift(frames, legsOf(store.scene.figures[0].body).ankleY)).toBeLessThan(0.012);

    const side = fresh();
    travelTo(side.store, side.id, [-1.5, 0], 'walk', { strafe: true });
    const s = track(side.store.scene, side.id);
    // Still facing the camera (0°) while it steps sideways.
    expect(Math.max(...s.map((f) => Math.abs(f.yaw)))).toBeLessThan(1);
    expect(s.at(-1)!.root.x).toBeCloseTo(-1.5, 1);
    expect(plantedDrift(s, legsOf(side.store.scene.figures[0].body).ankleY)).toBeLessThan(0.012);
    expect(checkMotion(side.store.scene).filter((i) => i.kind === 'slide')).toEqual([]);
  });

  it('turns on the spot by stepping round: foot after foot, none sliding, ending facing the way asked', () => {
    for (const by of [60, -150]) {
      const { store, id } = fresh();
      expect(turnTo(store, id, by)).toBe(true);
      const scene = store.scene;
      const a = scene.animation!;
      const frames = track(scene, id);
      const legs = legsOf(scene.figures[0].body);
      expect(Math.abs(frames.at(-1)!.yaw - by)).toBeLessThan(1);
      const turn = a.actions.find((x) => x.source.kind === 'travel')!;
      expect(turn.duration).toBeLessThan(by > 0 ? 1.2 : 1.6);
      expect(actionLabel(turn, scene)).toBe('Turn');
      // Stays where it stood, the feet lifted in turn and set down where they then stay.
      expect(Math.hypot(frames.at(-1)!.root.x, frames.at(-1)!.root.z)).toBeLessThan(0.02);
      expect(plantedDrift(frames, legs.ankleY)).toBeLessThan(0.01);
      expect(Math.max(...frames.map((f) => Math.max(f.L.y, f.R.y)))).toBeGreaterThan(legs.ankleY + 0.02);
      expect(checkMotion(scene).map((i) => i.message), `${by}°`).toEqual([]);
    }
    // Already facing it: nothing to do.
    const { store, id } = fresh();
    expect(turnTo(store, id, 2)).toBe(false);
  });

  it('turns as it arrives when told to face somewhere just after a walk; a short walk back steps back', () => {
    const { store, id } = fresh();
    travelTo(store, id, [0, 3], 'walk');
    const actions = store.scene.animation!.actions.length;
    // (A quarter turn to the left: the walk's last steps take it round, no turn added.)
    expect(turnTo(store, id, [5, 3])).toBe(true);
    expect(store.scene.animation!.actions).toHaveLength(actions);
    const a = store.scene.animation!;
    expect(Math.abs(facingOf(sceneAt(store.scene, a.duration).figures[0].bones) - 90)).toBeLessThan(1);
    expect(checkMotion(store.scene).filter((i) => i.kind === 'slide' || i.kind === 'pop')).toEqual([]);
    // A metre back: still facing the way it did, stepping back.
    travelTo(store, id, [-1, 3], 'walk');
    const back = store.scene.animation!.actions.find((x) => x.source.kind === 'travel' && x.start >= store.getState().time - 3 && x.roles[0].end?.at[0] === -1)!;
    expect(back.source).toMatchObject({ strafe: true });
    expect(Math.abs(facingOf(sceneAt(store.scene, store.getState().time).figures[0].bones) - 90)).toBeLessThan(1);
  });

  it('runs faster than it walks, without sliding', () => {
    const { store, id } = fresh();
    travelTo(store, id, [0, 6], 'run');
    expect(store.scene.animation!.duration).toBeLessThan(2.6);
    const frames = track(store.scene, id);
    expect(plantedDrift(frames, legsOf(store.scene.figures[0].body).ankleY)).toBeLessThan(0.012);
    // Both feet off the floor at times: running, not walking fast.
    const ankleY = legsOf(store.scene.figures[0].body).ankleY;
    expect(frames.some((f) => f.L.y > ankleY + 0.02 && f.R.y > ankleY + 0.02)).toBe(true);
  });

  it('jumps under gravity: as high as asked, never through the floor, with spins and flips', () => {
    const { store, id } = fresh();
    const legs = legsOf(store.scene.figures[0].body);
    travelTo(store, id, [0, 1.2], 'jump', { height: 0.6 });
    const frames = track(store.scene, id);
    const apex = Math.max(...frames.map((f) => f.root.y));
    expect(apex - legs.rootY).toBeGreaterThan(0.5);
    expect(apex - legs.rootY).toBeLessThan(0.7);
    expect(Math.min(...frames.map((f) => f.low))).toBeGreaterThan(-0.01);
    expect(frames.at(-1)!.root.z).toBeCloseTo(1.2, 1);

    // A full turn in the air: half way through the jump it faces the other way.
    const jump = actionsOf(store.scene.animation!, id).find((x) => x.source.kind === 'travel')!;
    setTravel(store, id, jump.start + jump.duration, 'jump', { spin: 1 });
    const half = jump.start + jump.duration / 2;
    const yaw = facingOf(sceneAt(store.scene, half).figures[0].bones);
    expect(Math.abs(yaw)).toBeGreaterThan(120);
  });

  it('generates smooth motion: no joint snaps, even sampled ten times finer than the frame rate', () => {
    const legs = ['leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot', 'hips'] as const;
    for (const id of ['walk', 'run', 'jump']) {
      const scene = motionScene(id);
      let worst = 0;
      let prev: number[] | null = null;
      for (let t = 0; t <= scene.animation!.duration; t += 1 / 240) {
        const f = sceneAt(scene, t).figures[0];
        const cur = legs.flatMap((j) => angle(f.bones, j));
        if (prev) cur.forEach((v, k) => { const d = Math.abs(v - prev![k]); worst = Math.max(worst, Math.min(d, 360 - d)); });
        prev = cur;
      }
      expect(worst, id).toBeLessThan(10);
      // And the motion check finds nothing wrong with them.
      expect(checkMotion(scene), id).toEqual([]);
    }
  }, 60_000);

  it('stands, walks and lands on top of props', () => {
    const { store, id } = fresh();
    addProp(store, 'box', [0, 0, 2]);
    const box = store.scene.props[0];
    moveProp(store, box.id, { scale: [1, 0.4, 1] });
    // Jump up onto the box: it lands on its top.
    travelTo(store, id, [0, 2], 'jump', { height: 0.5 });
    const frames = track(store.scene, id);
    expect(frames.at(-1)!.low).toBeCloseTo(0.4, 1);
    // Standing still on it too (no animation): the figure rests on the top, not inside.
    const still = fresh();
    addProp(still.store, 'box', [0, 0, 0]);
    moveProp(still.store, still.store.scene.props[0].id, { scale: [1, 0.3, 1] });
    const sv = new SceneView();
    sv.sync(still.store.scene);
    expect(sv.figures.get(still.id)!.lowest()).toBeCloseTo(0.3, 2);
    sv.dispose();
  });
});
