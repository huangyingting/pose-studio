import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { newScene, parseScene } from '@/lib/doc';
import { SceneView } from '@/lib/sceneview';
import { SETS, SET_GROUPS, setModels } from '@/lib/sets';
import { MODELS, SET_BUDGET, SKIES, SURFACES, type SetIndex } from '@/lib/setassets';
import INDEX from '../../public/sets/index.json';

const index = INDEX as unknown as SetIndex;

describe('sets', () => {
  it('ten or so, indoor and outdoor, each made of pieces with a floor at the stage floor', () => {
    expect(SETS.length).toBeGreaterThanOrEqual(8);
    for (const g of SET_GROUPS) expect(SETS.some((s) => s.group === g), g).toBe(true);
    expect(new Set(SETS.map((s) => s.id)).size).toBe(SETS.length);
    // (Each with its thumbnail, made by `npm run set-thumbs`.)
    for (const s of SETS) expect(existsSync(`public/sets/thumbs/${s.id}.webp`), s.id).toBe(true);
    for (const s of SETS) {
      const pieces = s.build();
      // (Built of pieces, or one ready-made scene, #27.)
      expect(pieces.length > 5 || pieces[0].shape[0] === 'scene', s.id).toBe(true);
      for (const p of pieces) expect(p.at.every(Number.isFinite), s.id).toBe(true);
    }
  });

  it('a scene keeps its set by id (an unknown one is dropped); the view draws it, out of what the camera frames', () => {
    expect(parseScene({ ...newScene('In'), set: 'courtyard' }).set).toBe('courtyard');
    expect(parseScene({ ...newScene('Out'), set: 'moon-base' }).set).toBeUndefined();
    const sv = new SceneView();
    sv.sync({ ...newScene('In'), set: 'palace' });
    expect(sv.set?.parts.bodies.length).toBeGreaterThan(5);
    const people = new THREE.Box3();
    sv.forEachPoint((p) => people.expandByPoint(p));
    const all = new THREE.Box3().setFromObject(sv.set!.object);
    expect(all.getSize(new THREE.Vector3()).x).toBeGreaterThan(people.getSize(new THREE.Vector3()).x * 4);
    // Nothing of it to pick: a click goes through to the floor.
    const hits = new THREE.Raycaster(new THREE.Vector3(0, 3, 30), new THREE.Vector3(0, 0, -1)).intersectObject(sv.set!.object, true);
    expect(hits).toHaveLength(0);
    sv.sync(newScene('Bare'));
    expect(sv.set).toBeNull();
  });

  it('drawn as one mesh per material, each part still cut away alone when it is in the view\'s way (#29)', () => {
    const sv = new SceneView();
    sv.sync({ ...newScene('In'), set: 'living-room' });
    const set = sv.set!;
    const parts = SETS.find((s) => s.id === 'living-room')!.build().filter((p) => p.shape[0] !== 'model').length;
    // (Its walls, floor, frames and the rest: far fewer meshes than parts.)
    expect(set.parts.bodies.length).toBeLessThan(parts / 3);
    const drawn = () => set.parts.bodies.reduce((n, m) => n + Array.from(m.geometry.index!.array).filter((i, k, a) => k % 3 === 0 && !(i === 0 && a[k + 1] === 0 && a[k + 2] === 0)).length, 0);
    const all = drawn();
    // The eye behind the back wall, looking in: that wall (and only what is in the way) is left out; then back.
    set.cutaway(new THREE.Vector3(0, 1.5, -7), new THREE.Vector3(0, 1, 0));
    const cut = drawn();
    expect(cut).toBeLessThan(all);
    expect(cut).toBeGreaterThan(all * 0.5);
    set.cutaway(new THREE.Vector3(0, 1.5, 6), new THREE.Vector3(0, 1, 0));
    expect(drawn()).toBe(all);
  });

  it('made of models and surfaces that npm run sets made, each within its budget; each set within its own (#25)', () => {
    for (const [id, a] of Object.entries(MODELS)) {
      expect(index.models[id], id).toBeDefined();
      expect(index.models[id].tris, id).toBeLessThanOrEqual(a.tris);
    }
    for (const id of Object.keys(SURFACES)) expect(index.surfaces[id], id).toBeDefined();
    for (const id of Object.keys(SKIES)) expect(index.skies[id], id).toBeDefined();
    // (Shapes as lib/sets.ts makes them: a box 12 triangles, a column 4 a side, a ball 20 × 14, a ring 10 × 32.)
    const shapeTris = (shape: unknown[]) => (shape[0] === 'box' ? 12 : shape[0] === 'cyl' ? 4 * ((shape[4] as number | undefined) ?? 20) : shape[0] === 'sphere' ? 520 : 640);
    for (const s of SETS) {
      const pieces = s.build();
      const tris = pieces.reduce((n, p) => n + (p.shape[0] === 'model' ? index.models[p.shape[1]].tris : p.shape[0] === 'scene' ? index.scenes[p.shape[1]].tris : shapeTris(p.shape)), 0);
      const surfaces = new Set(pieces.flatMap((p) => { const l = p.look; const id = typeof l === 'string' ? l : l?.surface; return id ? [id] : []; }));
      // (Outdoors, its sky in 3D too: the largest it could be.)
      const sky = !s.indoors ? Math.max(...Object.values(index.skies).map((x) => x.bytes)) : 0;
      const scenes = pieces.flatMap((p) => (p.shape[0] === 'scene' ? [index.scenes[p.shape[1]].bytes] : [])).reduce((n, x) => n + x, 0);
      const view = s.view ? index.views[s.view].bytes : 0;
      const bytes = setModels(s.id).reduce((n, id) => n + index.models[id].bytes, 0) + [...surfaces].reduce((n, id) => n + index.surfaces[id].bytes, 0) + sky + view + scenes;
      expect(tris, `${s.id}: triangles`).toBeLessThanOrEqual(SET_BUDGET.tris);
      expect(bytes, `${s.id}: bytes`).toBeLessThanOrEqual(SET_BUDGET.bytes);
    }
    const all = [index.models, index.surfaces, index.skies, index.views, index.scenes].flatMap((x) => Object.values(x)).reduce((n, x) => n + x.bytes, 0);
    expect(all).toBeLessThanOrEqual(100 * 1024 * 1024);
  });
});
