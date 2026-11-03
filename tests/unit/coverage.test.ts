import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { addFigure, addProp, applyMotion, arrange, coverScene, deleteFigure, sayLine, editRig, holdProp, moveProp, removeShotCut, retime, startAnimation, throwProp, travelTo } from '@/lib/actions';
import { actionsOf } from '@/lib/evaluate';
import { parseScene } from '@/lib/doc';
import { sceneAt } from '@/lib/evaluate';
import { describeSpan } from '@/lib/prompt';
import { checkMotion, checkShots } from '@/lib/qa';
import { Rig } from '@/lib/relations';
import { SHOT_ASPECT, cameraAt, placeCamera, sizeOf, viewOf } from '@/lib/cameras';
import { shotSpans } from '@/lib/shots';
import type { Camera, Scene } from '@/lib/types';
import { captured, fresh } from '../fixtures/scenes';

/** Where on screen (−1 … 1) a figure's chest is seen by a camera at t. */
function chestOn(scene: Scene, cam: Camera, t: number, figure: string) {
  const rig = new Rig();
  const chest = rig.model(sceneAt(scene, t).figures.find((f) => f.id === figure)!).joints.chest.getWorldPosition(new THREE.Vector3());
  rig.dispose();
  const three = new THREE.PerspectiveCamera(30, SHOT_ASPECT);
  placeCamera(three, viewOf(scene, cam, t), SHOT_ASPECT);
  return chest.project(three);
}

/** Two people facing each other, a metre and a half apart. */
function twoPeople() {
  const { store, a } = fresh();
  addFigure(store, [1.5, 0, 0.5]);
  const b = store.getState().activeFigure!;
  arrange(store, a, b, 'faceEachOther');
  return { store, a, b };
}

const byKey = (scene: Scene, key: string) => scene.cameras.find((c) => c.made?.endsWith(`:${key}`))!;

