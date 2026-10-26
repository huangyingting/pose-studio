import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { addFigure, addProp, setFigureColor, setGaze } from '@/lib/actions';
import { duplicateScene } from '@/lib/doc';
import { SceneView } from '@/lib/sceneview';
import { Store } from '@/lib/store';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

/** How well a figure's head faces a point (1: straight at it). */
function facingScore(sv: SceneView, id: string, target: THREE.Vector3) {
  const head = sv.figures.get(id)!.joints.head;
  const eyes = head.getWorldPosition(new THREE.Vector3());
  const ahead = new THREE.Vector3(0, 0, 1).applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()));
  return ahead.dot(target.clone().sub(eyes).normalize());
}

describe('eyes on someone or something; colours', () => {
  it('turns the head to another figure, and follows a prop', () => {
    const store = new Store(new MemoryStorage());
    const a = store.figure!.id;
    addFigure(store, [1.5, 0, 1.5]);
    const b = store.getState().activeFigure!;
    const sv = new SceneView();
    sv.sync(store.scene);
    const bHead = () => sv.figures.get(b)!.joints.head.getWorldPosition(new THREE.Vector3());
    const before = facingScore(sv, a, bHead());
    setGaze(store, a, { figure: b });
    sv.sync(store.scene);
    expect(facingScore(sv, a, bHead())).toBeGreaterThan(Math.max(before, 0.95));

    addProp(store, 'sphere', [-1, 0, 1]);
    const ball = store.scene.props[0].id;
    setGaze(store, a, { prop: ball });
    sv.sync(store.scene);
    const ballAt = () => new THREE.Box3().setFromObject(sv.props.get(ball)!.object).getCenter(new THREE.Vector3());
    expect(facingScore(sv, a, ballAt())).toBeGreaterThan(0.9);
    sv.dispose();
  });

  it('tints a figure, and a copied scene keeps eyes and colours on the copies', () => {
    const store = new Store(new MemoryStorage());
    const a = store.figure!.id;
    addFigure(store);
    const b = store.getState().activeFigure!;
    setFigureColor(store, a, '#e5484d');
    setGaze(store, a, { figure: b });
    const sv = new SceneView();
    sv.sync(store.scene);
    const tinted = (sv.figures.get(a)!.parts.bodies[0].material as THREE.MeshBasicMaterial).color.getHexString();
    const plain = (sv.figures.get(b)!.parts.bodies[0].material as THREE.MeshBasicMaterial).color.getHexString();
    expect(tinted).not.toBe(plain);
    sv.dispose();
    const copy = duplicateScene(store.scene);
    expect(copy.figures[0].color).toBe('#e5484d');
    expect(copy.figures[0].gaze).toEqual({ figure: copy.figures[1].id });
  });
});
