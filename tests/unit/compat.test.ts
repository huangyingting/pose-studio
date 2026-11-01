import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { samplePart } from '@/lib/clip';
import { newFigure, parseClip, parseScene } from '@/lib/doc';
import { Rig } from '@/lib/relations';
import { worldTurns } from '@/lib/skeleton';
import { BONES, type Bone, type JointName } from '@/lib/types';

/* What was saved and shipped before the core joints grew (#30) still means what it meant (tests/fixtures/compat/README.md). */

const read = (f: string) => JSON.parse(readFileSync(`tests/fixtures/compat/${f}`, 'utf8'));
/** Degrees between two turns (either sign). */
const apart = (a: number[], b: THREE.Quaternion) => {
  // (Well conditioned near zero, unlike acos of their dot.)
  const d = new THREE.Quaternion(a[0], a[1], a[2], a[3]).normalize().invert().multiply(b.clone().normalize());
  return (2 * Math.atan2(Math.hypot(d.x, d.y, d.z), Math.abs(d.w)) * 180) / Math.PI;
};

describe('compatibility (#30)', () => {
  it('a legacy 17-joint pose: every bone turned in the world as before, the mannequin\'s joints where they were', () => {
    const { bones, poses } = read('legacy-pose.json') as { bones: Record<string, number[]>; poses: { body: { sex: number; height: number }; world: Record<Bone, number[]>; joints: Record<JointName, number[]> }[] };
    const rig = new Rig();
    for (const p of poses) {
      const turns = worldTurns(bones as never);
      for (const b of BONES) expect(apart(p.world[b], turns.get(b)!), b).toBeLessThan(0.05);
      const m = rig.model({ ...newFigure(), body: p.body, bones: bones as never, position: [0.3, 0.98, -0.2], grounded: false });
      for (const [j, at] of Object.entries(p.joints)) expect(m.joints[j as JointName].getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(...at)), j).toBeLessThan(0.001);
    }
    rig.dispose();
  });

  it('library clips: every bone\'s world turn and the root as sampled before', () => {
    for (const { id, samples } of read('library-clips.json') as { id: string; samples: { t: number; root: number[]; world: Record<Bone, number[]> }[] }[]) {
      const c = parseClip(JSON.parse(readFileSync(`public/motions/${id}.json`, 'utf8')))!;
      for (const s of samples) {
        const p = samplePart(c.parts[0], s.t, c.duration, c.loop);
        expect(Math.hypot(...p.position.map((x, i) => x - s.root[i])), `${id} root at ${s.t}`).toBeLessThan(0.002);
        const turns = worldTurns(p.bones);
        for (const b of BONES) expect(apart(s.world[b], turns.get(b)!), `${id} ${b} at ${s.t}`).toBeLessThan(0.1);
      }
    }
  });

  it('a scene saved with a 17-joint figure parses to the same bones', () => {
    const { saved, parsedBones } = read('legacy-scene.json');
    expect(parseScene(saved)!.figures[0].bones).toEqual(parsedBones);
  });
});
