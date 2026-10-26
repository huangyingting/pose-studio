import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { keyAt, moveKey, newAnimation, removeKey, sampleCamera, samplePose, sceneAt, setDuration, setKey, frameTimes } from '@/lib/animation';
import { addFigure, addKeyframe, applyCameraMove, deleteFigure, deleteKeyframe, moveKeyframe, startAnimation } from '@/lib/actions';
import { duplicateScene, mirrorScene, newFigure, newScene, parseScene } from '@/lib/doc';
import { jointLimits } from '@/lib/joints';
import { MOTIONS } from '@/lib/motions';
import { describeShot } from '@/lib/prompt';
import { CAMERA_MOVES, captureShot, framingFor, placeShot, shotAt } from '@/lib/shot';
import { Store } from '@/lib/store';
import type { Figure, JointName } from '@/lib/types';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

const withKnee = (f: Figure, deg: number): Figure => ({ ...f, joints: { ...f.joints, kneeL: [deg, 0, 0] } });

function twoKeyScene(loop = false) {
  const f = newFigure();
  const s = newScene('Test', [withKnee(f, 0)]);
  let a = { ...newAnimation(s, 2), loop };
  a = setKey(a, 1, [withKnee(f, 60)]);
  return { ...s, animation: a };
}

describe('keyframe sampling', () => {
  it('passes exactly through the keys and in between', () => {
    const s = twoKeyScene();
    const id = s.figures[0].id;
    expect(samplePose(s.animation!, id, 0)!.joints.kneeL?.[0] ?? 0).toBe(0);
    expect(samplePose(s.animation!, id, 1)!.joints.kneeL![0]).toBe(60);
    const mid = samplePose(s.animation!, id, 0.5)!.joints.kneeL![0];
    expect(mid).toBeGreaterThan(20);
    expect(mid).toBeLessThan(40);
    // Holds the last key after it (no loop).
    expect(samplePose(s.animation!, id, 1.8)!.joints.kneeL![0]).toBe(60);
  });

  it('loops smoothly back to the first key', () => {
    const s = twoKeyScene(true);
    const id = s.figures[0].id;
    const at = (t: number) => samplePose(s.animation!, id, t)!.joints.kneeL?.[0] ?? 0;
    expect(at(1.5)).toBeGreaterThan(10);
    expect(at(1.5)).toBeLessThan(50);
    expect(at(1.999)).toBeLessThan(2);
    expect(at(2.5)).toBeCloseTo(at(0.5), 5);
  });

  it('turns the short way across ±180°', () => {
    const f = newFigure();
    const s = newScene('Turn', [{ ...f, joints: { root: [0, 170, 0] } }]);
    const a = setKey(newAnimation(s, 2), 1, [{ ...f, joints: { root: [0, -170, 0] } }]);
    const yaw = samplePose({ ...a, loop: false }, f.id, 0.5)!.joints.root![1];
    expect(Math.abs(yaw)).toBeGreaterThan(170);
  });

  it('adds, moves and removes keys on the frame grid', () => {
    const s = twoKeyScene();
    let a = setKey(s.animation!, 0.51, s.figures);
    expect(a.keys.map((k) => k.t)).toEqual([0, 0.5, 1]);
    a = moveKey(a, 0.5, 1.25);
    expect(a.keys.map((k) => k.t)).toEqual([0, 1, 1.25]);
    expect(moveKey(a, 1.25, 1).keys.map((k) => k.t)).toEqual([0, 1, 1.25]); // occupied
    a = removeKey(a, 1);
    expect(keyAt(a, 1)).toBe(-1);
    expect(setDuration(a, 4).keys.map((k) => k.t)).toEqual([0, 2.5]);
    expect(frameTimes({ ...a, duration: 1, fps: 24, loop: true }, 4)).toEqual([0, 0.25, 0.5, 0.75]);
  });

  it('survives save/load, duplication and mirroring', () => {
    const s = twoKeyScene();
    expect(parseScene(JSON.parse(JSON.stringify(s)))).toEqual(s);
    const copy = duplicateScene(s);
    expect(Object.keys(copy.animation!.keys[1].poses)).toEqual([copy.figures[0].id]);
    const m = mirrorScene(s);
    expect(m.animation!.keys[1].poses[s.figures[0].id].joints.kneeR![0]).toBe(60);
  });
});

