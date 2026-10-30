import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Line } from './Line';
import { editLight } from '@/lib/actions';
import { clampLight, handleAt, lampAt, lightDome, lightFrom, lightText, lightingOf } from '@/lib/lighting';
import type { SceneView } from '@/lib/sceneview';
import type { Store } from '@/lib/store';
import type { Light, Scene, Vec3 } from '@/lib/types';
import { setPointerHint, setReadout } from './hints';
import { STEPS, snap, snapping } from './modifiers';

/*
 * The scene's lights on the canvas, in the lit styles, drawn as simply as cameras are. The sun: a
 * lamp on a dome over the scene, aimed at its middle; selected, a drag moves it over the dome
 * (the shadows follow). A lamp or a window: where it is, a line down to the floor under it;
 * dragged, it moves over the floor at its height, as a prop does (its height in the inspector, or
 * Page Up / Down). A spot, and a window, aimed at what they light. A click selects the light.
 */

const LAMP = '#f5a524';
const ACCENT = '#3b6cff';
let drags = 0;

export default function LightHandles({ store, scene, sv, selected, lit }: { store: Store; scene: Scene; sv: SceneView; selected: string | null; lit: boolean }) {
  // (Worked out again as the scene changes.)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dome = useMemo(() => lightDome(sv.bounds(), sv.setBounds()), [sv, scene]);
  const lighting = lightingOf(scene);
  const middle = dome.base.clone().setY(1.2);
  return lighting.lights.map((l) => {
    // (What it shines at: its aim, the people's middle; a lamp all round, straight down.)
    const aim = (l.aim && sv.aimAt(l.aim)) ?? (l.kind === 'lamp' && !l.spot ? new THREE.Vector3(l.position[0], 0, l.position[2]) : middle);
    return <Lamp key={l.id} store={store} light={l} dome={dome} aim={aim} selected={selected === l.id} lit={lit} />;
  });
}

