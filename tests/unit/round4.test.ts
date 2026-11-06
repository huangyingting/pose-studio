import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyMotion, setAnimationOptions, startAnimation } from '@/lib/actions';
import { actionsOf, figurePoseAt, propWorldAt } from '@/lib/evaluate';
import { GAITS } from '@/lib/locomotion';
import { CAR_DRIVER } from '@/lib/props';
import { checkMotion } from '@/lib/qa';
import { Rig } from '@/lib/relations';
import { groundOf } from '@/lib/surfaces';
import type { Clip } from '@/lib/types';
import { captured, fresh } from '../fixtures/scenes';

/* Motions, round 4 (#61): everyday things, a rifle, a car, falls, more of two. */

const index = JSON.parse(readFileSync('public/motions/index.json', 'utf8')) as { id: string; name: string; people: number; loop?: boolean; move: [number, number] }[];
const D2R = Math.PI / 180;

describe('motions, round 4 (#61)', () => {
  it('in a car: getting in brings one round them, its driver\'s seat where they sit; driving and getting out after use the same car; nobody goes through it', () => {
    const { store, a } = fresh();
    startAnimation(store, 18);
    setAnimationOptions(store, { loop: false });
    applyMotion(store, a, captured('entering-car'));
    store.setTime(5.5);
    applyMotion(store, a, captured('driving'));
    store.setTime(10.5);
    applyMotion(store, a, captured('exiting-car'));
    const cars = store.scene.props.filter((p) => p.kind === 'car');
    expect(cars).toHaveLength(1);
    // The hips at its driver's seat, driving.
    const car = cars[0];
    const f = figurePoseAt(store.scene, a, 8)!;
    const yaw = car.rotation[1] * D2R;
    const [dx, dz] = CAR_DRIVER.at;
    const seat = [car.position[0] + dx * Math.cos(yaw) + dz * Math.sin(yaw), car.position[2] - dx * Math.sin(yaw) + dz * Math.cos(yaw)];
    expect(Math.hypot(f.position[0] - seat[0], f.position[2] - seat[1])).toBeLessThan(0.05);
    expect(f.position[1]).toBeCloseTo(CAR_DRIVER.hips, 1);
    expect(checkMotion(store.scene).filter((i) => i.kind === 'overlap').map((i) => i.message)).toEqual([]);
    // Not stood on: someone walking by it stays on the floor.
    expect(groundOf(store.scene.props)(seat[0], seat[1])).toBe(0);
  });

  it('riding in a car brings one with its passenger\'s seat (across from the driver\'s) where they sit; nobody goes through it', () => {
    const { store, a } = fresh();
    startAnimation(store, 4);
    setAnimationOptions(store, { loop: false });
    applyMotion(store, a, captured('jostled-passenger'));
    const car = store.scene.props.find((p) => p.kind === 'car')!;
    const f = figurePoseAt(store.scene, a, 1)!;
    const yaw = car.rotation[1] * D2R;
    const [dx, dz] = [-CAR_DRIVER.at[0], CAR_DRIVER.at[1]];
    expect(Math.hypot(f.position[0] - (car.position[0] + dx * Math.cos(yaw) + dz * Math.sin(yaw)), f.position[2] - (car.position[2] - dx * Math.sin(yaw) + dz * Math.cos(yaw)))).toBeLessThan(0.05);
    expect(checkMotion(store.scene).filter((i) => i.kind === 'overlap').map((i) => i.message)).toEqual([]);
  });

  it('a rifle comes with the rifle\'s motions, in the right hand: aimed, the other hand on its barrel and its stock at the shoulder', () => {
    const { store, a } = fresh();
    startAnimation(store, 4);
    applyMotion(store, a, captured('rifle-aiming-idle'));
    const rifle = store.scene.props.find((p) => p.kind === 'rifle')!;
    expect(rifle.hold).toEqual({ figure: a, hand: 'R' });
    const w = propWorldAt(store.scene, rifle.id, 1)!;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...w.position), new THREE.Quaternion().setFromEuler(new THREE.Euler(w.rotation[0] * D2R, w.rotation[1] * D2R, w.rotation[2] * D2R)), new THREE.Vector3(1, 1, 1));
    const [stock, muzzle] = [new THREE.Vector3(0, 0.1, -0.45).applyMatrix4(m), new THREE.Vector3(0, 0.135, 0.71).applyMatrix4(m)];
    const j = new Rig().model(figurePoseAt(store.scene, a, 1)!).joints;
    const left = j.leftHand.getWorldPosition(new THREE.Vector3());
    expect(new THREE.Line3(stock, muzzle).closestPointToPoint(left, true, new THREE.Vector3()).distanceTo(left)).toBeLessThan(0.1);
    expect(stock.distanceTo(j.rightUpperArm.getWorldPosition(new THREE.Vector3()))).toBeLessThan(0.15);
    // (Ahead, the way the figure faces: +z.)
    expect(muzzle.clone().sub(stock).normalize().z).toBeGreaterThan(0.9);
    // Walking and running with a rifle are steps a walk or a run can take.
    expect(GAITS.walk).toContain('library:rifle-walk');
    expect(GAITS.run).toContain('library:rifle-run');
  });

  it('a knife comes with stabbing, in the left hand that stabs; a sword with the sword\'s motions, in the right; running with a pistol or a sword and shield are steps a run can take', () => {
    for (const [slug, kind, hand] of [['stabbing', 'knife', 'L'], ['knife-idle', 'knife', 'L'], ['one-hand-sword-combo', 'sword', 'R'], ['great-sword-slash', 'sword', 'R'], ['pistol-kneeling-idle', 'pistol', 'R']] as const) {
      const { store, a } = fresh();
      startAnimation(store, 4);
      applyMotion(store, a, captured(slug));
      expect(store.scene.props.find((p) => p.kind === kind)?.hold, slug).toEqual({ figure: a, hand });
    }
    expect(GAITS.run).toContain('library:pistol-run');
    expect(GAITS.run).toContain('library:sword-and-shield-run');
  });

  it('a motion recorded on a low seat (Drink, sitting: the knees up) brings a lower chair, not one its thighs go through; the others the usual one', () => {
    for (const [slug, high] of [['sitting-drinking', 0.75], ['sitting-idle', 1]] as const) {
      const { store, a } = fresh();
      startAnimation(store, 12);
      setAnimationOptions(store, { loop: false });
      applyMotion(store, a, captured(slug));
      expect(store.scene.props.find((p) => p.kind === 'chair')!.scale[1], slug).toBe(high);
      expect(checkMotion(store.scene).filter((i) => i.kind === 'overlap').map((i) => i.message), slug).toEqual([]);
    }
  });

  it('every motion done sitting, given where there is nothing to sit on, brings a chair nobody goes through', () => {
    const seated = (JSON.parse(readFileSync('public/motions/index.json', 'utf8')) as { id: string; name: string; seat?: string }[]).filter((m) => m.seat);
    expect(seated.length).toBeGreaterThan(10);
    for (const m of seated) {
      const { store, a } = fresh();
      startAnimation(store, 12);
      setAnimationOptions(store, { loop: false });
      applyMotion(store, a, captured(m.id.slice(8)));
      expect(store.scene.props.some((p) => p.kind === 'chair'), m.name).toBe(true);
      expect(checkMotion(store.scene).filter((i) => i.kind === 'overlap').map((i) => i.message), m.name).toEqual([]);
    }
  });

  it('vaulting a box, or jumping down off one, brings the box (as high as the recording has it) where there is none; nobody goes through it', () => {
    for (const [slug, high] of [['vault-over-box', 0.9], ['jump-down', 0.6]] as const) {
      const { store, a } = fresh();
      startAnimation(store, 5);
      setAnimationOptions(store, { loop: false });
      applyMotion(store, a, captured(slug));
      expect(store.scene.props.filter((p) => p.kind === 'box').map((p) => p.scale[1]), slug).toEqual([high]);
      expect(checkMotion(store.scene).filter((i) => i.kind === 'overlap').map((i) => i.message), slug).toEqual([]);
    }
  });

  it('crawls go on lap after lap; the new motions of two are two people, the selected one leading', () => {
    for (const name of ['Crawl', 'Crawl, low']) {
      const m = index.find((x) => x.name === name)!;
      expect(m.loop, name).toBe(true);
      expect(Math.hypot(...m.move), name).toBeGreaterThan(0.5);
    }
    for (const name of ['Strangle from behind', 'Tackle']) expect(index.find((x) => x.name === name)?.people, name).toBe(2);
    const { store, a } = fresh();
    startAnimation(store, 6);
    applyMotion(store, a, captured('takedown'));
    const tackle = actionsOf(store.scene.animation!, a).find((x) => x.source.kind === 'clip')!;
    expect(tackle.roles.map((r) => r.figure)[0]).toBe(a);
    expect(tackle.roles).toHaveLength(2);
  });

  it('toes turn smoothly: no Library motion turns them more than 20° in a frame (as captured they flicked 40° as a foot left the floor)', () => {
    const [p, q] = [new THREE.Quaternion(), new THREE.Quaternion()];
    for (const m of index) {
      const clip = JSON.parse(readFileSync(`public/motions/${m.id.slice(8)}.json`, 'utf8')) as Clip;
      for (const part of clip.parts) {
        for (const t of part.tracks.filter((x) => /Toes\.quaternion$/.test(x.name))) {
          const keys = t.values.length / 4;
          let most = 0;
          for (let i = 1; i < keys; i++) most = Math.max(most, p.fromArray(t.values, i * 4 - 4).angleTo(q.fromArray(t.values, i * 4)));
          // (Per thirtieth of a second.)
          expect((most / D2R) * ((keys - 1) / clip.duration / 30), `${m.name} ${t.name}`).toBeLessThan(21);
        }
      }
    }
  });
});
