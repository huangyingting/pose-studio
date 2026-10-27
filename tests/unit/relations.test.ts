import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { newFigure } from '@/lib/doc';
import { worldPos } from '@/lib/mannequin';
import {
  Rig, atDistance, backToBack, besides, contactPoint, distance, faceEachOther, facing, forward, headPoint, inFrontOf, lookAt, reach,
  turnTowards, withFacing,
} from '@/lib/relations';
import { angle, anglesOf } from '@/lib/pose';

const at = (x: number, z: number, yaw = 0) => withFacing(newFigure({ position: [x, 0, z] }), yaw);

describe('placement', () => {
  it('turns a figure to face another', () => {
    const a = turnTowards(at(0, 0), at(1, 0));
    expect(facing(a)).toBeCloseTo(90);
    const [fx, fz] = forward(a);
    expect(fx).toBeCloseTo(1);
    expect(fz).toBeCloseTo(0);
    const [p, q] = faceEachOther(at(0, 0), at(0, 2));
    expect(facing(p)).toBeCloseTo(0);
    expect(Math.abs(facing(q))).toBeCloseTo(180);
  });

  it('sets the distance along the line between figures', () => {
    const a = atDistance(at(3, 4), at(0, 0), 1);
    expect(a.position[0]).toBeCloseTo(0.6);
    expect(a.position[2]).toBeCloseTo(0.8);
    expect(distance(a, at(0, 0))).toBeCloseTo(1);
  });

  it('places figures side by side, back to back and in front', () => {
    const b = at(0, 0, 0);
    const left = besides(at(5, 5), b, 'L', 0.6);
    expect(left.position[0]).toBeCloseTo(0.6); // a figure's left is +X when it faces +Z
    expect(facing(left)).toBeCloseTo(0);
    const right = besides(at(5, 5), b, 'R', 0.6);
    expect(right.position[0]).toBeCloseTo(-0.6);
    const back = backToBack(at(5, 5), b, 0.3);
    expect(back.position[2]).toBeCloseTo(-0.3);
    expect(Math.abs(facing(back))).toBeCloseTo(180);
    const front = inFrontOf(at(5, 5), b, 1.2);
    expect(front.position[2]).toBeCloseTo(1.2);
    expect(Math.abs(facing(front))).toBeCloseTo(180);
  });
});

describe('posing against another figure', () => {
  it('reaches a hand to the other figure’s shoulder', () => {
    const rig = new Rig();
    const a = at(-0.3, 0);
    const b = at(0.3, 0);
    const target = contactPoint(rig.model(b), b, 'rightUpperArm');
    const res = reach(rig, a, 'L', target);
    expect(res.reached).toBe(true);
    const m = rig.model({ ...a, bones: res.bones });
    const palm = m.joints.leftHand.localToWorld(new THREE.Vector3(0, -0.06 * (a.body.height / 1.8), 0));
    expect(palm.distanceTo(target)).toBeLessThan(0.05);
    rig.dispose();
  });

  it('reports targets out of reach', () => {
    const rig = new Rig();
    const a = at(0, 0);
    expect(reach(rig, a, 'R', new THREE.Vector3(3, 1, 0)).reached).toBe(false);
    rig.dispose();
  });

  it('looks at a point without tilting the head', () => {
    const rig = new Rig();
    const a = at(0, 0);
    for (const target of [new THREE.Vector3(2, 1.5, 2), new THREE.Vector3(-1.5, 0.8, 1), new THREE.Vector3(0.3, 2.2, 2)]) {
      const bones = lookAt(rig, a, target);
      const m = rig.model({ ...a, bones });
      const head = m.joints.head;
      const eye = headPoint(m, a);
      const face = new THREE.Vector3(0, 0, 1).applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()));
      const want = target.clone().sub(eye).normalize();
      expect(THREE.MathUtils.radToDeg(face.angleTo(want))).toBeLessThan(8);
      // No sideways roll: the head's left axis stays level.
      const left = new THREE.Vector3(1, 0, 0).applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()));
      expect(Math.abs(left.y)).toBeLessThan(0.1);
    }
    rig.dispose();
  });

  it('twists the chest when the target is behind', () => {
    const rig = new Rig();
    const a = at(0, 0);
    const bones = lookAt(rig, a, new THREE.Vector3(1, 1.5, -1));
    expect(Math.abs(angle(bones, 'chest')[1])).toBeGreaterThan(10);
    expect(worldPos(rig.model({ ...a, bones }).joints.head).y).toBeGreaterThan(1.3);
    rig.dispose();
  });
});

describe('multi-person templates', () => {
  it('builds every template with fresh ids, valid data and joints within limits', async () => {
    const { TEMPLATES } = await import('@/lib/templates');
    const { parseScene } = await import('@/lib/doc');
    const { jointLimits } = await import('@/lib/joints');
    for (const t of TEMPLATES) {
      const s = t.build();
      expect(s.figures).toHaveLength(t.people);
      expect(parseScene(JSON.parse(JSON.stringify(s)))).toEqual(s);
      for (const f of s.figures) {
        for (const [j, r] of Object.entries(anglesOf(f.bones))) {
          if (j === 'hips') continue;
          const lim = jointLimits(j as never);
          r!.forEach((v, i) => {
            expect(v, `${t.id} ${f.name} ${j}[${i}]`).toBeGreaterThanOrEqual(lim[i][0] - 0.5);
            expect(v, `${t.id} ${f.name} ${j}[${i}]`).toBeLessThanOrEqual(lim[i][1] + 0.5);
          });
        }
      }
      expect(t.build().figures[0].id).not.toBe(s.figures[0].id);
    }
  });

  it('really joins the hands in a handshake', async () => {
    const { buildTemplate } = await import('@/lib/templates');
    const s = buildTemplate('handshake')!;
    const rig = new Rig();
    const [a, b] = s.figures;
    const pa = contactPoint(rig.model(a), a, 'rightHand');
    const pb = contactPoint(rig.model(b), b, 'rightHand');
    expect(pa.distanceTo(pb)).toBeLessThan(0.1);
    rig.dispose();
  });

  it('puts a hand on the partner’s shoulder', async () => {
    const { buildTemplate } = await import('@/lib/templates');
    const s = buildTemplate('shoulder')!;
    const rig = new Rig();
    const [a, b] = s.figures;
    const palm = contactPoint(rig.model(a), a, 'leftHand');
    expect(palm.distanceTo(contactPoint(rig.model(b), b, 'rightUpperArm'))).toBeLessThan(0.06);
    rig.dispose();
  });
});
