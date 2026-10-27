import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  addFigure, addProp, addScene, applyCameraMove, applyMotion, applyUpperBody, arrange, cutShot, dribbleProp, holdHandle, holdProp, lieOn, moveProp,
  addModel, retime, setShotCamera, saveMotion, setAnimationOptions, setFigureModel, setGaze, setGrounded, setJoint, setSceneLight, throwProp, travelTo,
} from '@/lib/actions';
import { actionsOf, sceneAt, propWorldAt } from '@/lib/evaluate';
import { importMotion } from '@/lib/importmotion';
import { importModel } from '@/lib/model';
import { LIGHT_PRESETS } from '@/lib/lighting';
import { buildMotion } from '@/lib/motions';
import { describeSpan } from '@/lib/prompt';
import { checkMotion } from '@/lib/qa';
import { rimOf } from '@/lib/propmotion';
import { withFacing } from '@/lib/relations';
import { SceneView } from '@/lib/sceneview';
import { shotSpans } from '@/lib/shots';
import type { Store } from '@/lib/store';
import { CMU, bvh } from '../fixtures/bvh';
import { characterGltf } from '../fixtures/gltf';
import { body, expectClean, fresh } from '../fixtures/scenes';

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
    if (subjects[i]) setShotCamera(store, span.shot.id, { subject: subjects[i] });
    applyCameraMove(store, moves[i]);
  }
}

/** What every film must be: clean, lit as set, cut into shots each with its own camera path, and each shot described (for AI video tools) with its cast. */
function expectFilm(store: Store, lightId: string, people: number) {
  const scene = store.scene;
  expectClean(scene);
  expect(scene.light).toEqual(LIGHT_PRESETS.find((p) => p.id === lightId)!.light);
  const a = scene.animation!;
  const spans = shotSpans(a);
  expect(spans.length).toBeGreaterThan(1);
  for (const span of spans) {
    expect(span.shot.points.length, `${span.shot.name} ${span.start}-${span.end}`).toBeGreaterThan(0);
    const text = describeSpan(scene, span);
    expect(text, span.shot.name).toMatch(new RegExp(`${['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'][people - 1]} mannequin figure`, 'i'));
  }
}

const name = (store: Store, id: string, to: string) => store.updateFigure(id, (f) => ({ ...f, name: to }));

