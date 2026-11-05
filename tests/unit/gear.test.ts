import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { addProp, applyMotion } from '@/lib/actions';
import { figurePoseAt, propWorldAt } from '@/lib/evaluate';
import { GEAR } from '@/lib/hold';
import { Rig } from '@/lib/relations';
import { captured, fresh } from '../fixtures/scenes';

/* A Library motion that holds something brings it to the hand that holds it (lib/hold.ts GEAR). */

const holding = (store: ReturnType<typeof fresh>['store'], figure: string) => store.scene.props.filter((p) => p.hold?.figure === figure).map((p) => `${p.kind}@${p.hold!.hand}`).sort();

describe('the gear a motion holds', () => {
  it('comes to the hand that holds it: a pistol to one aiming, a sword and a shield, a phone; one undo takes it away with the motion', () => {
    for (const [slug, want] of [['pistol-idle', ['pistol@R']], ['sword-and-shield-idle', ['shield@L', 'sword@R']], ['texting-while-standing', ['phone@R']], ['drinking', ['cup@L']]] as const) {
      const { store, a } = fresh();
      expect(applyMotion(store, a, captured(slug)), slug).toBe(true);
      expect(holding(store, a), slug).toEqual(want);
      store.undo();
      expect(store.scene.props, slug).toHaveLength(0);
    }
    // (Every motion named holds something it has.)
    for (const [slug, gear] of Object.entries(GEAR)) expect(gear.length, slug).toBeGreaterThan(0);
  });

  it('given again, or to a hand already holding something, nothing more is put in it', () => {
    const { store, a } = fresh();
    applyMotion(store, a, captured('pistol-idle'));
    applyMotion(store, a, captured('pistol-whip'));
    expect(holding(store, a)).toEqual(['pistol@R']);
    const { store: s2, a: b } = fresh();
    addProp(s2, 'book');
    applyMotion(s2, b, captured('talking-on-phone'));
    expect(holding(s2, b)).toEqual(['book@R']);
  });

  it('a box carried in both hands sits between them, level, as wide as they are apart', () => {
    const { store, a } = fresh();
    applyMotion(store, a, captured('carrying'));
    const box = store.scene.props.find((p) => p.kind === 'box')!;
    const t = store.getState().time + 1;
    const m = new Rig().model(figurePoseAt(store.scene, a, t)!);
    const [l, r] = (['leftHand', 'rightHand'] as const).map((j) => m.joints[j].getWorldPosition(new THREE.Vector3()));
    const at = propWorldAt(store.scene, box.id, t)!;
    // (Its bottom's middle under the hands' middle, its width their gap less the palms.)
    const mid = l.clone().add(r).multiplyScalar(0.5);
    expect(Math.hypot(at.position[0] - mid.x, at.position[2] - mid.z)).toBeLessThan(0.08);
    expect(Math.abs(box.scale[0] - (l.distanceTo(r) - 0.06))).toBeLessThan(0.08);
  });
});
