import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { coverScene } from '@/lib/actions';
import { BODY_PRESETS } from '@/lib/body';
import { COVERAGES } from '@/lib/coverage';
import { sceneAt } from '@/lib/evaluate';
import { checkShots } from '@/lib/qa';
import { Rig } from '@/lib/relations';
import { cameraAt, liveCamera, placeCamera } from '@/lib/shot';
import { shotSpans } from '@/lib/shots';
import { Store } from '@/lib/store';
import { SCENE_TEMPLATES } from '@/lib/templates';
import { MemoryStorage } from '../fixtures/scenes';

/*
 * Acceptance (issue #3): any scene template filmed with any coverage that fits it, its people of
 * every build, is clean: no camera through anyone or anything, nobody hidden from a shot, and every
 * shot's camera has its subject in frame.
 */

const rig = new Rig();

/** Whether a figure's chest is in frame of the camera filming at t. */
function inFrame(store: Store, t: number, figure: string) {
  const f = sceneAt(store.scene, t).figures.find((x) => x.id === figure)!;
  const chest = rig.model(f).joints.chest.getWorldPosition(new THREE.Vector3());
  const cam = new THREE.PerspectiveCamera(30, 16 / 9);
  placeCamera(cam, cameraAt(store.scene, t), 16 / 9);
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
          for (const span of shotSpans(store.scene.animation!)) {
            const subject = liveCamera(store.scene, span.start)?.subject;
            for (const at of [span.start, (span.start + span.end) / 2]) if (subject) expect(inFrame(store, at, subject), `${what}: ${span.shot.name} at ${at.toFixed(2)}`).toBe(true);
          }
        }
      }
    }, 300_000);
  }
});