describe('coverage: cameras on roles and cuts on what happens', () => {
  it('covers a group: a wide shot of everyone and a single each, cut to whoever says a line; one gone, their camera goes', () => {
    const { store, a, b } = twoPeople();
    addFigure(store, [-1.5, 0, 0.5]);
    const c = store.getState().activeFigure!;
    startAnimation(store, 14);
    captured('talking');
    store.setTime(3);
    expect(sayLine(store, b, 'Where were you last night?')).toBeTruthy();
    store.setTime(8);
    expect(sayLine(store, c, 'Out.')).toBeTruthy();
    store.select({ kind: 'figure', figure: a });
    expect(coverScene(store, 'group')).toEqual({ A: a });
    const cams = () => store.scene.cameras.filter((x) => x.made?.startsWith('group:'));
    expect(cams().map((x) => x.name)).toEqual(['Wide on everyone', 'Figure single', 'Figure 2 single', 'Figure 3 single']);
    const spans = shotSpans(store.scene.animation!);
    expect(spans.map((s) => [s.start, cams().find((x) => x.id === s.shot.camera)!.name])).toEqual([[0, 'Wide on everyone'], [3, 'Figure 2 single'], [8, 'Figure 3 single']]);
    // (Each single on their own.)
    expect(cams()[3]).toMatchObject({ subject: c, kind: 'rig' });
    deleteFigure(store, c);
    expect(coverScene(store, 'group')).toEqual({ A: a });
    expect(cams().map((x) => x.name)).toEqual(['Wide on everyone', 'Figure single', 'Figure 2 single']);
  });

  it('covers a dialogue from one side of the line between the two, singles clean, cut on who talks', () => {
    const { store, a, b } = twoPeople();
    startAnimation(store, 12);
    // A talks, then B.
    const talk = captured('talking');
    store.setTime(1);
    applyMotion(store, a, talk);
    store.setTime(6);
    applyMotion(store, b, talk);
    store.select({ kind: 'figure', figure: a });
    store.setTime(0);
    expect(coverScene(store, 'dialogue')).toEqual({ A: a, B: b });
    const scene = store.scene;
    // The scene's own camera stays, filming nothing now.
    const [own, ...cams] = scene.cameras;
    expect(own.made).toBeUndefined();
    expect(cams.map((c) => c.name)).toEqual(['Master', 'Figure over Figure 2’s shoulder', 'Figure 2 over Figure’s shoulder', 'Figure single', 'Figure 2 single']);
    // Cut on who talks: the master, then each over the other's shoulder as they talk.
    const spans = shotSpans(scene.animation!);
    expect(spans.map((s) => [s.start, cams.find((c) => c.id === s.shot.camera)!.name])).toEqual([[0, 'Master'], [1, 'Figure over Figure 2’s shoulder'], [6, 'Figure 2 over Figure’s shoulder']]);
    // Every camera on the same side of the line from A to B.
    const pa = new THREE.Vector3(...scene.figures[0].position);
    const pb = new THREE.Vector3(...scene.figures[1].position);
    const side = (c: Camera) => Math.sign(new THREE.Vector3().crossVectors(pb.clone().sub(pa), viewOf(scene, c, 1).position.sub(pa)).y);
    expect(new Set(cams.map(side)).size).toBe(1);
    // Singles: their figure close up on a third, looking across the frame at the other, who is out of it.
    const single = byKey(scene, 'single-a');
    expect(sizeOf(scene, single, 1, viewOf(scene, single, 1))).toBe('mcu');
    expect(chestOn(scene, single, 1, a).x).toBeCloseTo(1 / 3, 1);
    expect(Math.abs(chestOn(scene, single, 1, b).x)).toBeGreaterThan(1);
    expect(chestOn(scene, byKey(scene, 'single-b'), 1, b).x).toBeCloseTo(-1 / 3, 1);
    // Over the shoulder: the other's shoulder in the near side of the frame.
    const ots = byKey(scene, 'ots-a');
    const near = chestOn(scene, ots, 1, b);
    expect(near.x).toBeLessThan(0);
    expect(near.z).toBeLessThan(chestOn(scene, ots, 1, a).z);
    // The camera never goes through anyone; each shot can be described.
    expect(checkMotion(scene).filter((i) => i.kind === 'camera')).toEqual([]);
    for (const s of spans) expect(describeSpan(scene, s)).toMatch(/two mannequin figures/i);
    expect(parseScene(JSON.parse(JSON.stringify(scene)))).toEqual(scene);
  }, 30_000);

  it('cuts to the one who gets the ball as it is let go, and to a tracking camera when they set off', () => {
    const { store, a, b } = twoPeople();
    addProp(store, 'sphere', [0.3, 0, 0.3]);
    const ball = store.scene.props[0].id;
    moveProp(store, ball, { scale: [0.24, 0.24, 0.24] });
    holdProp(store, ball, { figure: a, hand: 'R' });
    startAnimation(store, 6);
    store.setTime(1.5);
    const pass = throwProp(store, ball, { figure: b, hand: 'R' })!;
    store.setTime(pass.to + 0.5);
    const run = travelTo(store, a, [-1, 3], 'run')!;
    store.select({ kind: 'figure', figure: a });
    coverScene(store, 'sports');
    const a2 = store.scene.animation!;
    const cut = shotSpans(a2).map((s) => [Math.round(s.start * a2.fps), store.scene.cameras.find((c) => c.id === s.shot.camera)!.made]);
    expect(cut).toContainEqual([Math.round(pass.from * a2.fps), 'sports:single-b']);
    expect(cut).toContainEqual([Math.round(run.from * a2.fps), 'sports:track-a']);
    expect(cut[0]).toEqual([0, 'sports:wide']);
  });

  it('keeps framing when the blocking changes; applied again it recuts, leaving cameras edited by hand', () => {
    const { store, a, b } = twoPeople();
    startAnimation(store, 12);
    // A long speech of A's: over B's shoulder, closer, B listening a moment, A again.
    store.setTime(1);
    applyMotion(store, a, captured('talking'));
    retime(store, actionsOf(store.scene.animation!, a).find((x) => x.source.kind === 'clip')!.id, 9);
    store.select({ kind: 'figure', figure: a });
    coverScene(store, 'dialogue');
    const before = store.scene.cameras.slice(1);
    // Other blocking: B a step further away and round to the side. The singles still hold.
    store.updateFigure(b, (f) => ({ ...f, position: [2.5, 0, 1.5] }));
    arrange(store, a, b, 'faceEachOther');
    for (const key of ['single-a', 'single-b']) {
      const cam = byKey(store.scene, key);
      expect(sizeOf(store.scene, cam, 2, viewOf(store.scene, cam, 2)), key).toBe('mcu');
    }
    // A single edited by hand, a cut removed: applied again, the coverage cuts anew; the edited
    // camera is as it was edited, the others are as the coverage makes them.
    editRig(store, byKey(store.scene, 'single-a').id, { yaw: 45 });
    removeShotCut(store, shotSpans(store.scene.animation!)[1].shot.id);
    expect(store.scene.cameras).toHaveLength(6);
    coverScene(store, 'dialogue');
    const after = store.scene.cameras.slice(1);
    expect(after.map((c) => c.id)).toEqual(before.map((c) => c.id));
    expect(byKey(store.scene, 'single-a')).toMatchObject({ rig: { yaw: 45 } });
    expect(byKey(store.scene, 'single-b')).toEqual(before[4]);
    expect(shotSpans(store.scene.animation!)).toHaveLength(5);
    expect(cameraAt(store.scene, 5).position.distanceTo(viewOf(store.scene, byKey(store.scene, 'single-a'), 5).position)).toBeLessThan(1e-9);
    // Another coverage over it: the dialogue's cameras go, but the one edited by hand stays.
    coverScene(store, 'follow');
    const names = store.scene.cameras.map((c) => c.made);
    expect(names.filter((m) => m?.startsWith('dialogue:'))).toEqual(['dialogue:single-a']);
    expect(names.filter((m) => m?.startsWith('follow:'))).toHaveLength(4);
  });

  it('reports the other person of a two-shot hidden behind a prop', () => {
    const { store, a, b } = twoPeople();
    startAnimation(store, 2);
    store.select({ kind: 'figure', figure: a });
    coverScene(store, 'dialogue');
    const master = byKey(store.scene, 'master');
    const from = viewOf(store.scene, master, 0).position;
    const fb = store.scene.figures.find((f) => f.id === b)!;
    // A wall half way from the master camera to B (not to A).
    const mid = from.clone().lerp(new THREE.Vector3(fb.position[0], 0, fb.position[2]), 0.5);
    addProp(store, 'box', [mid.x, 0, mid.z]);
    const wall = store.scene.props.at(-1)!.id;
    moveProp(store, wall, { scale: [0.6, 2.2, 0.6] });
    // (Held where it was: placed again, it goes round the wall, as a camera does.)
    const look = viewOf(store.scene, master, 0).target;
    store.updateScene((s) => ({ ...s, cameras: s.cameras.map((c) => (c.id === master.id && c.kind === 'rig' ? { ...c, rig: { ...c.rig, fixed: { position: from.toArray() as [number, number, number], look: look.toArray() as [number, number, number] } } } : c)) }));
    expect(checkShots(store.scene).filter((i) => i.kind === 'hidden').map((i) => i.figure)).toContain(b);
  });
});
