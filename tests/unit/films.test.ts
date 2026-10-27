import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  addFigure, addProp, addScene, applyCameraMove, applyMotion, arrange, cutShot, dribbleProp, editShot, holdProp, moveProp, setGaze, setSceneLight,
  throwProp, travelTo,
} from '@/lib/actions';
import { sceneAt } from '@/lib/animation';
import { LIGHT_PRESETS } from '@/lib/lighting';
import { buildMotion } from '@/lib/motions';
import { describeSpan } from '@/lib/prompt';
import { checkMotion } from '@/lib/qa';
import { rimOf, worldOfProp } from '@/lib/propmotion';
import { SceneView } from '@/lib/sceneview';
import { shotSpans } from '@/lib/shots';
import type { Store } from '@/lib/store';
import { body, expectClean, figureAt, fresh } from '../fixtures/scenes';

/*
 * Acceptance baseline for the redesign (issue #1): these films must keep passing at every step.
 *
 * The use case, whole: short films of several people made as a user makes them (the actions
 * behind the menus), each with its light, its shots (cut, each with a camera move, some following
 * one person), people's actions chained one after another and together, props in hand and in
 * flight, and things standing in the way. Each must come out clean: the motion check (feet,
 * bodies through each other and through props, a thrown ball through someone, joints, pops,
 * someone hidden from a shot's camera behind a prop) finds nothing, nobody goes through the floor,
 * held props stay in the hand and nothing jumps between frames.
 */

const light = (store: Store, id: string) => setSceneLight(store, LIGHT_PRESETS.find((p) => p.id === id)!.light);

/** Cut at each time and give every shot a camera move (and a subject to follow, if given). */
function shoot(store: Store, cuts: number[], moves: string[], subjects: (string | undefined)[] = []) {
  for (const t of cuts) {
    store.setTime(t);
    cutShot(store);
  }
  const spans = shotSpans(store.scene.animation!);
  expect(spans).toHaveLength(moves.length);
  for (const [i, span] of spans.entries()) {
    store.setTime(span.start);
    applyCameraMove(store, moves[i]);
    if (subjects[i]) editShot(store, span.shot.id, { subject: subjects[i] });
  }
}

/** What every film must be: clean, lit as set, cut into shots each with its own camera keys, and each shot described (for AI video tools) with its cast. */
function expectFilm(store: Store, lightId: string, people: number) {
  const scene = store.scene;
  expectClean(scene);
  expect(scene.light).toEqual(LIGHT_PRESETS.find((p) => p.id === lightId)!.light);
  const a = scene.animation!;
  const spans = shotSpans(a);
  expect(spans.length).toBeGreaterThan(1);
  for (const span of spans) {
    expect(a.camera!.keys.some((k) => k.t >= span.start - 1e-6 && k.t <= span.end + 1e-6), `${span.shot.name} ${span.start}-${span.end}: ${a.camera!.keys.map((k) => k.t).join(',')}`).toBe(true);
    const text = describeSpan(scene, span);
    expect(text, span.shot.name).toMatch(new RegExp(`${['One', 'Two', 'Three', 'Four'][people - 1]} mannequin figure`, 'i'));
  }
}

const name = (store: Store, id: string, to: string) => store.updateFigure(id, (f) => ({ ...f, name: to }));

