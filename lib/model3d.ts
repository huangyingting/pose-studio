import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { frameTimes } from './animation';
import { sceneAt } from './evaluate';
import { SceneView } from './sceneview';
import { cameraAt, frameAspect, placeCamera } from './shot';
import type { Scene } from './types';

/*
 * The scene as a 3D model (binary glTF), for Blender, game engines and other 3D tools: each
 * figure as its joints with the solid parts on them (no outline shells or drawn lines), or as
 * the character it is drawn as, and each prop, in plain materials. An animated scene comes with
 * its animations: one per person (their joints turning, their hips moving), one for the props
 * (in hands, thrown, put down) and one for the shot camera (its cuts and moves).
 */
export async function sceneToGlb(scene: Scene, time = 0): Promise<Blob> {
  const sv = new SceneView();
  const skin = new THREE.MeshStandardMaterial({ name: 'Figure', color: '#e8e4dc', roughness: 0.8 });
  const surface = new THREE.MeshStandardMaterial({ name: 'Prop', color: '#c9c3b6', roughness: 0.7 });
  try {
    const a = scene.animation;
    sv.sync(a ? sceneAt(scene, time) : scene);
    sv.root.updateMatrixWorld(true);
    const out = new THREE.Scene();
    out.name = scene.name;
    const names = new Set<string>();
    const unique = (name: string) => {
      const base = THREE.PropertyBinding.sanitizeNodeName(name) || 'Node';
      let n = base;
      for (let i = 2; names.has(n); i++) n = `${base}_${i}`;
      names.add(n);
      return n;
    };
    // What moves, each with the node standing for it in the file.
    const turning: { node: THREE.Object3D; from: THREE.Object3D; clip: string; position?: boolean }[] = [];
    const placed: { node: THREE.Object3D; from: THREE.Object3D }[] = [];

    for (const f of scene.figures) {
      const m = sv.figures.get(f.id);
      if (!m) continue;
      const rig = sv.models.get(f.id);
      if (rig) {
        // Drawn as a character: its own skinned meshes and bones, named for the figure.
        rig.object.name = unique(f.name);
        rig.object.traverse((o) => { if (o !== rig.object && o.name) o.name = unique(`${f.name}_${o.name}`); });
        out.add(rig.object);
        turning.push({ node: rig.object, from: rig.object, clip: f.name, position: true });
        rig.object.traverse((o) => { if ((o as THREE.Bone).isBone) turning.push({ node: o, from: o, clip: f.name }); });
        continue;
      }
      // The mannequin: its joints (and finger segments), and the solid parts on them.
      const bodies = new Set<THREE.Object3D>(m.parts.bodies.filter(shown));
      const copy = (from: THREE.Object3D, name: string): THREE.Object3D => {
        const node = new THREE.Group();
        node.name = name;
        node.position.copy(from.position);
        node.quaternion.copy(from.quaternion);
        node.scale.copy(from.scale);
        for (const child of from.children) {
          if (bodies.has(child)) {
            const mesh = child as THREE.Mesh;
            const part = new THREE.Mesh(mesh.geometry, skin);
            part.position.copy(mesh.position);
            part.quaternion.copy(mesh.quaternion);
            part.scale.copy(mesh.scale);
            part.name = unique(`${f.name}_${(mesh.userData.joint as string | undefined) ?? 'part'}`);
            node.add(part);
          } else if (!(child as THREE.Mesh).isMesh && child.children.length) {
            node.add(copy(child, unique(`${f.name}_${child.name || 'joint'}`)));
          }
        }
        turning.push({ node, from, clip: f.name, position: from === m.joints.hips });
        return node;
      };
      out.add(copy(m.object, unique(f.name)));
    }
    for (const p of scene.props) {
      const o = sv.props.get(p.id);
      if (!o) continue;
      // At the root, placed where it is in the world (held props ride on a hand).
      const node = new THREE.Group();
      node.name = unique(p.name);
      for (const mesh of o.parts.bodies) {
        if (!shown(mesh)) continue;
        const part = new THREE.Mesh(mesh.geometry, surface);
        part.matrix.copy(o.object.matrixWorld.clone().invert().multiply(mesh.matrixWorld)).decompose(part.position, part.quaternion, part.scale);
        part.name = unique(`${p.name}_part`);
        node.add(part);
      }
      o.object.matrixWorld.decompose(node.position, node.quaternion, node.scale);
      if (node.children.length) {
        out.add(node);
        placed.push({ node, from: o.object });
      }
    }

    const animations: THREE.AnimationClip[] = [];
    if (a) {
      const aspect = frameAspect(scene);
      const camera = new THREE.PerspectiveCamera(30, aspect, 0.05, 200);
      camera.name = unique('Shot camera');
      out.add(camera);
      const times = frameTimes(a);
      const rot = new Map<THREE.Object3D, number[]>();
      const pos = new Map<THREE.Object3D, number[]>();
      const cam = { pos: [] as number[], rot: [] as number[] };
      for (const t of times) {
        const now = sceneAt(scene, t);
        sv.sync(now);
        sv.root.updateMatrixWorld(true);
        for (const x of turning) {
          const q = x.from === x.node && !(x.node as THREE.Bone).isBone ? null : x.from.quaternion;
          if (q) rot.set(x.node, [...(rot.get(x.node) ?? []), q.x, q.y, q.z, q.w]);
          if (x.position) pos.set(x.node, [...(pos.get(x.node) ?? []), ...x.from.position.toArray()]);
        }
        for (const x of placed) {
          const p = new THREE.Vector3();
          const q = new THREE.Quaternion();
          x.from.matrixWorld.decompose(p, q, new THREE.Vector3());
          pos.set(x.node, [...(pos.get(x.node) ?? []), ...p.toArray()]);
          rot.set(x.node, [...(rot.get(x.node) ?? []), q.x, q.y, q.z, q.w]);
        }
        placeCamera(camera, cameraAt(scene, t), aspect);
        cam.pos.push(...camera.position.toArray());
        cam.rot.push(camera.quaternion.x, camera.quaternion.y, camera.quaternion.z, camera.quaternion.w);
      }
      // (The lens a file keeps is the first frame's.)
      placeCamera(camera, cameraAt(scene, 0), aspect);
      const tracks = (nodes: THREE.Object3D[]) => nodes.flatMap((node) => [
        ...(rot.has(node) ? [new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, rot.get(node)!)] : []),
        ...(pos.has(node) ? [new THREE.VectorKeyframeTrack(`${node.name}.position`, times, pos.get(node)!)] : []),
      ]);
      for (const f of scene.figures) {
        const nodes = turning.filter((x) => x.clip === f.name).map((x) => x.node);
        if (nodes.length) animations.push(new THREE.AnimationClip(f.name, a.duration, tracks(nodes)));
      }
      if (placed.length) animations.push(new THREE.AnimationClip('Props', a.duration, tracks(placed.map((x) => x.node))));
      animations.push(new THREE.AnimationClip('Camera', a.duration, [
        new THREE.VectorKeyframeTrack(`${camera.name}.position`, times, cam.pos),
        new THREE.QuaternionKeyframeTrack(`${camera.name}.quaternion`, times, cam.rot),
      ]));
    }

    const glb = await new GLTFExporter().parseAsync(out, { binary: true, animations });
    return new Blob([glb as ArrayBuffer], { type: 'model/gltf-binary' });
  } finally {
    skin.dispose();
    surface.dispose();
    sv.dispose();
  }
}

function shown(o: THREE.Object3D | null) {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}
