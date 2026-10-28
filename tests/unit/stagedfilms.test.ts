import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { startFilm } from '@/lib/actions';
import { putClips } from '@/lib/assets';
import { cameraAt } from '@/lib/cameras';
import { parseClip } from '@/lib/doc';
import { actionsOf, figurePoseAt } from '@/lib/evaluate';
import { FILMS } from '@/lib/films';
import { checkMotion } from '@/lib/qa';
import { spanAt } from '@/lib/shots';
import * as THREE from 'three';
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
  }, 300_000);

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
    expect(startFilm(store, { shoot: 'shoot-film-standoff' }, 15)).toBe(true);
    const name = (id: string) => store.scene.figures.find((f) => f.id === id)!.name;
    expect(store.scene.coverage).toMatchObject({ id: 'dialogue', live: true });
    expect([name(store.scene.coverage!.roles.A), name(store.scene.coverage!.roles.B)]).toEqual(['Officer Diaz', 'Vince']);
    expect(startFilm(store, { shoot: 'shoot-film-wuxia' }, 15)).toBe(true);
    expect(store.scene.coverage).toMatchObject({ id: 'fight', live: true });
  });

  it("keeps every preset's cameras out of anyone, moving smoothly within a shot", () => {
    for (const p of SHOOT_PRESETS) {
      const store = new Store(new MemoryStorage());
      expect(startFilm(store, { shoot: p.id }, 15), p.name).toBe(true);
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
});
