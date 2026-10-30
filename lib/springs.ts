import * as THREE from 'three';

/*
 * Spring bones (#15): a character's hair, skirt and the like swinging as it moves, as a VRM avatar's
 * spring bones say (VRMC_springBone; 0.x secondaryAnimation: lib/vrm.ts reads them into a Spec by
 * bone names, kept with the model). Each chain of bones trails its tip after where it was, drawn
 * back towards its rest by its stiffness, pulled by its gravity, slowed by its drag, and pushed out
 * of the body's colliders (spheres and capsules on the head, the chest, the arms). Worked out frame
 * by frame as the scene plays (an export, played from its start, the same each time); a jump in
 * time (scrubbing, a still) lets it settle where it hangs at that pose.
 */

export interface SpringJoint {
  /** The bone, by name; its tip is its child's place (or, the last, a little along it). */
  bone: string;
  stiffness: number;
  gravityPower: number;
  gravityDir: [number, number, number];
  dragForce: number;
  hitRadius: number;
}

export type SpringCollider = { bone: string; offset: [number, number, number]; radius: number; tail?: [number, number, number] };

export interface SpringSpec {
  /** Chains of joints, root first, and the colliders each chain is kept out of (by index). */
  springs: { joints: SpringJoint[]; colliders: number[] }[];
  colliders: SpringCollider[];
}

interface Joint {
  bone: THREE.Object3D;
  child: THREE.Object3D | null;
  spec: SpringJoint;
  /** The bone's own rotation at rest, the way it points (in its own frame) and how long it is. */
  rest: THREE.Quaternion;
  axis: THREE.Vector3;
  length: number;
  tail: THREE.Vector3;
  prev: THREE.Vector3;
  colliders: { bone: THREE.Object3D; offset: THREE.Vector3; radius: number; tail?: THREE.Vector3 }[];
}

const STEP = 1 / 60;

export class Springs {
  private joints: Joint[] = [];
  private last: number | null = null;

  constructor(root: THREE.Object3D, spec: SpringSpec) {
    const byName = new Map<string, THREE.Object3D>();
    root.traverse((o) => { if (o.name && !byName.has(o.name)) byName.set(o.name, o); });
    const colliders = spec.colliders.map((c) => {
      const bone = byName.get(c.bone);
      return bone ? { bone, offset: new THREE.Vector3(...c.offset), radius: c.radius, ...(c.tail ? { tail: new THREE.Vector3(...c.tail) } : {}) } : null;
    });
    for (const chain of spec.springs) {
      const cols = chain.colliders.flatMap((i) => (colliders[i] ? [colliders[i]!] : []));
      chain.joints.forEach((j, k) => {
        const bone = byName.get(j.bone);
        if (!bone) return;
        const next = chain.joints[k + 1] && byName.get(chain.joints[k + 1].bone);
        const child = next ?? bone.children.find((c) => (c as THREE.Bone).isBone) ?? null;
        // (The last of a chain, with no child: a short way on, along its own direction.)
        const axis = child ? child.position.clone() : new THREE.Vector3(0, -0.07, 0);
        const length = axis.length();
        if (length < 1e-5) return;
        this.joints.push({ bone, child, spec: j, rest: bone.quaternion.clone(), axis: axis.normalize(), length, tail: new THREE.Vector3(), prev: new THREE.Vector3(), colliders: cols });
      });
    }
  }

  get empty() {
    return this.joints.length === 0;
  }

  /**
   * Move them on to time t (the bones above them posed and their world matrices up to date): a
   * step on from where they were, frame by frame; a jump back or of more than a quarter second (or
   * no time: a still), settled where they hang now.
   */
  update(t: number | undefined) {
    if (!this.joints.length) return;
    const jump = t === undefined || this.last === null || t < this.last - 1e-6 || t - this.last > 0.25;
    if (jump) {
      this.reset();
      for (let i = 0; i < 40; i++) this.step(STEP);
    } else {
      const span = t! - this.last!;
      const n = Math.min(15, Math.ceil(span / STEP - 1e-6));
      for (let i = 0; i < n; i++) this.step(span / n);
    }
    this.last = t ?? null;
  }

  /** Each tip where the bone at rest would put it. */
  private reset() {
    const head = new THREE.Vector3();
    for (const j of this.joints) {
      j.bone.quaternion.copy(j.rest);
      j.bone.updateWorldMatrix(true, false);
      j.bone.getWorldPosition(head);
      const dir = j.axis.clone().applyQuaternion(j.bone.getWorldQuaternion(new THREE.Quaternion()));
      j.tail.copy(head).addScaledVector(dir, j.length * j.bone.getWorldScale(new THREE.Vector3()).x);
      j.prev.copy(j.tail);
    }
  }

  private step(dt: number) {
    const head = new THREE.Vector3();
    const parentQ = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (const j of this.joints) {
      const parent = j.bone.parent!;
      parent.updateWorldMatrix(true, false);
      parent.getWorldQuaternion(parentQ);
      j.bone.quaternion.copy(j.rest);
      j.bone.updateWorldMatrix(false, false);
      j.bone.getWorldPosition(head);
      const s = j.bone.getWorldScale(scale).x;
      const length = j.length * s;
      // Towards where it rests (its stiffness), on as it was going (less its drag), down (its gravity).
      const restDir = j.axis.clone().applyQuaternion(parentQ.clone().multiply(j.rest));
      const next = j.tail.clone()
        .addScaledVector(j.tail.clone().sub(j.prev), 1 - j.spec.dragForce)
        .addScaledVector(restDir, j.spec.stiffness * dt)
        .addScaledVector(new THREE.Vector3(...j.spec.gravityDir), j.spec.gravityPower * dt);
      // As long as the bone is.
      next.sub(head).setLength(length).add(head);
      // Out of the colliders.
      for (const col of j.colliders) {
        const at = col.offset.clone().applyMatrix4(col.bone.matrixWorld);
        let nearest = at;
        if (col.tail) {
          const end = col.tail.clone().applyMatrix4(col.bone.matrixWorld);
          nearest = new THREE.Line3(at, end).closestPointToPoint(next, true, c);
        }
        const r = col.radius * col.bone.getWorldScale(scale).x + j.spec.hitRadius * s;
        const d = next.distanceTo(nearest);
        if (d < r && d > 1e-6) {
          next.sub(nearest).setLength(r).add(nearest);
          next.sub(head).setLength(length).add(head);
        }
      }
      j.prev.copy(j.tail);
      j.tail.copy(next);
      // The bone turned from its rest to point at its tip.
      const want = next.clone().sub(head).applyQuaternion(parentQ.clone().multiply(j.rest).invert()).normalize();
      j.bone.quaternion.copy(j.rest).multiply(new THREE.Quaternion().setFromUnitVectors(j.axis, want));
      j.bone.updateWorldMatrix(false, true);
    }
  }
}