/** Two fighters of these builds face off, exchange punches, then one throws a combination and the other takes a hit. */
function boxing(ben: string, kai: string) {
  const { store, a } = fresh();
  name(store, a, 'Ben');
  store.updateFigure(a, (f) => ({ ...f, body: body(ben) }));
  addFigure(store, [1.5, 0, 0.5]);
  const b = store.getState().activeFigure!;
  name(store, b, 'Kai');
  store.updateFigure(b, (f) => ({ ...f, body: body(kai) }));
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
  return { store, later };
}

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
    const rim = rimOf(hoop);
    const through = propWorldAt(store.scene, ball, shot.to)!.position;
    expect(Math.hypot(through[0] - rim[0], through[2] - rim[2])).toBeLessThan(0.05);
    expect(sceneAt(store.scene, store.scene.animation!.duration).props[0].position[1]).toBeCloseTo(0, 2);
  }, 120_000);

  it('a passing drill: two pass on the run, the third steps in to cut a pass off and shoots', () => {
    const { store, a } = fresh();
    name(store, a, 'Mia');
    addFigure(store, [3, 0, 1]);
    const b = store.getState().activeFigure!;
    name(store, b, 'Leo');
    addFigure(store, [1.6, 0, 3.6]);
    const c = store.getState().activeFigure!;
    name(store, c, 'Sam');
    store.updateFigure(c, (f) => ({ ...f, body: body('Heroic') }));
    store.updateScene((s) => ({ ...s, view: { yaw: 90, pitch: 8, fov: 44 } }));
    addProp(store, 'sphere', [0.5, 0, 0.5]);
    const ball = store.scene.props[0].id;
    moveProp(store, ball, { scale: [0.24, 0.24, 0.24] });
    holdProp(store, ball, { figure: a, hand: 'R' });
    addProp(store, 'hoop', [1.5, 0, 9]);
    const hoop = store.scene.props[1];

    // Mia and Leo run up court passing; Sam waits between them, his arm up.
    store.setTime(0);
    const run = travelTo(store, a, [0, 3], 'run')!;
    store.setTime(0);
    travelTo(store, b, [3, 4.2], 'run');
    store.setTime(0);
    setJoint(store, c, 'rightUpperArm', [-165, 0, -15], '');
    store.setTime(run.to);
    const p1 = throwProp(store, ball, { figure: b, hand: 'R' })!;
    store.setTime(p1.to + 0.6);
    const p2 = throwProp(store, ball, { figure: a, hand: 'R' })!;
    // Scrubbing through Leo's pass back: where it comes nearest Sam's hand, he takes it out of the air.
    const sv = new SceneView();
    let cut = { t: 0, d: Infinity };
    for (let t = p2.from; t < p2.to; t += 1 / 24) {
      sv.sync(sceneAt(store.scene, t));
      const hand = sv.figures.get(c)!.joints.rightHand.getWorldPosition(new THREE.Vector3());
      const d = hand.distanceTo(new THREE.Vector3(...propWorldAt(store.scene, ball, t)!.position));
      if (d < cut.d) cut = { t, d };
    }
    sv.dispose();
    store.setTime(cut.t);
    holdProp(store, ball, { figure: c, hand: 'R' });
    const shot = throwProp(store, ball, { hoop: hoop.id })!;
    setGaze(store, c, { prop: ball });
    light(store, 'noon');
    shoot(store, [p2.from], ['tracking', 'push'], [a, c]);

    expectFilm(store, 'noon', 3);
    // Sam has it; Mia never gets it back; it goes through the rim.
    expect(sceneAt(store.scene, shot.from - 0.1).props[0].hold?.figure).toBe(c);
    expect(sceneAt(store.scene, p2.to + 0.1).props[0].hold?.figure).toBe(c);
    const rim = rimOf(hoop);
    const through = propWorldAt(store.scene, ball, shot.to)!.position;
    expect(Math.hypot(through[0] - rim[0], through[2] - rim[2])).toBeLessThan(0.05);
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

  it('a relay: four runners, the baton handed on three times, each taking it as the last arrives', () => {
    const { store, a } = fresh();
    const runners = [a];
    // Each waits at the end of the leg before, a step to the side; they take it in the other hand.
    for (let i = 1; i < 4; i++) {
      addFigure(store, [-0.35 * (i % 2), 0, i * 8]);
      runners.push(store.getState().activeFigure!);
    }
    runners.forEach((id, i) => name(store, id, ['Ana', 'Ben', 'Cleo', 'Dev'][i]));
    store.updateFigure(runners[2], (f) => ({ ...f, body: body('Athletic') }));
    store.updateScene((s) => ({ ...s, view: { yaw: 90, pitch: 6, fov: 50 } }));
    addProp(store, 'stick');
    const baton = store.scene.props[0].id;
    holdProp(store, baton, { figure: a, hand: 'R' });
    store.setTime(0);
    let leg = travelTo(store, a, [0, 7.6], 'run')!;
    const handoffs: number[] = [];
    for (let i = 1; i < 4; i++) {
      const hand = i % 2 ? 'L' : 'R';
      // The next one reaches back as the runner comes in, takes the baton, and is off.
      store.setTime(leg.to - 0.4);
      setJoint(store, runners[i], hand === 'L' ? 'leftUpperArm' : 'rightUpperArm', [30, 0, hand === 'L' ? 10 : -10], '');
      store.setTime(leg.to);
      handoffs.push(leg.to);
      holdProp(store, baton, { figure: runners[i], hand });
      store.setTime(leg.to);
      leg = travelTo(store, runners[i], [-0.35 * (i % 2), i * 8 + 7.9], 'run')!;
    }
    light(store, 'dusk');
    shoot(store, handoffs, ['tracking', 'tracking', 'tracking', 'hero'], runners);

    expectFilm(store, 'dusk', 4);
    // Each has the baton after taking it, and the last brings it home.
    handoffs.forEach((t, i) => expect(sceneAt(store.scene, t + 0.2).props[0].hold?.figure).toBe(runners[i + 1]));
    const end = sceneAt(store.scene, store.scene.animation!.duration);
    expect(end.props[0].hold?.figure).toBe(runners[3]);
    expect(end.figures.find((f) => f.id === runners[3])!.position[2]).toBeCloseTo(31.9, 1);
  }, 120_000);

  it('films keep passing when an action is retimed: the relay\'s handoffs stay in step', () => {
    // The relay: each leg in turn takes longer; the baton still changes hands as each runner arrives.
    for (const legNo of [0, 1, 2]) {
      const { store, a } = fresh();
      const runners = [a];
      for (let i = 1; i < 4; i++) {
        addFigure(store, [-0.35 * (i % 2), 0, i * 8]);
        runners.push(store.getState().activeFigure!);
      }
      addProp(store, 'stick');
      const baton = store.scene.props[0].id;
      holdProp(store, baton, { figure: a, hand: 'R' });
      store.setTime(0);
      let leg = travelTo(store, a, [0, 7.6], 'run')!;
      for (let i = 1; i < 4; i++) {
        const hand = i % 2 ? 'L' : 'R';
        store.setTime(leg.to - 0.4);
        setJoint(store, runners[i], hand === 'L' ? 'leftUpperArm' : 'rightUpperArm', [30, 0, hand === 'L' ? 10 : -10], '');
        store.setTime(leg.to);
        holdProp(store, baton, { figure: runners[i], hand });
        store.setTime(leg.to);
        leg = travelTo(store, runners[i], [-0.35 * (i % 2), i * 8 + 7.9], 'run')!;
      }
      const run = actionsOf(store.scene.animation!, runners[legNo]).find((x) => x.source.kind === 'travel')!;
      retime(store, run.id, run.duration * 1.2);
      expectClean(store.scene);
      expect(sceneAt(store.scene, store.scene.animation!.duration).props[0].hold?.figure).toBe(runners[3]);
    }
  }, 300_000);

  it('a stretcher carried off past a group dance: two carry, one lies on it, four dance', () => {
    const { store, a } = fresh();
    name(store, a, 'Medic');
    addFigure(store, [3, 0, -2.75]);
    const b = store.getState().activeFigure!;
    name(store, b, 'Aide');
    store.updateFigure(a, (f) => ({ ...withFacing(f, 0), position: [3, f.position[1], 0] }));
    addFigure(store, [4.5, 0, -1]);
    const c = store.getState().activeFigure!;
    name(store, c, 'Hurt');
    store.updateFigure(c, (f) => ({ ...f, body: body('Slender') }));
    addProp(store, 'box', [3, 0, -1]);
    const stretcher = store.scene.props[0].id;
    moveProp(store, stretcher, { scale: [2.6, 0.06, 0.55] });
    // The dancers, off to the side.
    const dancers: string[] = [];
    for (const x of [-2, -3, -1, -2]) {
      addFigure(store, [x, 0, dancers.length]);
      dancers.push(store.getState().activeFigure!);
    }
    store.updateScene((s) => ({ ...s, view: { yaw: 20, pitch: 12, fov: 55 } }));
    store.setTime(0);
    expect(applyMotion(store, dancers[0], 'group-dance', dancers.slice(1))).toBe(true);
    store.setTime(2);
    expect(applyMotion(store, dancers[0], 'group-dance', dancers.slice(1))).toBe(true);
    setAnimationOptions(store, { loop: false });

    // The medic takes the stretcher's front handle, the aide the back; the hurt one lies on it, and off they go.
    store.setTime(0);
    holdProp(store, stretcher, { figure: a, hand: 'R' });
    store.setTime(0);
    setJoint(store, c, 'hips', [-90, 180, 0], '');
    setGrounded(store, c, false);
    store.setTime(0);
    const walk = travelTo(store, a, [3, 3], 'walk')!;
    store.setTime(0);
    travelTo(store, b, [3, 0.25], 'walk');
    for (const id of [a, b]) {
      store.setTime(0);
      expect(applyUpperBody(store, id, 'carry')).toBe(true);
    }
    store.setTime(0);
    expect(holdHandle(store, b, stretcher, 'R')).not.toBeNull();
    store.setTime(0);
    expect(lieOn(store, c, stretcher)).not.toBeNull();
    store.select({ kind: 'figure', figure: a });
    light(store, 'studio');
    shoot(store, [1.2], ['static', 'tracking'], [undefined, a]);

    expectFilm(store, 'studio', 7);
    // Carried level all the way, the aide's hand on the back handle and the hurt one on top.
    const sv = new SceneView();
    for (const t of [0.5, 1.5, walk.to - 0.2]) {
      const s = sceneAt(store.scene, t);
      sv.sync(s);
      const place = propWorldAt(store.scene, stretcher, t)!;
      expect(place.rotation[0]).toBeCloseTo(0, 0);
      expect(place.rotation[2]).toBeCloseTo(0, 0);
      const back = new THREE.Vector3(-1.3, 0.03, 0).applyEuler(new THREE.Euler(0, place.rotation[1] * (Math.PI / 180), 0)).add(new THREE.Vector3(...place.position));
      expect(sv.figures.get(b)!.joints.rightHand.getWorldPosition(new THREE.Vector3()).distanceTo(back), String(t)).toBeLessThan(0.2);
      expect(sv.figures.get(c)!.joints.hips.getWorldPosition(new THREE.Vector3()).y).toBeGreaterThan(place.position[1]);
    }
    sv.dispose();
  }, 120_000);

  it('high jump: the flop over the bar onto the mat, a coach watching from the side', () => {
    const { store } = fresh();
    addScene(store, buildMotion('high-jump')!);
    const jumper = store.scene.figures[0].id;
    store.select({ kind: 'figure', figure: jumper });
    addFigure(store, [2.5, 0, 4]);
    const coach = store.getState().activeFigure!;
    name(store, coach, 'Coach');
    store.updateFigure(coach, (f) => withFacing(f, -90));
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
      const hips = sv.figures.get(jumper)!.joints.hips.getWorldPosition(new THREE.Vector3());
      if (Math.abs(hips.z - bar.position[2]) < 0.2) top = Math.max(top, hips.y);
    }
    sv.dispose();
    expect(top).toBeGreaterThan(bar.scale[1] + 0.15);
  }, 120_000);

  it('boxing: two fighters face off, an exchange, then a combination and a hit', () => {
    const { store, later } = boxing('Female', 'Heroic');
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

  it('an imported character steps forward as an imported capture has it, then walks on, drawn as itself', async () => {
    const { store, a } = fresh();
    name(store, a, 'Hero');
    // A Mixamo-style character (glTF) and a CMU-style capture (BVH), both imported.
    const model = await importModel('Hero.gltf', new TextEncoder().encode(characterGltf(true)).buffer as ArrayBuffer);
    addModel(store, model);
    setFigureModel(store, a, model.id);
    const step = await importMotion('Step forward.bvh', new TextEncoder().encode(bvh(CMU)).buffer as ArrayBuffer);
    saveMotion(store, step);
    addFigure(store, [2, 0, 0]);
    const b = store.getState().activeFigure!;
    store.setTime(0);
    expect(applyMotion(store, a, step.id)).toBe(true);
    store.setTime(store.scene.animation!.duration);
    const walk = travelTo(store, a, [0, 2.5], 'walk')!;
    store.setTime(0);
    applyMotion(store, b, step.id);
    light(store, 'studio');
    shoot(store, [walk.from], ['static', 'tracking'], [undefined, a]);
    expectFilm(store, 'studio', 2);
    // Drawn as the character, its feet where the mannequin's are: the planted one stays put.
    const sv = new SceneView();
    const foot = (t: number) => {
      sv.sync(sceneAt(store.scene, t));
      return sv.models.get(a)!.object.getObjectByName(model.bones.rightFoot!)!.getWorldPosition(new THREE.Vector3());
    };
    const planted = foot(0);
    for (const t of [0.1, step.duration]) expect(Math.hypot(foot(t).x - planted.x, foot(t).z - planted.z), String(t)).toBeLessThan(0.03);
    sv.sync(sceneAt(store.scene, walk.to));
    const mannequinFoot = sv.figures.get(a)!.joints.leftFoot.getWorldPosition(new THREE.Vector3());
    expect(sv.models.get(a)!.object.getObjectByName(model.bones.leftFoot!)!.getWorldPosition(new THREE.Vector3()).distanceTo(mannequinFoot)).toBeLessThan(0.08);
    sv.dispose();
  }, 120_000);

  it('contacts hold on any bodies: the boxing exchange between builds big and small, a waltz between grown-ups', () => {
    for (const [x, y] of [['Child', 'Heroic'], ['Heroic', 'Child'], ['Slender', 'Athletic'], ['Male', 'Female']]) expectClean(boxing(x, y).store.scene);
    for (const [x, y] of [['Slender', 'Heroic'], ['Athletic', 'Slender'], ['Male', 'Female']]) {
      const { store, a } = fresh();
      addFigure(store, [1, 0, 0]);
      const b = store.getState().activeFigure!;
      store.updateFigure(a, (f) => ({ ...f, body: body(x) }));
      store.updateFigure(b, (f) => ({ ...f, body: body(y) }));
      expect(applyMotion(store, b, 'waltz-turn', [a])).toBe(true);
      expectClean(store.scene);
    }
  }, 600_000);

  it('physics, not special code: a pass blocked by someone in its way is reported; a shot off the rim rolls away', () => {
    const { store, a } = fresh();
    addFigure(store, [0, 0, 4]);
    const b = store.getState().activeFigure!;
    store.updateFigure(b, (f) => withFacing(f, 180));
    // Someone tall in between, arms up.
    addFigure(store, [0, 0, 2]);
    const c = store.getState().activeFigure!;
    store.updateFigure(c, (f) => ({ ...withFacing(f, 180), body: body('Heroic') }));
    store.setTime(0);
    setJoint(store, c, 'leftUpperArm', [-160, 0, 15], '');
    setJoint(store, c, 'rightUpperArm', [-160, 0, -15], '');
    addProp(store, 'sphere', [0.5, 0, 0.5]);
    const ball = store.scene.props[0].id;
    moveProp(store, ball, { scale: [0.24, 0.24, 0.24] });
    holdProp(store, ball, { figure: a, hand: 'R' });
    store.setTime(0.2);
    throwProp(store, ball, { figure: b, hand: 'R' });
    // Not caught: it hit the one in the way, and the check says so.
    const misses = checkMotion(store.scene).filter((i) => i.kind === 'miss');
    expect(misses.map((i) => i.figure)).toEqual([b]);
    expect(sceneAt(store.scene, store.scene.animation!.duration).props[0].hold).toBeUndefined();

    // A shot off the front of the rim: it does not go through, and ends up on the floor away from it.
    const shot = fresh();
    addProp(shot.store, 'sphere', [0.5, 0, 0.5]);
    const ball2 = shot.store.scene.props[0].id;
    moveProp(shot.store, ball2, { scale: [0.24, 0.24, 0.24] });
    holdProp(shot.store, ball2, { figure: shot.a, hand: 'R' });
    addProp(shot.store, 'hoop', [0, 0, 5]);
    const hoop = shot.store.scene.props[1];
    shot.store.setTime(0);
    const miss = throwProp(shot.store, ball2, { hoop: hoop.id, miss: true })!;
    const rim = rimOf(hoop);
    const at = propWorldAt(shot.store.scene, ball2, miss.to)!.position;
    expect(Math.hypot(at[0] - rim[0], at[2] - rim[2])).toBeGreaterThan(0.1);
    const end = sceneAt(shot.store.scene, shot.store.scene.animation!.duration).props[0].position;
    expect(end[1]).toBeCloseTo(0, 2);
    expect(Math.hypot(end[0] - rim[0], end[2] - rim[2])).toBeGreaterThan(0.3);
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