describe('animation in the store', () => {
  it('auto-keys edits at the playhead and follows the playhead', () => {
    const store = new Store(new MemoryStorage());
    startAnimation(store);
    const id = store.scene.figures[0].id;
    const knee0 = store.scene.figures[0].joints.kneeL?.[0] ?? 0;
    store.setTime(1);
    store.updateFigure(id, (f) => withKnee(f, 45));
    expect(store.scene.animation!.keys.map((k) => k.t)).toEqual([0, 1]);
    store.setTime(0);
    expect(store.scene.figures[0].joints.kneeL?.[0] ?? 0).toBe(knee0);
    store.setTime(1);
    expect(store.scene.figures[0].joints.kneeL![0]).toBe(45);
    // Undo removes the key and puts the figure back.
    store.undo();
    expect(store.scene.animation!.keys).toHaveLength(1);
    expect(store.scene.figures[0].joints.kneeL?.[0] ?? 0).toBe(knee0);
    addKeyframe(store);
    expect(store.scene.animation!.keys).toHaveLength(2);
  });

  it('opens animated poses at their first frame', () => {
    const storage = new MemoryStorage();
    const a = new Store(storage);
    a.updateScene(() => MOTIONS[0].build());
    a.setTime(0.5);
    a.save();
    const b = new Store(storage);
    const s = b.scene;
    expect(b.getState().time).toBe(0);
    expect(s.figures[0].joints).toEqual(sceneAt(s, 0).figures[0].joints);
  });
});

describe('shot camera', () => {
  it('interpolates camera keys and frames the figures', () => {
    const s = MOTIONS[0].build();
    const a = s.animation!;
    const push = CAMERA_MOVES.find((m) => m.id === 'push')!;
    const keys = push.keys(a, s.view);
    const scene = { ...s, animation: { ...a, camera: { keys, follow: false, shake: 0 } } };
    expect(sampleCamera(scene.animation, 0)!.zoom).toBeCloseTo(1);
    // Just before the end (a looping camera wraps back to its start at the end).
    expect(sampleCamera(scene.animation, a.duration - 1e-3)!.zoom).toBeCloseTo(1.8, 2);
    const f = framingFor(scene, 4);
    const cam = new THREE.PerspectiveCamera(20, 16 / 9);
    const far = placeShot(cam, f, shotAt(scene, 0), 16 / 9);
    const d0 = cam.position.distanceTo(far);
    const near = placeShot(cam, f, shotAt(scene, a.duration - 1e-3), 16 / 9);
    expect(cam.position.distanceTo(near)).toBeLessThan(d0 * 0.7);
  });

  it('captures a view back into an equivalent camera key', () => {
    const s = MOTIONS[3].build();
    const f = framingFor(s, 4);
    const cam = new THREE.PerspectiveCamera(30, 16 / 9);
    const shot = { t: 0, yaw: 40, pitch: 12, fov: 30, zoom: 1.4, pan: [0.1, -0.05] as [number, number] };
    const target = placeShot(cam, f, shot, 16 / 9);
    const back = captureShot(cam, target, f, 16 / 9);
    expect(back.yaw).toBeCloseTo(40, 0);
    expect(back.pitch).toBeCloseTo(12, 0);
    expect(back.zoom).toBeCloseTo(1.4, 1);
    expect(back.pan[0]).toBeCloseTo(0.1, 1);
    expect(back.pan[1]).toBeCloseTo(-0.05, 1);
  });

  it('applies camera moves and describes the shot', () => {
    const store = new Store(new MemoryStorage());
    applyCameraMove(store, 'orbit360');
    const text = describeShot(store.scene);
    expect(text).toMatch(/360° orbit/);
    expect(text).toMatch(/mannequin figure/);
  });
});

