import { expect } from 'vitest';
import { addFigure, addProp, applyMotion, applyUpperBody, carryProblem, holdHandle, holdProp, lieOn, motionProblem, moveProp, setAnimationOptions, setGrounded, setJoint, travelTo } from '@/lib/actions';
import { BODY_PRESETS } from '@/lib/body';
import { checkMotion } from '@/lib/qa';
import { withFacing } from '@/lib/relations';
import type { BodyParams } from '@/lib/types';
import { fresh } from './scenes';

/*
 * Motions of several people on every pairing of body presets, done as a user does them; each
 * clean (no slides, overlaps, pops, missed contacts or joints past their range), or declined
 * with a reason when the builds cannot do it together.
 */

export const PAIRS = BODY_PRESETS.flatMap((a) => BODY_PRESETS.map((b) => [a, b] as const));

const problems = (scene: Parameters<typeof checkMotion>[0]) => checkMotion(scene).filter((i) => i.kind !== 'camera' && i.kind !== 'hidden').map((i) => i.message);

/** Two people side by side, in the lead's and the partner's builds. */
function two(lead: BodyParams, partner: BodyParams, at: [number, number, number] = [1, 0, 0]) {
  const { store, a } = fresh();
  store.updateFigure(a, (f) => ({ ...f, body: { ...lead } }));
  addFigure(store, at);
  const b = store.getState().activeFigure!;
  store.updateFigure(b, (f) => ({ ...f, body: { ...partner } }));
  return { store, a, b };
}

/** A motion of two, on the spot (`runIn`: after both walk in from apart, as in a film). */
export function expectPair(motion: string, [pa, pb]: (typeof PAIRS)[number], runIn = false) {
  const what = `${motion}${runIn ? ' (run in)' : ''}: ${pa.name} + ${pb.name}`;
  const { store, a, b } = two(pa.body, pb.body, runIn ? [3, 0, 2] : [1, 0, 0]);
  store.setTime(0);
  if (runIn) {
    const walk = travelTo(store, a, [0, 2.5], 'walk')!;
    store.setTime(0);
    travelTo(store, b, [2.5, 3], 'walk');
    store.setTime(walk.to);
  }
  const why = motionProblem(store, motion, [a, b]);
  expect(applyMotion(store, a, motion, [b]), what).toBe(!why);
  if (!why) expect(problems(store.scene), what).toEqual([]);
  return why;
}

/** Four in a group dance, the builds round the presets from `k`. */
export function expectGroup(k: number) {
  const { store, a } = fresh();
  const ids = [a];
  for (let i = 1; i < 4; i++) {
    addFigure(store, [i, 0, 0]);
    ids.push(store.getState().activeFigure!);
  }
  ids.forEach((id, i) => store.updateFigure(id, (f) => ({ ...f, body: { ...BODY_PRESETS[(k + i) % BODY_PRESETS.length].body } })));
  store.setTime(0);
  expect(applyMotion(store, a, 'group-dance', ids.slice(1))).toBe(true);
  expect(problems(store.scene), `group dance from ${BODY_PRESETS[k].name}`).toEqual([]);
}

/** A stretcher carried off by two, one lying on it (in the first preset's build). */
export function expectStretcher([pa, pb]: (typeof PAIRS)[number]) {
  const what = `stretcher: ${pa.name} in front, ${pb.name} behind`;
  const { store, a, b } = two(pa.body, pb.body, [3, 0, -2.75]);
  store.updateFigure(a, (f) => ({ ...withFacing(f, 0), position: [3, f.position[1], 0] }));
  addFigure(store, [4.5, 0, -1]);
  const c = store.getState().activeFigure!;
  addProp(store, 'box', [3, 0, -1]);
  const st = store.scene.props[0].id;
  moveProp(store, st, { scale: [2.6, 0.06, 0.55] });
  store.setTime(0);
  holdProp(store, st, { figure: a, hand: 'R' });
  store.setTime(0);
  setJoint(store, c, 'hips', [-90, 180, 0], '');
  setGrounded(store, c, false);
  store.setTime(0);
  travelTo(store, a, [3, 3], 'walk');
  store.setTime(0);
  travelTo(store, b, [3, 0.25], 'walk');
  for (const id of [a, b]) {
    store.setTime(0);
    applyUpperBody(store, id, 'carry');
  }
  store.setTime(0);
  const why = carryProblem(store, b, st);
  expect(holdHandle(store, b, st, 'R') !== null, what).toBe(!why);
  if (why) return why;
  store.setTime(0);
  lieOn(store, c, st);
  setAnimationOptions(store, { loop: false });
  expect(problems(store.scene), what).toEqual([]);
  return null;
}
