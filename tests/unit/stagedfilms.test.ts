import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { startAnimatedScene } from '@/lib/actions';
import { putClips } from '@/lib/assets';
import { cameraAt, viewOf } from '@/lib/cameras';
import { parseClip } from '@/lib/doc';
import { actionsOf, figurePoseAt } from '@/lib/evaluate';
import { FILMS } from '@/lib/films';
import { checkMotion } from '@/lib/qa';
import { spanAt } from '@/lib/shots';
import * as THREE from 'three';
import { Rig } from '@/lib/relations';
import { Store } from '@/lib/store';
import { SHOOT_PRESETS } from '@/lib/templates';
import type { Scene } from '@/lib/types';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

/** The Library's motions a scene plays, brought to hand from their files. */
function load(scene: Scene) {
  const ids = [...new Set(scene.animation!.actions.flatMap((x) => (x.source.kind === 'clip' && x.source.clip.startsWith('library:') ? [x.source.clip] : [])))];
  for (const id of ids) expect(existsSync(`public/motions/${id.slice(8)}.json`), id).toBe(true);
  putClips(ids.map((id) => parseClip(JSON.parse(readFileSync(`public/motions/${id.slice(8)}.json`, 'utf8')))!));
}

describe('films: templates staged as a director would', () => {
  it('play what they stage with nobody going through anyone, and each is ready to shoot its way', () => {
    for (const f of FILMS) {
      const scene = f.build();
      expect(scene.figures, f.name).toHaveLength(f.people);
      load(scene);
      // (A block meeting a kick touches; nobody goes into anyone further than that.)
      const deep = checkMotion(scene).filter((x) => /passes (\d+) cm into/.test(x.message) && Number(/passes (\d+) cm/.exec(x.message)![1]) > 12);
      expect(deep.map((x) => x.message), f.name).toEqual([]);
      expect(SHOOT_PRESETS.some((p) => p.template === f.id && p.coverage === f.coverage), f.name).toBe(true);
    }
  }, 600_000);

  it('lasts a minute or more each, every blow landing on the one it is aimed at, and nobody sitting on nothing', () => {
    const index = JSON.parse(readFileSync('public/motions/index.json', 'utf8')) as { id: string; impact?: number }[];
    const HIT = ['receive-punch-to-the-face', 'hit-reaction', 'falling-back-death', 'death-from-the-front', 'standing-block', 'blocking'].map((x) => `library:${x}`);
    const SIT = ['stand-to-sit', 'sitting-idle', 'sitting-talking', 'sit-to-type'].map((x) => `library:${x}`);
    const rig = new Rig();
    for (const f of FILMS) {
      const scene = f.build();
      const a = scene.animation!;
      expect(a.duration, f.name).toBeGreaterThanOrEqual(60);
      load(scene);
      for (const x of a.actions) {
        const src = x.source;
        if (src.kind !== 'clip' || x.layer) continue;
        const impact = index.find((e) => e.id === src.clip)?.impact;
        if (impact === undefined) continue;
        const lands = x.start + impact;
        // (Struck, or blocked: whoever reacts as it lands.)
        const struck = a.actions.find((y) => y.source.kind === 'clip' && HIT.includes(y.source.clip) && y.roles[0].figure !== x.roles[0].figure && y.start <= lands && lands < y.start + 0.6);
        if (!struck) continue;
        const m = rig.model(figurePoseAt(scene, x.roles[0].figure, lands)!);
        const hips = m.joints.hips.getWorldPosition(new THREE.Vector3());
        const blow = (['leftHand', 'rightHand', 'leftFoot', 'rightFoot'] as const).map((j) => m.joints[j].getWorldPosition(new THREE.Vector3()))
          .reduce((p, q) => (Math.hypot(q.x - hips.x, q.z - hips.z) > Math.hypot(p.x - hips.x, p.z - hips.z) ? q : p));
        const them = rig.model(figurePoseAt(scene, struck.roles[0].figure, lands)!);
        const near = Math.min(...(['head', 'neck', 'chest', 'spine', 'hips', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand'] as const).map((j) => them.joints[j].getWorldPosition(new THREE.Vector3()).distanceTo(blow)));
        expect(near, `${f.name}: ${src.clip} at ${lands.toFixed(2)} s`).toBeLessThan(0.35);
      }
      // Sitting: on a chair of the scene's, or (in the living room) the sofa.
      for (const x of a.actions) {
        if (x.source.kind !== 'clip' || !SIT.includes(x.source.clip)) continue;
        const at = x.roles[0].end!.at;
        const chair = scene.props.some((p) => p.kind === 'chair' && Math.hypot(p.position[0] - at[0], p.position[2] - at[1]) < 0.3);
        const sofa = scene.set === 'living-room' && Math.abs(at[1] + 3.42) < 0.1 && Math.abs(at[0]) < 1.1;
        expect(chair || sofa, `${f.name}: ${x.source.clip} at ${x.start.toFixed(1)} s`).toBe(true);
      }
    }
    rig.dispose();
  }, 600_000);

  it('times a reaction to the strike: the block is up as the kick lands', () => {
    const scene = FILMS.find((f) => f.id === 'film-wuxia')!.build();
    const [lin, mei] = scene.figures.map((x) => x.id);
    const kick = actionsOf(scene.animation!, lin).find((x) => x.source.kind === 'clip' && x.source.clip === 'library:roundhouse-kick')!;
    const block = actionsOf(scene.animation!, mei).find((x) => x.source.kind === 'clip' && x.source.clip === 'library:standing-block')!;
    expect(block.start).toBeLessThan(kick.start + 1.08);
    expect(block.start).toBeGreaterThan(kick.start);
    // Close enough to strike, not on top of each other.
    load(scene);
    const t = kick.start + 1.08;
    const [a, b] = [figurePoseAt(scene, lin, t)!, figurePoseAt(scene, mei, t)!];
    const gap = Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2]);
    expect(gap).toBeGreaterThan(0.8);
    expect(gap).toBeLessThan(1.8);
  });

  it('opens as a film cast as it says: the officer and the man with the hostage', () => {
    const store = new Store(new MemoryStorage());
    expect(startAnimatedScene(store, { shoot: 'shoot-film-standoff' }, 15)).toBe(true);
    const name = (id: string) => store.scene.figures.find((f) => f.id === id)!.name;
    expect(store.scene.coverage).toMatchObject({ id: 'dialogue', live: true });
    expect([name(store.scene.coverage!.roles.A), name(store.scene.coverage!.roles.B)]).toEqual(['Officer Diaz', 'Vince']);
    expect(startAnimatedScene(store, { shoot: 'shoot-film-wuxia' }, 15)).toBe(true);
    expect(store.scene.coverage).toMatchObject({ id: 'fight', live: true });
  });

  it("keeps every preset's cameras out of anyone, moving smoothly within a shot", () => {
    for (const p of SHOOT_PRESETS) {
      const store = new Store(new MemoryStorage());
      expect(startAnimatedScene(store, { shoot: p.id }, 15), p.name).toBe(true);
      const scene = store.scene;
      load(scene);
      let last = null as { at: THREE.Vector3; shot: string } | null;
      for (let t = 0; t < 15; t += 1 / 24) {
        const at = cameraAt(scene, t).position;
        const shot = spanAt(scene.animation!, t).shot.id;
        // (A cut may jump; within a shot it moves on, a hand-held one quickly at most.)
        if (last?.shot === shot) expect(last.at.distanceTo(at), `${p.name} at ${t.toFixed(2)}`).toBeLessThan(0.3);
        last = { at: at.clone(), shot };
        // (Never inside anyone: half a metre from where they stand, give or take.)
        for (const f of scene.figures) {
          const q = figurePoseAt(scene, f.id, t)!.position;
          expect(Math.hypot(q[0] - at.x, q[2] - at.z), `${p.name}: ${f.name} at ${t.toFixed(2)}`).toBeGreaterThan(0.45);
        }
      }
    }
  }, 300_000);

  it('works a camera out again when what it films changes: its subject, the motions coming in', () => {
    const store = new Store(new MemoryStorage());
    expect(startAnimatedScene(store, { shoot: 'shoot-film-wuxia' }, 15)).toBe(true);
    const fresh = (s: Scene) => structuredClone(s);
    const t = 6;
    // Worked out before the Library's motions are at hand (everyone standing), then as they come.
    // (A close one keeping the other out: where it puts its subject is worked out again too.)
    const cam = store.scene.cameras.find((c) => c.kind === 'rig' && !!c.rig.clear)!;
    viewOf(store.scene, cam, t);
    load(store.scene);
    expect(viewOf(store.scene, cam, t).position.distanceTo(viewOf(fresh(store.scene), cam, t).position)).toBeLessThan(1e-6);
    // Its subject changed: as if worked out for that one from the start.
    const other = store.scene.figures.find((f) => f.id !== cam.subject)!.id;
    const moved = { ...store.scene, cameras: store.scene.cameras.map((c) => (c.id === cam.id ? { ...c, subject: other } : c)) };
    const now = moved.cameras.find((c) => c.id === cam.id)!;
    expect(viewOf(moved, now, t).position.distanceTo(viewOf(fresh(moved), now, t).position)).toBeLessThan(1e-6);
  }, 120_000);
});
