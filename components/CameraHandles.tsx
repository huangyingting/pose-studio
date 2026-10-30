import { useMemo, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { Line } from './Line';
import { aimCamera, editRig, setCameraMove } from '@/lib/actions';
import { cameraById, frameAspect, LENSES, MOVE_NAMES, moveRun, placeCamera, SHOT_SIZES, viewOf } from '@/lib/cameras';
import type { Store } from '@/lib/store';
import type { CameraMove, RigCamera, Scene, ShotSize, Vec3 } from '@/lib/types';
import { setPointerHint, setReadout } from './hints';
import { STEPS, snap, snapping } from './modifiers';

/*
 * The selected camera edited where it is: what it frames (its view cone, also for the camera the
 * pointer rests on), where a path camera looks, and a rig camera's angle round its subject (a ring
 * on the floor) and height (a handle above its foot). The wheel over a rig camera steps its shot
 * size (Shift: its lens). A rig's move (#16): a ghost camera where it ends, dragged to change how
 * far (round, up, sideways, the size it ends at, the lens of a dolly zoom); and its aim, a marker
 * where it looks, dropped on a figure to film that one.
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
export function stepRig(store: Store, cam: RigCamera, by: number, lens: boolean): string {
  if (lens) {
    const i = LENSES.reduce((b, mm, j) => (Math.abs(mm - cam.rig.lens) < Math.abs(LENSES[b] - cam.rig.lens) ? j : b), 0);
    const mm = LENSES[Math.min(LENSES.length - 1, Math.max(0, i + by))];
    editRig(store, cam.id, { lens: mm }, `wheel:${cam.id}`);
    return `${cam.name}: ${mm} mm lens`;
  }
  const i = SHOT_SIZES.findIndex((x) => x.id === cam.rig.size);
  const size = SHOT_SIZES[Math.min(SHOT_SIZES.length - 1, Math.max(0, i + by))];
  editRig(store, cam.id, { size: size.id }, `wheel:${cam.id}`);
  return `${cam.name}: ${size.name.toLowerCase()} shot`;
}

/** A rig camera's height as its handle allows it (degrees above the subject; below as far as the floor allows). */
export const rigPitch = (pitch: number) => Math.min(80, Math.max(-60, pitch));

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
  const follow = (e: ThreeEvent<PointerEvent>, move: (ev: PointerEvent) => void, done?: () => void) => {
    if (e.button !== 0) return false;
    e.stopPropagation();
    const controls = get().controls as unknown as Controls;
    if (controls) controls.enabled = false;
    // (Let go, or cancelled: a touch taken over by the system.)
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (controls) controls.enabled = true;
      setReadout(null);
      done?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return true;
  };
  const floorAt = (x: number, y: number) => {
    const { camera, gl } = get();
    const r = gl.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camera);
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
  };

  // The aim marker as it is dragged (where it is now), and the figure under it.
  const [aiming, setAiming] = useState<{ at: THREE.Vector3; figure: string | null } | null>(null);
  /**
   * What is under a screen point to aim at: a figure (its body's parts say whose they are), or the
   * spot: on a set's or a prop's part, or over the floor at chest height.
   */
  const figureAt = (x: number, y: number) => {
    const { camera, gl, scene: world } = get();
    const r = gl.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camera);
    for (const hit of ray.intersectObjects(world.children, true)) {
      for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
        if (typeof o.userData.figure === 'string') return { figure: o.userData.figure as string, at: hit.point };
        if (o.userData.set !== undefined || typeof o.userData.prop === 'string') return { figure: null, at: hit.point };
      }
    }
    const floor = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    return { figure: null, at: floor ? floor.setY(1) : ray.ray.at(3, new THREE.Vector3()) };
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
        if (snapping(ev)) yaw = snap(yaw, STEPS.turn);
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
        let pitch = rigPitch(pitch0 + (y0 - ev.clientY) * 0.3);
        if (snapping(ev)) pitch = snap(pitch, STEPS.height);
        editRig(store, cam.id, { pitch }, key);
        setReadout(`${cam.name} ${heightText(pitch)}`);
      });
    };
    const over = (text: string, cursor: string) => ({
      onPointerOver: () => { document.body.style.cursor = cursor; setPointerHint(text); },
      onPointerOut: () => { document.body.style.cursor = ''; setPointerHint(null); },
    });
    // The move: where it ends (a ghost camera), dragged to say how far.
    const m = cam.rig.move;
    const run = m ? moveRun(scene, cam, t) : null;
    const endAt = run ? run.end - 1e-3 : null;
    const ends = m && run && endAt !== null && ['arc', 'crane', 'truck', 'push', 'dolly'].includes(m.kind) || (m?.size && run);
    const start = run ? viewOf(scene, cam, run.start) : null;
    const end = ends && endAt !== null ? viewOf(scene, cam, endAt) : null;
    if (end) placeCamera(three, end, frameAspect());
    const endQ = end ? three.quaternion.clone() : null;
    const reshape = (e: ThreeEvent<PointerEvent>) => {
      if (!m || !start || !end || endAt === null) return;
      const key = `move:${cam.id}:${drags++}`;
      const middle = end.target.clone().setY(0);
      const set = (patch: Partial<CameraMove>, text: string) => { setCameraMove(store, cam.id, { ...m, ...patch }, key); setReadout(`${cam.name}: ${text}`); };
      if (m.kind === 'arc') {
        const from = start.position.clone().setY(0);
        const a0 = Math.atan2(from.x - middle.x, from.z - middle.z);
        let last = m.by ?? 0;
        follow(e, (ev) => {
          const h = floorAt(ev.clientX, ev.clientY);
          if (!h) return;
          let by = (Math.atan2(h.x - middle.x, h.z - middle.z) - a0) * R2D;
          // (Kept going the way it went: past half a turn, on round.)
          while (by - last > 180) by -= 360;
          while (by - last < -180) by += 360;
          if (snapping(ev)) by = snap(by, STEPS.turn);
          last = by;
          set({ by: Math.round(by) }, `arc ${Math.round(by)}°`);
        });
      } else if (m.kind === 'crane') {
        const y0 = e.nativeEvent.clientY;
        const by0 = m.by ?? 0;
        follow(e, (ev) => {
          let by = Math.max(-80, Math.min(85, by0 + (y0 - ev.clientY) * 0.3));
          if (snapping(ev)) by = snap(by, STEPS.height);
          set({ by: Math.round(by) }, `crane ${by >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(by))}°`);
        });
      } else if (m.kind === 'truck') {
        const p0 = floorAt(e.nativeEvent.clientX, e.nativeEvent.clientY);
        const right = new THREE.Vector3().crossVectors(start.target.clone().sub(start.position), new THREE.Vector3(0, 1, 0)).setY(0).normalize();
        const by0 = m.by ?? 0;
        follow(e, (ev) => {
          const h = floorAt(ev.clientX, ev.clientY);
          if (!h || !p0) return;
          let by = by0 + h.clone().sub(p0).dot(right);
          by = snapping(ev) ? snap(by, 0.25) : Math.round(by * 100) / 100;
          set({ by }, `truck ${by >= 0 ? 'right' : 'left'} ${Math.abs(by).toFixed(2)} m`);
        });
      } else if (m.kind === 'dolly') {
        const d0 = start.position.clone().setY(0).distanceTo(middle);
        follow(e, (ev) => {
          const h = floorAt(ev.clientX, ev.clientY);
          if (!h) return;
          const mm = Math.round(Math.max(8, Math.min(400, cam.rig.lens * h.distanceTo(middle) / Math.max(0.1, d0))));
          set({ by: mm }, `dolly zoom to ${mm} mm`);
        });
      } else {
        // (The size it ends at: the one whose end is nearest the pointer, out from its subject.)
        const away = SHOT_SIZES.map((x) => {
          const v = viewOf(scene, { ...cam, rig: { ...cam.rig, move: { ...m, size: x.id } } }, endAt);
          return { size: x.id as ShotSize, d: v.position.clone().setY(0).distanceTo(middle) };
        });
        follow(e, (ev) => {
          const h = floorAt(ev.clientX, ev.clientY);
          if (!h) return;
          const d = h.distanceTo(middle);
          const best = away.reduce((b, x) => (Math.abs(Math.log(x.d / d)) < Math.abs(Math.log(b.d / d)) ? x : b));
          set({ size: best.size }, `${MOVE_NAMES[m.kind].toLowerCase()} to ${SHOT_SIZES.find((x) => x.id === best.size)!.name.toLowerCase()}`);
        });
      }
    };
    // Its aim: a marker where it looks now; dropped on a figure, that one is its subject.
    const aim = (e: ThreeEvent<PointerEvent>) => {
      let last: { at: THREE.Vector3; figure: string | null } | null = null;
      follow(e, (ev) => { last = figureAt(ev.clientX, ev.clientY); setAiming(last); }, () => {
        const got = last as { figure: string | null; at: THREE.Vector3 } | null;
        if (got?.figure) { if (got.figure !== cam.subject || cam.point) aimCamera(store, cam.id, { figure: got.figure }); }
        else if (got) aimCamera(store, cam.id, { point: got.at.toArray() as Vec3 });
        setAiming(null);
      });
    };
    const target = aiming?.at ?? view.target;
    const onFigure = aiming?.figure ? scene.figures.find((f) => f.id === aiming.figure)?.name : null;
    rig = (
      <>
        {end && endQ && (
          <>
            {/* Where the move ends: a ghost of the camera, dragged to say how far. */}
            <group position={end.position} quaternion={endQ} onPointerDown={reshape} {...over(`Drag: where ${cam.name}'s ${MOVE_NAMES[m!.kind].toLowerCase()} ends`, 'grab')}>
              <mesh userData={{ handle: true }}>
                <boxGeometry args={[0.16, 0.11, 0.13]} />
                <meshBasicMaterial color={ACCENT} transparent opacity={0.35} depthWrite={false} />
              </mesh>
              <mesh position={[0, 0, -0.11]} rotation={[Math.PI / 2, 0, 0]} userData={{ handle: true }}>
                <coneGeometry args={[0.07, 0.1, 12, 1, true]} />
                <meshBasicMaterial color={ACCENT} transparent opacity={0.35} side={THREE.DoubleSide} depthWrite={false} />
              </mesh>
            </group>
            {start && <Line points={[start.position.toArray() as Vec3, end.position.toArray() as Vec3]} color={ACCENT} lineWidth={1} dashed dashSize={0.05} gapSize={0.06} transparent opacity={0.4} />}
          </>
        )}
        {/* Where it looks: the aim marker, dropped on a figure to film that one. */}
        <Line points={[view.position.toArray() as Vec3, target.toArray() as Vec3]} color={ACCENT} lineWidth={1} dashed dashSize={0.08} gapSize={0.06} transparent opacity={0.5} />
        <group position={target}>
          <mesh renderOrder={9} raycast={() => {}}>
            <torusGeometry args={[0.06, 0.012, 8, 24]} />
            <meshBasicMaterial color={onFigure ? '#16a34a' : ACCENT} depthTest={false} transparent opacity={0.9} />
          </mesh>
          {/* (Grabbed anywhere within it, not only on its thin ring.) */}
          <mesh visible={false} userData={{ handle: true }} onPointerDown={aim} {...(aiming ? { raycast: () => {} } : {})} {...over(`Drag: what ${cam.name} films — a figure${onFigure ? ` (${onFigure})` : ''}, or the spot it is let go on`, 'grab')}>
            <sphereGeometry args={[0.09, 12, 8]} />
          </mesh>
        </group>
        {/* The angle: round the subject, on the floor. */}
        <mesh position={[center.x, 0.006, center.z]} rotation-x={-Math.PI / 2} renderOrder={5}>
          <ringGeometry args={[radius - 0.012, radius + 0.012, 96]} />
          <meshBasicMaterial color={ACCENT} transparent opacity={0.55} depthWrite={false} />
        </mesh>
        <mesh position={[center.x, 0.006, center.z]} rotation-x={-Math.PI / 2} visible={false} onPointerDown={turn} {...over(`Drag round: ${cam.name}'s angle on its subject (${rigAngle(cam.rig.yaw)}) · Ctrl: 15° steps`, 'ew-resize')}>
          <ringGeometry args={[radius - 0.15, radius + 0.15, 64]} />
        </mesh>
        <mesh position={[foot.x, 0.03, foot.z]} onPointerDown={turn} {...over(`Drag round: ${cam.name}'s angle on its subject (${rigAngle(cam.rig.yaw)})`, 'ew-resize')}>
          <sphereGeometry args={[0.05, 16, 12]} />
          <meshBasicMaterial color={ACCENT} />
        </mesh>
        {/* The height: a handle on a line up from its foot. */}
        <Line points={[[foot.x, 0, foot.z], view.position.toArray() as Vec3]} color={ACCENT} lineWidth={1} dashed dashSize={0.06} gapSize={0.05} transparent opacity={0.6} />
        <mesh position={[foot.x, Math.max(0.1, view.position.y - 0.2), foot.z]} onPointerDown={lift} {...over(`Drag up or down: ${cam.name}'s height (${heightText(cam.rig.pitch)}) · Ctrl: 5° steps`, 'ns-resize')}>
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
