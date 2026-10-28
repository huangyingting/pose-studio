import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { setSceneLight } from '@/lib/actions';
import { DEFAULT_LIGHT, lightFrom, lightText } from '@/lib/lighting';
import type { SceneView } from '@/lib/sceneview';
import type { Store } from '@/lib/store';
import type { Scene, Vec3 } from '@/lib/types';
import { openContextMenu } from './ContextMenu';
import { menu } from './commands';
import { setPointerHint, setReadout } from './hints';

/*
 * The scene's key light on the canvas, in the lit styles: a sun where the light comes from. A click
 * selects the light; selected, it rides a dome over the scene with rays towards its middle, and a
 * drag moves it over the dome (the shadows follow).
 */

const SUN = '#f5a524';
let drags = 0;

/** Where the light comes from at a distance r from `base` (azimuth 0: the front, +Z; up to the zenith). */
const sunAt = (base: THREE.Vector3, r: number, azimuth: number, elevation: number) => {
  const [az, el] = [(azimuth * Math.PI) / 180, (elevation * Math.PI) / 180];
  return base.clone().add(new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(r));
};

export default function LightHandles({ store, scene, sv, selected, lit }: { store: Store; scene: Scene; sv: SceneView; selected: boolean; lit: boolean }) {
  const get = useThree((s) => s.get);
  const glyph = useRef<THREE.Group>(null);
  const light = scene.light ?? DEFAULT_LIGHT;
  // The dome: on the floor under the middle of the scene, a little wider than it.
  const { base, radius } = useMemo(() => {
    const box = sv.bounds();
    const c = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const size = box.isEmpty() ? 2 : box.getSize(new THREE.Vector3()).length();
    return { base: new THREE.Vector3(c.x, 0, c.z), radius: Math.max(2.5, size * 0.9) };
    // (Worked out again as the scene changes.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sv, scene]);
  const sun = sunAt(base, radius, light.azimuth, light.elevation);

  // A constant size on screen, however far.
  useFrame(({ camera }) => {
    const g = glyph.current;
    if (g) g.scale.setScalar(camera.position.distanceTo(g.position) * 0.022);
  });

  const down = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    store.select({ kind: 'light' });
    const { gl, camera, controls } = get() as unknown as { gl: THREE.WebGLRenderer; camera: THREE.Camera; controls: { enabled: boolean } | null };
    if (controls) controls.enabled = false;
    const sphere = new THREE.Sphere(base, radius);
    const ray = new THREE.Raycaster();
    const key = `sun:${drags++}`;
    const move = (ev: PointerEvent) => {
      const r = gl.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
      // On the dome, or (past its edge) the nearest point of it.
      const hit = ray.ray.intersectSphere(sphere, new THREE.Vector3()) ?? ray.ray.closestPointToPoint(base, new THREE.Vector3());
      const next = lightFrom(store.scene.light ?? DEFAULT_LIGHT, hit.sub(base));
      setSceneLight(store, next, key);
      setReadout(lightText(next));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (controls) controls.enabled = true;
      setReadout(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Rays: a few lines from the sun towards the middle.
  const toward = base.clone().sub(sun).normalize();
  const side = new THREE.Vector3().crossVectors(toward, new THREE.Vector3(0, 1, 0)).normalize();
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  const lift = new THREE.Vector3().crossVectors(side, toward).normalize();
  const rays = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => {
    const from = sun.clone().addScaledVector(side, a * 0.25).addScaledVector(lift, b * 0.25).addScaledVector(toward, 0.3);
    return [from.toArray() as Vec3, from.clone().addScaledVector(toward, radius * 0.45).toArray() as Vec3];
  });
  // The dome's rim on the floor and its arc through the sun.
  const rim = Array.from({ length: 65 }, (_, i) => sunAt(base, radius, (i / 64) * 360, 0).toArray() as Vec3);
  const arc = Array.from({ length: 33 }, (_, i) => sunAt(base, radius, light.azimuth, (i / 32) * 90).toArray() as Vec3);

  return (
    <>
      <group
        ref={glyph}
        position={sun}
        onPointerDown={down}
        onContextMenu={(e) => { e.stopPropagation(); store.select({ kind: 'light' }); openContextMenu(e.nativeEvent, menu('light', { store, light: true }), 'Light'); }}
        onPointerOver={() => { document.body.style.cursor = 'grab'; setPointerHint(lit ? `The light, ${lightText(light).toLowerCase()} · Drag: move it over the dome · Alt-click a figure: light it from your view` : 'Light shows in Pencil, Ink wash, Anime and Clay: switch to one in the top bar, or from the light\'s menu'); }}
        onPointerOut={() => { document.body.style.cursor = ''; setPointerHint(null); }}
        userData={{ light: true }}
      >
        <mesh renderOrder={8}>
          <sphereGeometry args={[1, 20, 14]} />
          <meshBasicMaterial color={SUN} depthTest={false} transparent opacity={selected ? 1 : 0.85} />
        </mesh>
        {/* Its corona: a wire shell round it. */}
        <mesh renderOrder={8}>
          <icosahedronGeometry args={[1.7, 0]} />
          <meshBasicMaterial color={SUN} wireframe depthTest={false} transparent opacity={0.6} />
        </mesh>
      </group>
      {selected && (
        <>
          <Line points={rim} color={SUN} lineWidth={1} transparent opacity={0.35} dashed dashSize={0.2} gapSize={0.15} />
          <Line points={arc} color={SUN} lineWidth={1} transparent opacity={0.5} />
          {rays.map(([a, b], i) => <Line key={i} points={[a, b]} color={SUN} lineWidth={1.5} transparent opacity={0.7} />)}
        </>
      )}
    </>
  );
}
