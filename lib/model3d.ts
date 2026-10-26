import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { SceneView } from './sceneview';
import type { Scene } from './types';

/*
 * The posed scene as a 3D model (binary glTF), for Blender and other 3D tools: the solid parts
 * of each figure and prop as they stand (no outline shells or drawn lines), one node per figure
 * and prop, in plain materials.
 */
export async function sceneToGlb(scene: Scene): Promise<Blob> {
  const sv = new SceneView();
  try {
    sv.sync(scene);
    sv.root.updateMatrixWorld(true);
    const out = new THREE.Scene();
    out.name = scene.name;
    const skin = new THREE.MeshStandardMaterial({ name: 'Figure', color: '#e8e4dc', roughness: 0.8 });
    const surface = new THREE.MeshStandardMaterial({ name: 'Prop', color: '#c9c3b6', roughness: 0.7 });

    const copy = (meshes: THREE.Mesh[], name: string, material: THREE.Material) => {
      const node = new THREE.Group();
      node.name = name;
      for (const mesh of meshes) {
        if (!shown(mesh)) continue;
        const part = new THREE.Mesh(mesh.geometry, material);
        mesh.matrixWorld.decompose(part.position, part.quaternion, part.scale);
        part.name = (mesh.userData.joint as string | undefined) ?? name;
        node.add(part);
      }
      if (node.children.length) out.add(node);
    };
    for (const f of scene.figures) {
      const m = sv.figures.get(f.id);
      if (m) copy(m.parts.bodies, f.name, skin);
    }
    for (const p of scene.props) {
      const o = sv.props.get(p.id);
      if (o) copy(o.parts.bodies, p.name, surface);
    }

    const glb = await new GLTFExporter().parseAsync(out, { binary: true });
    skin.dispose();
    surface.dispose();
    return new Blob([glb as ArrayBuffer], { type: 'model/gltf-binary' });
  } finally {
    sv.dispose();
  }
}

function shown(o: THREE.Object3D | null) {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}
