import { useMemo, type ReactNode } from 'react';
import * as THREE from 'three';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { editRig } from '@/lib/actions';
import { cameraById, frameAspect, LENSES, placeCamera, SHOT_SIZES, viewOf } from '@/lib/cameras';
import type { Store } from '@/lib/store';
import type { RigCamera, Scene, Vec3 } from '@/lib/types';
import { setPointerHint, setReadout } from './hints';

/*
 * The selected camera edited where it is: what it frames (its view cone, also for the camera the
 * pointer rests on), where a path camera looks, and a rig camera's angle round its subject (a ring
 * on the floor) and height (a handle above its foot). The wheel over a rig camera steps its shot
 * size (Shift: its lens).
 */

const R2D = 180 / Math.PI;
const ACCENT = '#3b6cff';
type Controls = { enabled: boolean; enableZoom: boolean } | null;
let drags = 0;

/** A rig camera's angle round its subject, as said ("from the front, 30° left"). */
export function rigAngle(yaw: number) {
  const a = Math.round(Math.abs(yaw));
  const side = yaw > 0 ? 'left' : 'right';
  if (a <= 2) return 'from the front';
  if (a >= 178) return 'from behind';
  return a <= 90 ? `from the front, ${a}° ${side}` : `from behind, ${180 - a}° ${side}`;
}
const heightText = (pitch: number) => (Math.abs(pitch) < 1 ? 'level with the subject' : `${Math.round(Math.abs(pitch))}° ${pitch > 0 ? 'above' : 'below'}`);

/** A rig camera's shot size or lens a step closer (+1) or wider (−1): the wheel over it. */
export function stepRig(store: Store, cam: RigCamera, by: number, lens: boolean) {
  if (lens) {
    const i = LENSES.reduce((b, mm, j) => (Math.abs(mm - cam.rig.lens) < Math.abs(LENSES[b] - cam.rig.lens) ? j : b), 0);
    const mm = LENSES[Math.min(LENSES.length - 1, Math.max(0, i + by))];
    editRig(store, cam.id, { lens: mm }, `wheel:${cam.id}`);
    setPointerHint(`${cam.name}: ${mm} mm lens · Wheel: shot size`);
  } else {
    const i = SHOT_SIZES.findIndex((x) => x.id === cam.rig.size);
    const size = SHOT_SIZES[Math.min(SHOT_SIZES.length - 1, Math.max(0, i + by))];
    editRig(store, cam.id, { size: size.id }, `wheel:${cam.id}`);
    setPointerHint(`${cam.name}: ${size.name.toLowerCase()} shot · Shift-wheel: lens`);
  }
}

