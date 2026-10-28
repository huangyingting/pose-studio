import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { setSceneLight } from '@/lib/actions';
import { DEFAULT_LIGHT, clampLight, lampAt, lightDome, lightFrom, lightText } from '@/lib/lighting';
import type { SceneView } from '@/lib/sceneview';
import type { Store } from '@/lib/store';
import type { Scene, Vec3 } from '@/lib/types';
import { setPointerHint, setReadout } from './hints';
import { STEPS, snap, snapping } from './modifiers';

/*
 * The scene's key light on the canvas, in the lit styles: a lamp (drawn as simply as a camera)
 * where the light comes from, aimed at the scene. A click selects the light; selected, it rides a
 * dome over the scene with rays towards its middle, and a drag moves it over the dome (the
 * shadows follow).
 */

const LAMP = '#f5a524';
const ACCENT = '#3b6cff';
let drags = 0;

export default function LightHandles({ store, scene, sv, selected, lit }: { store: Store; scene: Scene; sv: SceneView; selected: boolean; lit: boolean }) {
  const get = useThree((s) => s.get);
  const glyph = useRef<THREE.Group>(null);
  const light = scene.light ?? DEFAULT_LIGHT;
  // (Worked out again as the scene changes.)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { base, radius } = useMemo(() => lightDome(sv.bounds()), [sv, scene]);
  const lamp = lampAt({ base, radius }, light);

  // A constant size on screen, however far, the lamp aimed at the middle of the scene.
  useFrame(({ camera }) => {
    const g = glyph.current;
    if (!g) return;
    g.scale.setScalar(camera.position.distanceTo(g.position) * 0.12);
    g.lookAt(base);
  });

  const down = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    store.select({ kind: 'light' });
    const { gl, camera, controls } = get() as unknown as { gl: THREE.WebGLRenderer; camera: THREE.Camera; controls: { enabled: boolean } | null };
    if (controls) controls.enabled = false;
    const sphere = new THREE.Sphere(base, radius);
    const ray = new THREE.Raycaster();
    const key = `lamp:${drags++}`;
    const move = (ev: PointerEvent) => {
      const r = gl.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
      // On the dome, or (past its edge) the nearest point of it.
      const hit = ray.ray.intersectSphere(sphere, new THREE.Vector3()) ?? ray.ray.closestPointToPoint(base, new THREE.Vector3());
      let next = lightFrom(store.scene.light ?? DEFAULT_LIGHT, hit.sub(base));
      // (Ctrl: 15° steps round, 5° up.)
      if (snapping(ev)) next = clampLight({ ...next, azimuth: snap(next.azimuth, STEPS.turn), elevation: snap(next.elevation, STEPS.height) });
      setSceneLight(store, next, key);
      setReadout(lightText(next));
    };
    // (Let go, or cancelled: a touch taken over by the system.)
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (controls) controls.enabled = true;
      setReadout(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // Rays: a few lines from the lamp towards the middle.
  const toward = base.clone().sub(lamp).normalize();
  const side = new THREE.Vector3().crossVectors(toward, new THREE.Vector3(0, 1, 0)).normalize();
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  const lift = new THREE.Vector3().crossVectors(side, toward).normalize();
  const rays = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => {
    const from = lamp.clone().addScaledVector(side, a * 0.08).addScaledVector(lift, b * 0.08).addScaledVector(toward, 0.15);
    return [from.toArray() as Vec3, from.clone().addScaledVector(toward, 0.35).toArray() as Vec3];
  });
  // The dome's rim on the floor and its arc through the lamp.
  const rim = Array.from({ length: 65 }, (_, i) => lampAt({ base, radius }, { azimuth: (i / 64) * 360, elevation: 0 }).toArray() as Vec3);
  const arc = Array.from({ length: 33 }, (_, i) => lampAt({ base, radius }, { azimuth: light.azimuth, elevation: (i / 32) * 90 }).toArray() as Vec3);

  return (
    <>
      <group
        ref={glyph}
        // (Found by the canvas's pick: a right-click on it opens the light's menu there.)
        name="light-lamp"
        position={lamp}
        onPointerDown={down}
        // (The click that follows the press is the lamp's: not a figure's behind it.)
        onClick={(e) => e.stopPropagation()}
        onPointerOver={() => { document.body.style.cursor = 'grab'; setPointerHint(lit ? `The light, ${lightText(light).toLowerCase()} · Drag: move it over the dome · Alt-click a figure: light it from your view` : 'Light shows in Pencil, Ink wash, Anime and Clay: switch to one in the top bar, or from the light\'s menu'); }}
        onPointerOut={() => { document.body.style.cursor = ''; setPointerHint(null); }}
        userData={{ light: true }}
      >
        {/* A lamp, drawn as simply as a camera: a bulb, and its shade opening towards the scene (its +Z). */}
        {/* (Handles: a press on the lamp is not a drag of the body behind it.) */}
        <mesh renderOrder={8} userData={{ handle: true, lamp: true }}>
          <sphereGeometry args={[0.045, 16, 12]} />
          <meshBasicMaterial color={selected ? ACCENT : LAMP} depthTest={false} transparent opacity={0.9} />
        </mesh>
        <mesh position={[0, 0, 0.06]} rotation-x={-Math.PI / 2} renderOrder={8} userData={{ handle: true, lamp: true }}>
          <coneGeometry args={[0.075, 0.1, 16, 1, true]} />
          <meshBasicMaterial color={selected ? ACCENT : LAMP} side={THREE.DoubleSide} depthTest={false} transparent opacity={0.6} />
        </mesh>
      </group>
      {selected && (
        <>
          <Line points={rim} color={LAMP} lineWidth={1} transparent opacity={0.3} dashed dashSize={0.12} gapSize={0.1} />
          <Line points={arc} color={LAMP} lineWidth={1} transparent opacity={0.35} dashed dashSize={0.08} gapSize={0.06} />
          {rays.map(([a, b], i) => <Line key={i} points={[a, b]} color={LAMP} lineWidth={1.5} transparent opacity={0.8} />)}
        </>
      )}
    </>
  );
}