function Lamp({ store, light, dome: { base, radius }, aim, selected, lit }: {
  store: Store;
  light: Light;
  dome: { base: THREE.Vector3; radius: number };
  /** Where it shines. */
  aim: THREE.Vector3;
  selected: boolean;
  lit: boolean;
}) {
  const get = useThree((s) => s.get);
  const glyph = useRef<THREE.Group>(null);
  const sun = light.kind === 'sun';
  const at = handleAt({ base, radius }, light);
  const to = sun ? base : aim;

  // A constant size on screen, however far, aimed at what it lights.
  useFrame(({ camera }) => {
    const g = glyph.current;
    if (!g) return;
    g.scale.setScalar(camera.position.distanceTo(g.position) * 0.12);
    g.lookAt(to);
  });

  const down = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    store.select({ kind: 'light', light: light.id });
    const { gl, camera, controls } = get() as unknown as { gl: THREE.WebGLRenderer; camera: THREE.Camera; controls: { enabled: boolean } | null };
    if (controls) controls.enabled = false;
    const sphere = new THREE.Sphere(base, radius);
    // (A lamp moves over the floor at its height: on that level, from where it was pressed.)
    const level = new THREE.Plane(new THREE.Vector3(0, 1, 0), -light.position[1]);
    const ray = new THREE.Raycaster();
    const key = `lamp:${drags++}`;
    let offset: THREE.Vector3 | null = null;
    const move = (ev: PointerEvent) => {
      const r = gl.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
      let next: Light;
      if (sun) {
        // On the dome, or (past its edge) the nearest point of it.
        const hit = ray.ray.intersectSphere(sphere, new THREE.Vector3()) ?? ray.ray.closestPointToPoint(base, new THREE.Vector3());
        next = lightFrom(light, hit.sub(base));
        // (Ctrl: 15° steps round, 5° up.)
        if (snapping(ev)) next = clampLight({ ...next, azimuth: snap(next.azimuth, STEPS.turn), elevation: snap(next.elevation, STEPS.height) });
      } else {
        const hit = ray.ray.intersectPlane(level, new THREE.Vector3());
        if (!hit) return;
        offset ??= new THREE.Vector3(...light.position).sub(hit);
        hit.add(offset);
        // (Ctrl: the 25 cm grid.)
        const s = (v: number) => (snapping(ev) ? snap(v, 0.25) : Math.round(v * 100) / 100);
        next = clampLight({ ...light, position: [s(hit.x), light.position[1], s(hit.z)] });
      }
      editLight(store, light.id, next, key);
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

  // Rays: a few lines from it towards what it lights.
  const toward = to.clone().sub(at).normalize();
  const side = new THREE.Vector3().crossVectors(toward, new THREE.Vector3(0, 1, 0)).normalize();
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  const lift = new THREE.Vector3().crossVectors(side, toward).normalize();
  const rays = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => {
    const from = at.clone().addScaledVector(side, a * 0.08).addScaledVector(lift, b * 0.08).addScaledVector(toward, 0.15);
    return [from.toArray() as Vec3, from.clone().addScaledVector(toward, 0.35).toArray() as Vec3];
  });
  // The sun: the dome's rim on the floor and its arc through the lamp. A lamp: its drop to the floor.
  const rim = Array.from({ length: 65 }, (_, i) => lampAt({ base, radius }, { azimuth: (i / 64) * 360, elevation: 0 }).toArray() as Vec3);
  const arc = Array.from({ length: 33 }, (_, i) => lampAt({ base, radius }, { azimuth: light.azimuth, elevation: (i / 32) * 90 }).toArray() as Vec3);
  const drop: Vec3[] = [at.toArray() as Vec3, [at.x, 0, at.z]];
  const color = selected ? ACCENT : LAMP;
  const how = sun ? 'Drag: move it over the dome' : 'Drag: move it over the floor · Page Up / Down: higher, lower';

  return (
    <>
      <group
        ref={glyph}
        // (Found by the canvas's pick: a right-click on it opens the light's menu there.)
        name={`light-lamp:${light.id}`}
        position={at}
        onPointerDown={down}
        // (The click that follows the press is the lamp's: not a figure's behind it.)
        onClick={(e) => e.stopPropagation()}
        onPointerOver={() => { document.body.style.cursor = 'grab'; setPointerHint(lit ? `${light.name}, ${lightText(light).toLowerCase()} · ${how} · Alt-click a figure: light it from your view` : 'Light shows in Pencil, Ink wash, Anime, 3D and Clay: switch to one in the top bar, or from the light\'s menu'); }}
        onPointerOut={() => { document.body.style.cursor = ''; setPointerHint(null); }}
        userData={{ light: light.id }}
      >
        {/* (Handles: a press on the lamp is not a drag of the body behind it.) */}
        {light.kind === 'window' ? (
          // A window: a pane, facing what it lights (its +Z).
          <mesh renderOrder={8} userData={{ handle: true, lamp: true }}>
            <planeGeometry args={[0.24, 0.28]} />
            <meshBasicMaterial color={color} side={THREE.DoubleSide} depthTest={false} transparent opacity={0.55} />
          </mesh>
        ) : (
          // The sun and a lamp: a bulb; the sun and a spot with a shade opening towards what they light.
          <>
            <mesh renderOrder={8} userData={{ handle: true, lamp: true }}>
              <sphereGeometry args={[0.045, 16, 12]} />
              <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.9} />
            </mesh>
            {(sun || light.spot) && (
              <mesh position={[0, 0, 0.06]} rotation-x={-Math.PI / 2} renderOrder={8} userData={{ handle: true, lamp: true }}>
                <coneGeometry args={[0.075, 0.1, 16, 1, true]} />
                <meshBasicMaterial color={color} side={THREE.DoubleSide} depthTest={false} transparent opacity={0.6} />
              </mesh>
            )}
          </>
        )}
      </group>
      {!sun && <Line points={drop} color={LAMP} lineWidth={1} transparent opacity={selected ? 0.6 : 0.3} dashed dashSize={0.06} gapSize={0.05} />}
      {selected && (
        <>
          {sun && <Line points={rim} color={LAMP} lineWidth={1} transparent opacity={0.3} dashed dashSize={0.12} gapSize={0.1} />}
          {sun && <Line points={arc} color={LAMP} lineWidth={1} transparent opacity={0.35} dashed dashSize={0.08} gapSize={0.06} />}
          {(sun || light.spot || light.kind === 'window') && rays.map(([a, b], i) => <Line key={i} points={[a, b]} color={LAMP} lineWidth={1.5} transparent opacity={0.8} />)}
        </>
      )}
    </>
  );
}
