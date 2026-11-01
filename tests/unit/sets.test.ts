import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { newScene, parseScene } from '@/lib/doc';
import { SceneView } from '@/lib/sceneview';
import { SETS, SET_GROUPS, isEffect, seatNear, setModels, setTops } from '@/lib/sets';
import { groundOf } from '@/lib/surfaces';
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

  it('what lies flat on the ground (a path, the paving, a road\'s markings) casts no shadow outdoors: it would shade itself and lose the people\'s', () => {
    for (const id of ['street', 'park', 'old-street', 'temple']) {
      const sv = new SceneView();
      sv.sync({ ...newScene('Out'), set: id });
      sv.set!.castShadows(true);
      const casters: THREE.Mesh[] = [];
      sv.set!.object.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.castShadow) casters.push(o as THREE.Mesh); });
      expect(casters.length, id).toBeGreaterThan(0);
      for (const m of casters) {
        m.geometry.computeBoundingBox();
        expect(m.geometry.boundingBox!.max.y, id).toBeGreaterThan(0.06);
      }
    }
  });

  it('its low furniture and steps stood on, as props are (#29): a dais, a table, a scene\'s counter; not a wall or a roof', () => {
    const castle = groundOf([], undefined, 'castle-hall');
    // The dais the throne is on (0.5 m), the floor beside it, nothing on top of a wall.
    expect(castle(0, -15.2)).toBeCloseTo(0.5, 2);
    expect(castle(4, -10)).toBe(0);
    expect(castle(-7.8, -7)).toBe(0);
    // A café table (a model): its top, where it stands.
    expect(groundOf([], undefined, 'cafe')(-3.6, -2.6)).toBeGreaterThan(0.7);
    expect(groundOf([], undefined, 'cafe')(0, 1)).toBe(0);
    // In a ready-made scene: something stood on, nothing higher than a counter.
    const tops = setTops('diner');
    expect(tops.length).toBeGreaterThan(5);
    expect(Math.max(...tops.map((t) => t.y))).toBeLessThanOrEqual(1.2);
    // With no set, the floor.
    expect(groundOf([])(0, -15.2)).toBe(0);
  });

  it('what a view from about eye level meets of it: its walls where they are drawn (not its floor); the seat nearest a sofa\'s back', () => {
    const sv = new SceneView();
    sv.sync({ ...newScene('In'), set: 'living-room' });
    const set = sv.set!;
    const look = (from: THREE.Vector3, to: THREE.Vector3) => new THREE.Raycaster(from, to.clone().sub(from).normalize());
    const eye = new THREE.Vector3(3, 1.2, 0);
    // The back wall's face, half its thickness in from its middle; the floor below not met.
    expect(set.meet(look(eye, new THREE.Vector3(3, 1.2, -9)))!.point.z).toBeCloseTo(-4.4, 2);
    expect(set.meet(look(eye, new THREE.Vector3(3, 0, -1)))).toBeNull();
    // The sofa (its back to the window, at z -3.75): its back met at sitting height, the seat in front of it.
    const seat = seatNear('living-room', [-0.6, 0.75, -4.05])!;
    expect(seat[1]).toBeGreaterThan(0.5);
    expect(seat[1]).toBeLessThan(0.6);
    expect(seat[2]).toBeGreaterThan(-3.9);
    expect(seat[2]).toBeLessThan(-3.3);
    // High over it, or out on the floor: no seat.
    expect(seatNear('living-room', [-0.6, 1.6, -4.05])).toBeNull();
    expect(seatNear('living-room', [3, 0.1, 0])).toBeNull();
  });

  it('a ready-made scene\'s light effect (a sunbeam\'s shaft: see-through, glowing) is told from its glass and its things', () => {
    const material = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
    // (The classroom's godray: a fifth opaque, glowing; its window glass: a quarter opaque, not glowing.)
    expect(isEffect(material({ transparent: true, opacity: 0.19, emissive: new THREE.Color(0.94, 0.94, 0.94) }))).toBe(true);
    expect(isEffect(material({ transparent: true, opacity: 0.25 }))).toBe(false);
    expect(isEffect(material({ emissive: new THREE.Color(1, 1, 1) }))).toBe(false);
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
