import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Line } from './Line';
import { editLight, setLook, subjectOf } from '@/lib/actions';
import { cameraAt } from '@/lib/cameras';
import { ROLE_NAMES, clampLight, handleAt, keyLight, lampAt, lightDome, lightFrom, lightText, lightingOf, lookOf, sunText } from '@/lib/lighting';
import type { SceneView } from '@/lib/sceneview';
import type { Store } from '@/lib/store';
import type { Light, Scene, Vec3 } from '@/lib/types';
import { setPointerHint, setReadout } from './hints';
import { STEPS, snap, snapping } from './modifiers';
import { GLYPH } from './glyphs';

/*
 * The scene's lights on the canvas, in the lit styles, drawn as simply as cameras are. The sun: a
 * lamp on a dome over the scene, aimed at its middle; selected, a drag moves it over the dome
 * (the shadows follow). A lamp or a window: where it is, a line down to the floor under it;
 * dragged, it moves over the floor at its height, as a prop does (its height in the inspector, or
 * Page Up / Down; selected, also the move gizmo). A spot, and a window, aimed at what they light:
 * selected, a handle there, dragged over the floor at its height to aim it. A click selects the
 * light; the wheel over it makes it brighter or dimmer.
 */

const LAMP = '#f5a524';
/** The lighting circle's fill and rim (as the inspector's direction dial draws them). */
const FILL = '#e9c27a';
const RIM = '#7fa2f5';
const ACCENT = '#3b6cff';
let drags = 0;
let wheelAt = 0;
type Controls = { enabled: boolean; enableZoom: boolean } | null;

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
    g.scale.setScalar(camera.position.distanceTo(g.position) * GLYPH);
    g.lookAt(to);
    const a = aimGlyph.current;
    if (a) a.scale.setScalar(camera.position.distanceTo(a.position) * GLYPH * 0.35);
  });
  const aimGlyph = useRef<THREE.Mesh>(null);

  /** Follow the pointer over a level plane at `height` (the orbit off meanwhile), till it is let go. */
  const follow = (height: number, move: (hit: THREE.Vector3, ev: PointerEvent) => void) => {
    const { gl, camera, controls } = get() as unknown as { gl: THREE.WebGLRenderer; camera: THREE.Camera; controls: Controls };
    if (controls) controls.enabled = false;
    const level = new THREE.Plane(new THREE.Vector3(0, 1, 0), -height);
    const ray = new THREE.Raycaster();
    const onMove = (ev: PointerEvent) => {
      const r = gl.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = ray.ray.intersectPlane(level, new THREE.Vector3());
      if (hit) move(hit, ev);
    };
    const up = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (controls) controls.enabled = true;
      setReadout(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  /** Its aim's handle dragged: it points at a place, over the floor at the aim's height. */
  const aimDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const key = `aim:${drags++}`;
    follow(to.y, (hit, ev) => {
      const s = (v: number) => (snapping(ev) ? snap(v, 0.25) : Math.round(v * 100) / 100);
      editLight(store, light.id, { aim: { point: [s(hit.x), Math.round(to.y * 100) / 100, s(hit.z)] } }, key);
      setReadout(`${light.name} aimed at ${s(hit.x).toFixed(2)}, ${s(hit.z).toFixed(2)}`);
    });
  };

  /** The wheel over it: brighter or dimmer, a step at a time (a trackpad's swipe one step). */
  const wheel = (e: ThreeEvent<WheelEvent>) => {
    e.stopPropagation();
    const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    const now = performance.now();
    const quiet = now - wheelAt > 180;
    wheelAt = now;
    if (!d || !quiet) return;
    const intensity = Math.min(3, Math.max(0, Math.round((light.intensity + (d < 0 ? 0.1 : -0.1)) * 10) / 10));
    editLight(store, light.id, { intensity }, `wheel:${light.id}`);
    setPointerHint(`${light.name}: brightness ${Math.round(intensity * 100)} % · Wheel: brighter, dimmer`);
  };
  // (Off while the pointer is on it; back on as it leaves, or as it goes from under the pointer: deleted, the style changed.)
  const zoomOff = useRef(false);
  const zoom = (on: boolean) => { zoomOff.current = !on; const c = get().controls as unknown as Controls; if (c) c.enableZoom = on; };
  useEffect(() => () => { if (zoomOff.current) { const c = get().controls as unknown as Controls; if (c) c.enableZoom = true; } }, [get]);

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
        onWheel={wheel}
        onPointerOver={() => { document.body.style.cursor = 'grab'; zoom(false); setPointerHint(lit ? `${light.name}, ${lightText(light).toLowerCase()} · ${how} · Wheel: brighter, dimmer` : 'Light shows in Pencil, Ink wash, Anime, 3D and Clay: switch to one in the top bar, or from the light\'s menu'); }}
        onPointerOut={() => { document.body.style.cursor = ''; zoom(true); setPointerHint(null); }}
        userData={{ light: light.id }}
      >
        {/* (Handles: a press on the lamp is not a drag of the body behind it.) */}
        {light.kind === 'window' ? (
          // A window: a pane, facing what it lights (its +Z).
          <mesh renderOrder={8} userData={{ handle: true, lamp: true }}>
            <planeGeometry args={[0.15, 0.17]} />
            <meshBasicMaterial color={color} side={THREE.DoubleSide} depthTest={false} transparent opacity={0.55} />
          </mesh>
        ) : (
          // The sun and a lamp: a bulb; the sun and a spot with a shade opening towards what they light.
          <>
            <mesh renderOrder={8} userData={{ handle: true, lamp: true }}>
              <sphereGeometry args={[0.06, 16, 12]} />
              <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.9} />
            </mesh>
            {(sun || light.spot) && (
              <mesh position={[0, 0, 0.08]} rotation-x={-Math.PI / 2} renderOrder={8} userData={{ handle: true, lamp: true }}>
                <coneGeometry args={[0.09, 0.11, 16, 1, true]} />
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
          {/* A spot's or a window's aim: a line to it and its handle. */}
          {!sun && (light.spot || light.kind === 'window') && (
            <>
              <Line points={[at.toArray() as Vec3, to.toArray() as Vec3]} color={LAMP} lineWidth={1} transparent opacity={0.5} dashed dashSize={0.08} gapSize={0.06} />
              <mesh
                ref={aimGlyph}
                position={to}
                renderOrder={8}
                userData={{ handle: true }}
                onPointerDown={aimDown}
                onPointerOver={() => { document.body.style.cursor = 'grab'; setPointerHint(`Drag: where ${light.name} points (over the floor at this height) · Ctrl: the 25 cm grid`); }}
                onPointerOut={() => { document.body.style.cursor = ''; setPointerHint(null); }}
              >
                <sphereGeometry args={[1, 14, 10]} />
                <meshBasicMaterial color={ACCENT} depthTest={false} transparent opacity={0.9} />
              </mesh>
            </>
          )}
        </>
      )}
    </>
  );
}