describe('films for the use case: light, cameras, people, props, occlusion and physics together', () => {
  it('basketball: a fast break dribbled up court, a pass on the run, a shot through the hoop', () => {
    const { store, a } = fresh();
    name(store, a, 'Mia');
    store.updateFigure(a, (f) => ({ ...f, body: body('Female') }));
    addFigure(store, [2, 0, 1]);
    const b = store.getState().activeFigure!;
    name(store, b, 'Leo');
    store.updateScene((s) => ({ ...s, view: { yaw: 90, pitch: 8, fov: 42 } }));
    addProp(store, 'sphere', [0.5, 0, 0.5]);
    const ball = store.scene.props[0].id;
    moveProp(store, ball, { scale: [0.24, 0.24, 0.24] });
    holdProp(store, ball, { figure: a, hand: 'R' });
    store.setTime(0);
    store.select({ kind: 'figure', figure: b });
    addProp(store, 'hoop', [2, 0, 9.5]);
    const hoop = store.scene.props[1];

    // Mia dribbles up court while Leo runs the lane; she passes, he gathers and shoots.
    store.setTime(0);
    const run = travelTo(store, a, [0, 5], 'run')!;
    store.setTime(0);
    travelTo(store, b, [2, 6], 'run');
    store.setTime(0);
    dribbleProp(store, ball, 3);
    store.setTime(run.to);
    const pass = throwProp(store, ball, { figure: b, hand: 'R' })!;
    store.setTime(pass.to);
    const shot = throwProp(store, ball, { hoop: hoop.id })!;
    setGaze(store, a, { prop: ball });
    setGaze(store, b, { prop: hoop.id });
    light(store, 'noon');
    shoot(store, [pass.from], ['tracking', 'push'], [a, b]);

    expectFilm(store, 'noon', 2);
    // Leo has it after the pass; it goes through the rim and ends on the floor.
    expect(sceneAt(store.scene, pass.to + 0.1).props[0].hold?.figure).toBe(b);
    const at = figureAt(store.scene);
    const rim = rimOf(hoop);
    const through = worldOfProp(store.scene, ball, at, shot.to)!.position;
    expect(Math.hypot(through[0] - rim[0], through[2] - rim[2])).toBeLessThan(0.05);
    expect(sceneAt(store.scene, store.scene.animation!.duration).props[0].position[1]).toBeCloseTo(0, 2);
  }, 120_000);

  it('running: three runners down their lanes, one over a hurdle, filmed alongside', () => {
    const { store, a } = fresh();
    addFigure(store, [1.2, 0, 0]);
    const b = store.getState().activeFigure!;
    addFigure(store, [2.4, 0, 0]);
    const c = store.getState().activeFigure!;
    store.updateFigure(b, (f) => ({ ...f, body: body('Athletic') }));
    store.updateFigure(c, (f) => ({ ...f, body: body('Slender') }));
    store.updateScene((s) => ({ ...s, view: { yaw: 90, pitch: 6, fov: 44 } }));
    // A low hurdle in the middle lane.
    addProp(store, 'box', [1.2, 0, 5]);
    moveProp(store, store.scene.props[0].id, { scale: [0.9, 0.35, 0.15] });
    for (const [id, x] of [[a, 0], [c, 2.4]] as const) {
      store.setTime(0);
      travelTo(store, id, [x, 10], 'run');
    }
    store.setTime(0);
    travelTo(store, b, [1.2, 4], 'run');
    travelTo(store, b, [1.2, 6], 'jump', { height: 0.5 });
    travelTo(store, b, [1.2, 10], 'run');
    light(store, 'dusk');
    shoot(store, [1.2], ['tracking', 'hero'], [b]);
    expectFilm(store, 'dusk', 3);
    // All three finish at the line.
    const end = sceneAt(store.scene, store.scene.animation!.duration);
    for (const f of end.figures) expect(f.position[2]).toBeCloseTo(10, 1);
  }, 120_000);

  it('high jump: the flop over the bar onto the mat, a coach watching from the side', () => {
    const { store } = fresh();
    addScene(store, buildMotion('high-jump')!);
    const jumper = store.scene.figures[0].id;
    store.select({ kind: 'figure', figure: jumper });
    addFigure(store, [2.5, 0, 4]);
    const coach = store.getState().activeFigure!;
    name(store, coach, 'Coach');
    store.updateFigure(coach, (f) => ({ ...f, joints: { ...f.joints, root: [0, -90, 0] } }));
    setGaze(store, coach, { figure: jumper });
    light(store, 'noon');
    shoot(store, [1.5], ['tracking', 'static'], [jumper]);
    expectFilm(store, 'noon', 2);
    // Over the bar with room to spare.
    const bar = store.scene.props.find((p) => p.kind === 'bar')!;
    const sv = new SceneView();
    let top = 0;
    for (let t = 0; t <= store.scene.animation!.duration; t += 1 / 24) {
      sv.sync(sceneAt(store.scene, t));
      const hips = sv.figures.get(jumper)!.joints.root.getWorldPosition(new THREE.Vector3());
      if (Math.abs(hips.z - bar.position[2]) < 0.2) top = Math.max(top, hips.y);
    }
    sv.dispose();
    expect(top).toBeGreaterThan(bar.scale[1] + 0.15);
  }, 120_000);

  it('boxing: two fighters face off, an exchange, then a combination and a hit', () => {
    const { store, a } = fresh();
    name(store, a, 'Ben');
    addFigure(store, [1.5, 0, 0.5]);
    const b = store.getState().activeFigure!;
    name(store, b, 'Kai');
    store.updateFigure(b, (f) => ({ ...f, body: body('Heroic') }));
    arrange(store, a, b, 'faceEachOther');
    // Ben leads the exchange; Kai is put opposite him.
    store.setTime(0);
    expect(applyMotion(store, a, 'boxing', [b])).toBe(true);
    const later = store.scene.animation!.duration;
    store.setTime(later);
    applyMotion(store, a, 'jab-cross');
    store.setTime(later);
    applyMotion(store, b, 'block-duck');
    // The hit lands as the block and duck finishes.
    store.setTime(later + buildMotion('block-duck')!.animation!.duration);
    applyMotion(store, b, 'hit');
    setGaze(store, a, { figure: b });
    setGaze(store, b, { figure: a });
    light(store, 'side');
    shoot(store, [later], ['handheld', 'hero']);
    expectFilm(store, 'side', 2);
  }, 120_000);

  it('wrestling: they walk in, clinch, and one takes the other down', () => {
    const { store, a } = fresh();
    name(store, a, 'Ben');
    addFigure(store, [3, 0, 2]);
    const b = store.getState().activeFigure!;
    name(store, b, 'Kai');
    store.setTime(0);
    const walk = travelTo(store, a, [0, 2.5], 'walk')!;
    store.setTime(0);
    travelTo(store, b, [2.5, 3], 'walk');
    store.setTime(walk.to);
    // Kai walks over to face Ben for the clinch.
    expect(applyMotion(store, a, 'takedown', [b])).toBe(true);
    light(store, 'studio');
    shoot(store, [walk.to], ['static', 'orbit90']);
    expectFilm(store, 'studio', 2);
    // Kai ends on the floor.
    const sv = new SceneView();
    sv.sync(sceneAt(store.scene, store.scene.animation!.duration));
    expect(sv.figures.get(b)!.joints.chest.getWorldPosition(new THREE.Vector3()).y).toBeLessThan(0.5);
    sv.dispose();
  }, 120_000);

  it('rhythmic gymnastics: a ribbon routine and a hoop toss side by side, a crane up and an orbit', () => {
    const { store, a } = fresh();
    name(store, a, 'Ana');
    addProp(store, 'ribbon');
    addFigure(store, [2.5, 0, 0]);
    const b = store.getState().activeFigure!;
    name(store, b, 'Eva');
    store.updateFigure(b, (f) => ({ ...f, body: body('Slender') }));
    addProp(store, 'ring');
    const ring = store.scene.props[1].id;
    // Ana: leap, pirouette, cartwheel, one after another.
    store.setTime(0);
    applyMotion(store, a, 'leap');
    store.setTime(store.scene.animation!.duration);
    applyMotion(store, a, 'pirouette');
    store.setTime(store.scene.animation!.duration);
    applyMotion(store, a, 'cartwheel');
    // Eva tosses her hoop and catches it, then leaps.
    store.setTime(0.5);
    const toss = throwProp(store, ring, { figure: b, hand: 'R' })!;
    store.setTime(toss.to + 0.3);
    applyMotion(store, b, 'leap');
    light(store, 'soft');
    shoot(store, [3], ['crane', 'orbit360']);
    expectFilm(store, 'soft', 2);
    // The ribbon flies while Ana turns; the hoop is back in Eva's hand.
    const turning = sceneAt(store.scene, 3.6).props[0].trail!;
    expect(Math.max(...turning.map((p) => p[1]))).toBeGreaterThan(0.5);
    expect(sceneAt(store.scene, toss.to + 0.1).props[1].hold?.figure).toBe(b);
  }, 120_000);

  it('occlusion is caught: a fast break filmed from beyond the hoop, the backboard in the way', () => {
    const { store, a } = fresh();
    addProp(store, 'hoop');
    store.setTime(0);
    travelTo(store, a, [0, 3], 'run');
    // The camera looks back down the court from beyond the hoop.
    store.updateScene((s) => ({ ...s, view: { yaw: 0, pitch: 2, fov: 30 } }));
    store.setTime(0);
    applyCameraMove(store, 'static');
    expect(checkMotion(store.scene).some((i) => i.kind === 'hidden' && /behind Basketball hoop/.test(i.message))).toBe(true);
  }, 60_000);
});