export default function CameraHandles({ store, scene, time, picked, hovered }: { store: Store; scene: Scene; time: number; picked: string | null; hovered: string | null }) {
  const get = useThree((s) => s.get);
  const t = scene.animation ? time : 0;
  const three = useMemo(() => new THREE.PerspectiveCamera(), []);

  /** The view cone of a camera now, out to what it looks at: its edges as line segments. */
  const cone = (id: string): Vec3[] => {
    const cam = cameraById(scene, id);
    if (!cam) return [];
    const view = viewOf(scene, cam, t);
    const aspect = frameAspect();
    placeCamera(three, view, aspect);
    const d = view.position.distanceTo(view.target);
    const h = d * Math.tan((three.fov * Math.PI) / 360);
    const w = h * aspect;
    const at = (x: number, y: number) => new THREE.Vector3(x * w, y * h, -d).applyMatrix4(three.matrixWorld).toArray() as Vec3;
    const apex = view.position.toArray() as Vec3;
    const c = [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
    return [...c.flatMap((p) => [apex, p]), c[0], c[1], c[1], c[2], c[2], c[3], c[3], c[0]];
  };

  /** Follow the pointer until it is let go, the view's orbit off meanwhile. */
  const follow = (e: ThreeEvent<PointerEvent>, move: (ev: PointerEvent) => void) => {
    if (e.button !== 0) return false;
    e.stopPropagation();
    const controls = get().controls as unknown as Controls;
    if (controls) controls.enabled = false;
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (controls) controls.enabled = true;
      setReadout(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return true;
  };
  const floorAt = (x: number, y: number) => {
    const { camera, gl } = get();
    const r = gl.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camera);
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
  };

  const cones = [...new Set([picked, hovered].filter((x): x is string => !!x))];
  const cam = picked ? cameraById(scene, picked) : undefined;
  const view = cam ? viewOf(scene, cam, t) : null;

  let rig: ReactNode = null;
  if (cam?.kind === 'rig' && view) {
    const center = view.target.clone().setY(0);
    const foot = view.position.clone().setY(0);
    const radius = Math.max(0.2, center.distanceTo(foot));
    const turn = (e: ThreeEvent<PointerEvent>) => {
      const a0 = Math.atan2(e.point.x - center.x, e.point.z - center.z) * R2D;
      const yaw0 = cam.rig.yaw;
      const key = `rigyaw:${cam.id}:${drags++}`;
      follow(e, (ev) => {
        const h = floorAt(ev.clientX, ev.clientY);
        if (!h) return;
        let yaw = yaw0 + Math.atan2(h.x - center.x, h.z - center.z) * R2D - a0;
        if (ev.shiftKey) yaw = Math.round(yaw / 15) * 15;
        yaw = ((((yaw + 180) % 360) + 360) % 360) - 180;
        editRig(store, cam.id, { yaw }, key);
        setReadout(`${cam.name} ${rigAngle(yaw)}`);
      });
    };
    const lift = (e: ThreeEvent<PointerEvent>) => {
      const y0 = e.nativeEvent.clientY;
      const pitch0 = cam.rig.pitch;
      const key = `rigpitch:${cam.id}:${drags++}`;
      follow(e, (ev) => {
        let pitch = Math.min(80, Math.max(-60, pitch0 + (y0 - ev.clientY) * 0.3));
        if (ev.shiftKey) pitch = Math.round(pitch / 5) * 5;
        editRig(store, cam.id, { pitch }, key);
        setReadout(`${cam.name} ${heightText(pitch)}`);
      });
    };
    const over = (text: string, cursor: string) => ({
      onPointerOver: () => { document.body.style.cursor = cursor; setPointerHint(text); },
      onPointerOut: () => { document.body.style.cursor = ''; setPointerHint(null); },
    });
    rig = (
      <>
        {/* The angle: round the subject, on the floor. */}
        <mesh position={[center.x, 0.006, center.z]} rotation-x={-Math.PI / 2} renderOrder={5}>
          <ringGeometry args={[radius - 0.012, radius + 0.012, 96]} />
          <meshBasicMaterial color={ACCENT} transparent opacity={0.55} depthWrite={false} />
        </mesh>
        <mesh position={[center.x, 0.006, center.z]} rotation-x={-Math.PI / 2} visible={false} onPointerDown={turn} {...over(`Drag round: ${cam.name}'s angle on its subject (${rigAngle(cam.rig.yaw)}) · Shift: 15° steps`, 'ew-resize')}>
          <ringGeometry args={[radius - 0.15, radius + 0.15, 64]} />
        </mesh>
        <mesh position={[foot.x, 0.03, foot.z]} onPointerDown={turn} {...over(`Drag round: ${cam.name}'s angle on its subject (${rigAngle(cam.rig.yaw)})`, 'ew-resize')}>
          <sphereGeometry args={[0.05, 16, 12]} />
          <meshBasicMaterial color={ACCENT} />
        </mesh>
        {/* The height: a handle on a line up from its foot. */}
        <Line points={[[foot.x, 0, foot.z], view.position.toArray() as Vec3]} color={ACCENT} lineWidth={1} dashed dashSize={0.06} gapSize={0.05} transparent opacity={0.6} />
        <mesh position={[foot.x, Math.max(0.1, view.position.y - 0.2), foot.z]} onPointerDown={lift} {...over(`Drag up or down: ${cam.name}'s height (${heightText(cam.rig.pitch)}) · Shift: 5° steps`, 'ns-resize')}>
          <octahedronGeometry args={[0.045]} />
          <meshBasicMaterial color={ACCENT} />
        </mesh>
      </>
    );
  }

  return (
    <>
      {cones.map((id) => {
        const pts = cone(id);
        return pts.length ? <Line key={`cone:${id}`} points={pts} segments color={ACCENT} lineWidth={id === picked ? 1.2 : 1} transparent opacity={id === picked ? 0.7 : 0.45} /> : null;
      })}
      {/* Where a path camera looks when it aims at its subject or along its path (aimed at a point, its look point has a handle). */}
      {cam?.kind === 'path' && cam.aim !== 'point' && view && (
        <Line points={[view.position.toArray() as Vec3, view.target.toArray() as Vec3]} color={ACCENT} lineWidth={1} dashed dashSize={0.1} gapSize={0.08} transparent opacity={0.6} />
      )}
      {rig}
    </>
  );
}