describe('animation templates', () => {
  it('builds every motion with valid keys within joint limits', () => {
    for (const m of MOTIONS) {
      const s = m.build();
      const a = s.animation!;
      expect(s.figures, m.id).toHaveLength(m.people);
      expect(a.keys.length, m.id).toBeGreaterThan(1);
      expect(a.camera?.keys.length, m.id).toBeGreaterThan(0);
      expect(parseScene(JSON.parse(JSON.stringify(s)))).toEqual(s);
      for (const k of a.keys) {
        for (const p of Object.values(k.poses)) {
          for (const [j, r] of Object.entries(p.joints)) {
            if (j === 'root') continue;
            const lim = jointLimits(j as JointName);
            r!.forEach((v, i) => {
              expect(v, `${m.id} ${j}[${i}] at ${k.t}`).toBeGreaterThanOrEqual(lim[i][0] - 0.5);
              expect(v, `${m.id} ${j}[${i}] at ${k.t}`).toBeLessThanOrEqual(lim[i][1] + 0.5);
            });
          }
        }
      }
    }
  });
});

describe('per-figure tracks', () => {
  function duo() {
    const store = new Store(new MemoryStorage());
    const [a, b] = [newFigure({ name: 'A' }), newFigure({ name: 'B', position: [1, 0, 0] })];
    store.updateScene((s) => ({ ...s, figures: [a, b] }));
    startAnimation(store, 2);
    return { store, a: a.id, b: b.id };
  }
  const keys = (store: Store, id: string) => store.scene.animation!.keys.filter((k) => k.poses[id]).map((k) => k.t);
  const knee = (store: Store, id: string, t: number) => samplePose(store.scene.animation!, id, t)!.joints.kneeL?.[0] ?? 0;
  const bend = (store: Store, id: string, deg: number) => store.updateFigure(id, (f) => withKnee(f, deg));

  it('keys only the figure that was posed', () => {
    const { store, a, b } = duo();
    store.setTime(1);
    bend(store, a, 60);
    expect(keys(store, a)).toEqual([0, 1]);
    expect(keys(store, b)).toEqual([0]);
    // B did not move.
    expect(knee(store, b, 1)).toBe(knee(store, b, 0));
  });

  it('retimes and deletes one figure\'s keys without touching the other\'s', () => {
    const { store, a, b } = duo();
    store.setTime(1);
    bend(store, a, 60);
    bend(store, b, 40);
    expect(store.scene.animation!.keys.map((k) => k.t)).toEqual([0, 1]);
    // A's punch later; B's reaction stays at 1 s.
    moveKeyframe(store, 1, 1.5, a);
    expect(keys(store, a)).toEqual([0, 1.5]);
    expect(keys(store, b)).toEqual([0, 1]);
    expect(knee(store, b, 1)).toBe(40);
    // Moving onto a time where the figure already has a key is refused.
    moveKeyframe(store, 1.5, 0, a);
    expect(keys(store, a)).toEqual([0, 1.5]);
    store.setTime(1.5);
    store.setActiveFigure(a);
    deleteKeyframe(store);
    expect(keys(store, a)).toEqual([0]);
    expect(keys(store, b)).toEqual([0, 1]);
    // A figure keeps its last key.
    store.setTime(0);
    deleteKeyframe(store, a);
    expect(keys(store, a)).toEqual([0]);
  });

  it('K keys the active figure; deleting a figure drops its track', () => {
    const { store, a, b } = duo();
    store.setTime(0.5);
    store.setActiveFigure(b);
    addKeyframe(store);
    expect(keys(store, b)).toEqual([0, 0.5]);
    expect(keys(store, a)).toEqual([0]);
    addKeyframe(store, [a, b]);
    expect(keys(store, a)).toEqual([0, 0.5]);
    deleteFigure(store, b);
    expect(store.scene.animation!.keys.every((k) => !k.poses[b])).toBe(true);
  });

  it('a figure added later stays put until it is keyed', () => {
    const { store } = duo();
    store.setTime(1);
    addFigure(store);
    const c = store.getState().activeFigure!;
    expect(keys(store, c)).toEqual([1]);
    expect(knee(store, c, 0)).toBe(knee(store, c, 2));
  });
});
