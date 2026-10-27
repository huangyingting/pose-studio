import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { coverScene } from '@/lib/actions';
import { BODY_PRESETS } from '@/lib/body';
import { COVERAGES } from '@/lib/coverage';
import { sceneAt } from '@/lib/evaluate';
import { checkShots } from '@/lib/qa';
import { Rig } from '@/lib/relations';
import { cameraAt, liveCamera, placeCamera, viewOf } from '@/lib/cameras';
import { shotSpans } from '@/lib/shots';
import { Store } from '@/lib/store';
import { SCENE_TEMPLATES } from '@/lib/templates';
import type { Camera, RigCamera } from '@/lib/types';
import { MemoryStorage } from '../fixtures/scenes';

/*
 * Acceptance (issue #3): any scene template filmed with any coverage that fits it, its people of
 * every build, is clean: no camera through anyone or anything, nobody hidden from a shot, every
 * shot's camera has its subject in frame, and a single has nobody else in it.
 */

const rig = new Rig();

/** Whether a figure's chest (or head) is in frame of the camera filming at t (or of a given camera). */
function inFrame(store: Store, t: number, figure: string, camera?: Camera, joint: 'chest' | 'head' = 'chest') {
  const f = sceneAt(store.scene, t).figures.find((x) => x.id === figure)!;
  const chest = rig.model(f).joints[joint].getWorldPosition(new THREE.Vector3());
  const cam = new THREE.PerspectiveCamera(30, 16 / 9);
  placeCamera(cam, camera ? viewOf(store.scene, camera, t) : cameraAt(store.scene, t), 16 / 9);
  const p = chest.project(cam);
  return Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && p.z < 1;
}

describe('every scene template × coverage × body is clean', () => {
  for (const [k, preset] of BODY_PRESETS.entries()) {
    it(`with builds from ${preset.name} on`, () => {
      for (const t of SCENE_TEMPLATES) {
        for (const c of COVERAGES.filter((x) => x.roles.length <= t.people)) {
          const store = new Store(new MemoryStorage());
          const built = t.build();
          // Each person of another build, round the presets.
          const scene = { ...built, figures: built.figures.map((f, i) => ({ ...f, body: { ...BODY_PRESETS[(k + i) % BODY_PRESETS.length].body } })) };
          store.updateScene(() => scene);
          store.select({ kind: 'figure', figure: scene.figures[0].id });
          const cast = coverScene(store, c.id)!;
          const what = `${t.id} × ${c.id} × ${preset.name}`;
          expect(cast, what).toBeTruthy();
          expect(checkShots(store.scene).map((i) => i.message), what).toEqual([]);
          // Every single, cut to or not, has its subject in it, and is clean (the other person out of
          // it) unless the two touch (a handshake, hand in hand: no single leaves the other out).
          const a = store.scene.animation!;
          const apart = (t: number, p: string, q: string) => {
            const now = sceneAt(store.scene, t).figures;
            const [x, y] = [now.find((f) => f.id === p)!, now.find((f) => f.id === q)!];
            return Math.hypot(x.position[0] - y.position[0], x.position[2] - y.position[2]);
          };
          for (const cam of store.scene.cameras.filter((x): x is RigCamera => x.kind === 'rig' && !!x.rig.clear)) {
            for (const at of [0, a.duration / 2, a.duration]) {
              // (A close-up holds the head; the chest may be at the frame's edge.)
              expect(inFrame(store, at, cam.subject!, cam, 'head'), `${what}: ${cam.name} at ${at}`).toBe(true);
              if (apart(at, cam.subject!, cam.rig.clear!) > 1) expect(inFrame(store, at, cam.rig.clear!, cam), `${what}: ${cam.name} clean at ${at}`).toBe(false);
            }
          }
          for (const span of shotSpans(store.scene.animation!)) {
            const cam = liveCamera(store.scene, span.start);
            for (const at of [span.start, (span.start + span.end) / 2]) if (cam?.subject) expect(inFrame(store, at, cam.subject), `${what}: ${span.shot.name} at ${at.toFixed(2)}`).toBe(true);
          }
        }
      }
    }, 900_000);
  }
});