/** Degrees from a to b, -180 to 180. */
const turn = (a: number, b: number) => ((((b - a) % 360) + 540) % 360) - 180;

/**
 * The lighting circle (#17), with the scene's Lighting selected: a ring on the floor round the
 * people, the horizon seen from above. On it, where the key, the fill and the rim come from, each
 * as far in from the ring as it is high (overhead: at the middle); the shot's camera at its edge.
 * Dragged round, a light comes from there; dragged in or out, higher or lower. Its inspector's
 * direction dial, on the canvas.
 */
export function LightingCircle({ store, scene, time }: { store: Store; scene: Scene; time: number }) {
  const get = useThree((s) => s.get);
  const l = lightingOf(scene);
  const [cx, , cz] = subjectOf(scene);
  const people = scene.figures.filter((f) => !f.hidden);
  const R = Math.max(1.6, ...people.map((f) => Math.hypot(f.position[0] - cx, f.position[2] - cz) + 1));
  const centre = new THREE.Vector3(cx, 0.02, cz);
  const v = cameraAt(scene, scene.animation ? time : 0);
  const camAz = (Math.atan2(v.position.x - v.target.x, v.position.z - v.target.z) * 180) / Math.PI;
  const look = lookOf(l, subjectOf(scene));
  const key = keyLight(l);
  const away = turn(camAz, look.direction) > 0 ? -1 : 1;
  /** Where a light is on the circle: round as it comes from, in as it is high. */
  const spot = (az: number, el: number) => {
    const r = R * Math.cos(THREE.MathUtils.degToRad(el));
    const a = THREE.MathUtils.degToRad(az);
    return centre.clone().add(new THREE.Vector3(Math.sin(a) * r, 0, Math.cos(a) * r));
  };
  const lights = [
    ...(key ? [{ id: key.id, role: 'key' as const, az: look.direction, el: look.height, color: LAMP, size: 1 }] : []),
    ...l.lights.filter((x) => x.kind === 'sun' && (x.role === 'fill' || x.role === 'rim')).map((x) => ({
      id: x.id, role: x.role as 'fill' | 'rim', az: x.relative ? camAz + away * Math.abs(x.azimuth) : x.azimuth, el: x.elevation, color: x.role === 'fill' ? FILL : RIM, size: 0.7,
    })),
  ];
  const ring = Array.from({ length: 73 }, (_, i) => spot((i / 72) * 360, 0).toArray() as Vec3);
  const cam = spot(camAz, 0).add(new THREE.Vector3(Math.sin(THREE.MathUtils.degToRad(camAz)), 0, Math.cos(THREE.MathUtils.degToRad(camAz))).multiplyScalar(0.25));
  const dots = useRef<(THREE.Object3D | null)[]>([]);
  useFrame(({ camera }) => {
    for (const d of dots.current) if (d) d.scale.setScalar(camera.position.distanceTo(d.position) * GLYPH * (d.userData.size as number));
  });

  const down = (e: ThreeEvent<PointerEvent>, x: (typeof lights)[number]) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const { gl, camera, controls } = get() as unknown as { gl: THREE.WebGLRenderer; camera: THREE.Camera; controls: Controls };
    if (controls) controls.enabled = false;
    const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), -centre.y);
    const ray = new THREE.Raycaster();
    const k = `circle:${drags++}`;
    const move = (ev: PointerEvent) => {
      const r = gl.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = ray.ray.intersectPlane(floor, new THREE.Vector3());
      if (!hit) return;
      const d = hit.sub(centre);
      let az = Math.round((Math.atan2(d.x, d.z) * 180) / Math.PI);
      let el = Math.round((Math.acos(Math.min(1, Math.hypot(d.x, d.z) / R)) * 180) / Math.PI);
      if (snapping(ev)) { az = snap(az, STEPS.turn); el = snap(el, STEPS.height); }
      el = Math.min(89, Math.max(5, el));
      if (x.role === 'key') setLook(store, { direction: az, height: el }, k);
      else {
        const light = lightingOf(store.scene).lights.find((y) => y.id === x.id);
        if (light) editLight(store, x.id, { azimuth: light.relative ? Math.abs(turn(camAz, az)) : az, elevation: el }, k);
      }
      setReadout(`${ROLE_NAMES[x.role]}: ${sunText({ azimuth: az, elevation: el }).replace(/^./, (c) => c.toLowerCase())}`);
    };
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

  return (
    <>
      <Line points={ring} color={LAMP} lineWidth={1.5} transparent opacity={0.55} />
      <Line points={[cam.toArray() as Vec3, spot(camAz, 0).toArray() as Vec3]} color="#5b5b66" lineWidth={3} transparent opacity={0.7} />
      {lights.map((x, i) => {
        const at = spot(x.az, x.el);
        return (
          <group key={x.id}>
            <Line points={[centre.toArray() as Vec3, at.toArray() as Vec3]} color={x.color} lineWidth={1} transparent opacity={0.6} dashed dashSize={0.08} gapSize={0.06} />
            <mesh
              ref={(m) => { dots.current[i] = m; }}
              position={at}
              renderOrder={9}
              userData={{ handle: true, size: x.size }}
              onPointerDown={(e) => down(e, x)}
              onClick={(e) => e.stopPropagation()}
              onPointerOver={() => { document.body.style.cursor = 'grab'; setPointerHint(`${ROLE_NAMES[x.role]}: ${sunText({ azimuth: x.az, elevation: x.el }).toLowerCase()} · Drag round: where it comes from · in and out: higher, lower · Ctrl: steps`); }}
              onPointerOut={() => { document.body.style.cursor = ''; setPointerHint(null); }}
            >
              <sphereGeometry args={[0.07, 16, 12]} />
              <meshBasicMaterial color={x.color} depthTest={false} transparent opacity={0.95} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}
