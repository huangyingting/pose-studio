'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { addCameraPoint, moveCameraLook, moveCameraPoint, setCameraLens, stepRig } from '@/lib/actions';
import { cameraAt, fovLens, frameAspect, LENSES, liveCamera, placeCamera, trailTimes, viewOf } from '@/lib/cameras';
import type { Store } from '@/lib/store';
import type { Scene, Selection } from '@/lib/types';
import CameraHandles from './CameraHandles';
import type { Clock } from './clock';
import { GLYPH, GLYPH_LINKED } from './glyphs';
import { cameraHint, metres, movedText, setPointerHint, setReadout } from './hints';
import { Line } from './Line';
import { useStudio } from './store-context';
import { useSettled } from './useSettled';

type Controls = { target: THREE.Vector3; enabled: boolean; update(): void } | null;

type Trail = { id: string; rig: boolean; times: number[]; points: THREE.Vector3[] };

/**
 * The cameras' trails (where each is every tenth of a second; a rig's only while it is selected), worked out once a drag rests and a
 * little at a time between frames (a camera on someone poses them at each sample: a long block of
 * work at once would hold up the drop). The trails before stay shown until the new ones are done;
 * each keeps to its own camera.
 */
function useTrails(scene: Scene, rig: string | null): Trail[] {
  const [trails, setTrails] = useState<Trail[]>([]);
  const { cameras, animation } = scene;
  useEffect(() => {
    const aspect = frameAspect();
    // (A rig's only while it is selected: each of its points poses whom it films, again after every edit.)
    const jobs = cameras.filter((c) => c.kind !== 'rig' || c.id === rig).map((c) => ({ cam: c, trail: { id: c.id, rig: c.kind === 'rig', times: trailTimes(scene, c), points: [] as THREE.Vector3[] } }));
    let job = 0;
    let timer = 0;
    const work = () => {
      const until = performance.now() + 8;
      while (job < jobs.length && performance.now() < until) {
        const { cam, trail } = jobs[job];
        if (trail.points.length < trail.times.length) trail.points.push(viewOf(scene, cam, trail.times[trail.points.length], aspect).position);
        else job++;
      }
      if (job < jobs.length) timer = window.setTimeout(work, 0);
      else setTrails(jobs.map((j) => j.trail));
    };
    timer = window.setTimeout(work, 0);
    return () => window.clearTimeout(timer);
    // (The cameras and the motion, not the figures as the playhead poses them.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameras, animation, rig]);
  return trails;
}

/** Each drag of a camera is one undo step. */
let drags = 0;

/**
 * The cameras' paths through the set (one line each), a camera at each point of them and, for a
 * camera looking at a point, that point. Drag a camera to move it across the floor (Shift: up and
 * down), a look point to aim the camera; double-click a path to add a point there; right-click a
 * camera to delete the point. A camera placing itself from its subject (a rig) shows where it goes,
 * dashed. The red dot is the camera filming at the playhead.
 */
export default function CameraRig({ store, scene, clock, time, selection, groupRef }: { store: Store; scene: Scene; clock: Clock; time: number; selection: Selection; groupRef: RefObject<THREE.Group | null> }) {
  const a = scene.animation;
  const fps = a?.fps ?? 24;
  const get = useThree((s) => s.get);
  const dot = useRef<THREE.Mesh>(null);
  const [three] = useState(() => new THREE.PerspectiveCamera(30, frameAspect()));
  // The paths and cameras only depend on the cameras, the shots and the motion, not on the playhead.
  const cameras = scene.cameras;
  // (Worked out again when the cameras or the animation change, not as the playhead moves the figures.)
  // (A rig's trail while it, or a shot it films, is selected.)
  const chosen = selection?.kind === 'camera' ? selection.camera : selection?.kind === 'shot' ? a?.shots.find((x) => x.id === selection.shot)?.camera : undefined;
  const shown = chosen && cameras.find((c) => c.id === chosen)?.kind === 'rig' ? chosen : null;
  const trails = useTrails(useSettled(scene), shown);
  const markers = useMemo(() => cameras.flatMap((c) => (c.kind === 'path' ? c.points : []).map((p) => {
    const view = viewOf(scene, c, p.t);
    placeCamera(three, view, frameAspect());
    return { t: p.t, cam: c, position: three.position.clone(), quaternion: three.quaternion.clone(), target: view.target.clone(), aimed: c.kind === 'path' && c.aim === 'point' };
    // (Its points move only with the cameras: not again as the playhead poses the figures.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [cameras, three]);
  const lastDot = useRef(NaN);
  // (After an edit, the cameras placed again one a frame: a click straight after is not held up.)
  const pending = useRef<number[]>([]);
  const placedAt = useRef(NaN);
  useEffect(() => { lastDot.current = NaN; }, [trails]);
  // Every camera where it is at the playhead (a path camera's points have their own glyphs).
  const nowGlyphs = useRef<(THREE.Object3D | null)[]>([]);
  // Those at one of their path's points now (hidden there: the point's glyph is the one to drag).
  const onPoint = useRef<boolean[]>([]);

  const glyphs = useRef<(THREE.Object3D | null)[]>([]);
  useFrame((state) => {
    // Keep the cameras a constant size on screen, however far they are.
    const scale = (o: THREE.Object3D, k = GLYPH) => {
      const d = state.camera.position.distanceTo(o.position);
      o.visible = d > 0.3;
      o.scale.setScalar(d * k);
    };
    for (const g of glyphs.current) if (g) scale(g, g.userData.look ? 0.03 : GLYPH);
    // The playhead's camera position (placed again only when the time changes).
    if (!dot.current) return;
    const t = clock.playing ? clock.time : time;
    const place = (i: number) => {
      const g = nowGlyphs.current[i];
      const c = cameras[i];
      if (!g || !c) return;
      placeCamera(three, viewOf(scene, c, a ? t : 0), frameAspect());
      g.position.copy(three.position);
      g.quaternion.copy(three.quaternion);
      onPoint.current[i] = c.kind === 'path' && c.points.some((p) => Math.abs(p.t - t) < 0.5 / fps);
    };
    if (t !== lastDot.current) {
      lastDot.current = t;
      dot.current.position.copy(cameraAt(scene, t).position);
      // The same time as before (an edit): one a frame; another time (scrubbing, playing): all now.
      if (t === placedAt.current) pending.current = cameras.map((_, i) => i);
      else {
        pending.current = [];
        cameras.forEach((_, i) => place(i));
      }
      placedAt.current = t;
    } else if (pending.current.length) {
      place(pending.current.shift()!);
    }
    if (pending.current.length) state.invalidate();
    scale(dot.current);
    // (The camera whose outline row the pointer rests on, larger.)
    nowGlyphs.current.forEach((g, i) => { if (g) { scale(g, cameras[i]?.id === store.getState().linked ? GLYPH_LINKED : GLYPH); g.visible &&= !onPoint.current[i]; } });
  });

  /** Follow the pointer across a plane through `from` (level, or upright facing the view with Shift). */
  const dragOn = (e: ThreeEvent<PointerEvent>, from: THREE.Vector3, t: number, camera: string, apply: (p: THREE.Vector3, key: string) => void) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    clock.pause();
    store.setTime(t);
    store.select({ kind: 'camera', camera });
    const controls = get().controls as unknown as Controls;
    if (controls) controls.enabled = false;
    const canvas = get().gl.domElement;
    canvas.setPointerCapture(e.pointerId);
    const view = get().camera;
    const upright = e.nativeEvent.shiftKey;
    const normal = upright ? view.getWorldDirection(new THREE.Vector3()).setY(0).normalize() : new THREE.Vector3(0, 1, 0);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, from);
    const hit = new THREE.Vector3();
    const ray = new THREE.Raycaster();
    const key = `camdrag:${t}:${drags++}`;
    const move = (ev: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), view);
      if (!ray.ray.intersectPlane(plane, hit)) return;
      // Level: across the floor at its height; upright: only up and down.
      const to = upright ? new THREE.Vector3(from.x, Math.max(0.05, hit.y), from.z) : new THREE.Vector3(hit.x, from.y, hit.z);
      apply(to, key);
      setReadout(`${upright ? '' : `${movedText(to.x - from.x, to.z - from.z, to.x, to.z)} · `}${metres(to.y)} m high`, [to.x, to.y, to.z]);
    };
    const up = () => {
      setReadout(null);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      if (controls) controls.enabled = true;
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
  };

  /** A double-click on a camera's path: a point there, the camera as it is then. */
  const addPoint = (camera: string, times: number[]) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const i = Math.min(times.length - 2, Math.max(0, Math.floor(((e as unknown as { faceIndex?: number }).faceIndex ?? 0))));
    const t = Math.round(((times[i] + times[i + 1]) / 2) * fps) / fps;
    store.setTime(t);
    store.select({ kind: 'camera', camera });
    addCameraPoint(store, camera, t);
  };

  const now = clock.playing ? clock.time : time;
  const picked = selection?.kind === 'camera' ? selection.camera : selection?.kind === 'shot' ? a?.shots.find((x) => x.id === selection.shot)?.camera : null;
  // The camera whose outline row the pointer rests on (larger, in the accent); resting on one here marks its row.
  const linked = useStudio((st) => st.linked);
  // Over a rig camera the wheel steps its shot size, not the view's zoom. (One removed, or made a
  // path camera, while the pointer rests on it: the zoom comes back then, or when these go.)
  const zoomOff = useRef<string | null>(null);
  const wheelAt = useRef(0);
  const setZoom = useCallback((on: boolean) => { const controls = get().controls as unknown as { enableZoom: boolean } | null; if (controls) controls.enableZoom = on; }, [get]);
  useEffect(() => {
    if (zoomOff.current && !cameras.some((c) => c.id === zoomOff.current && c.kind === 'rig')) { zoomOff.current = null; setZoom(true); }
  }, [cameras, setZoom]);
  useEffect(() => () => setZoom(true), [setZoom]);
  // A path camera's point now (a still camera's one): the one its wheel and gizmo change.
  const pointNow = (c: (typeof cameras)[number]) => {
    if (c.kind !== 'path') return undefined;
    const t = a ? time : 0;
    return (c.points.find((p) => Math.abs(p.t - t) < 0.5 / fps) ?? (c.points.length === 1 ? c.points[0] : undefined))?.t;
  };
  /** The wheel over a camera: a rig camera's shot size (Shift: its lens); a path camera's lens at its point. */
  const wheel = (c: (typeof cameras)[number], at?: number) => (e: ThreeEvent<WheelEvent>) => {
    e.stopPropagation();
    // (Shift turns the wheel sideways in most browsers, so either way counts; a step comes at the
    // first event after a pause, so a trackpad's swipe and its momentum are one step.)
    const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    const now = performance.now();
    const quiet = now - wheelAt.current > 180;
    wheelAt.current = now;
    if (!d || !quiet) return;
    if (c.kind === 'rig') { setPointerHint(`${stepRig(store, c, d < 0 ? 1 : -1, e.nativeEvent.shiftKey)} · ${e.nativeEvent.shiftKey ? 'Wheel: shot size' : 'Shift-wheel: lens'}`); return; }
    const t = at ?? pointNow(c);
    if (t === undefined) return;
    const lens = fovLens(viewOf(scene, c, t).fov, frameAspect());
    const i = LENSES.reduce((b, mm, j) => (Math.abs(mm - lens) < Math.abs(LENSES[b] - lens) ? j : b), 0);
    const mm = LENSES[Math.min(LENSES.length - 1, Math.max(0, i + (d < 0 ? 1 : -1)))];
    setCameraLens(store, c.id, t, mm, `wheel:${c.id}:${t}`);
    setPointerHint(`${c.name}: ${mm} mm lens · Wheel: longer, wider`);
  };
  const link = (id: string, at?: number) => {
    const cam = cameras.find((c) => c.id === id);
    const zoom = (on: boolean) => {
      // (Off over a camera its wheel changes; back on when the pointer leaves the one it was turned off for, whatever it is now.)
      if (on ? zoomOff.current !== id : !cam || (cam.kind === 'path' && (at ?? pointNow(cam)) === undefined)) return;
      zoomOff.current = on ? null : id;
      setZoom(on);
    };
    return {
      onPointerOver: () => { store.setLinked(id); zoom(false); setPointerHint(cameraHint(cam?.name ?? 'the camera', cam?.kind === 'rig')); },
      onPointerOut: () => { store.setLinked(null); zoom(true); setPointerHint(null); },
    };
  };
  let n = 0;
  return (
    <group ref={groupRef}>
      {cameras.map((c, i) => {
        const color = c.id === picked || c.id === linked ? '#3b6cff' : '#60616a';
        return (
          <group
            key={`now:${c.id}`}
            ref={(g) => { nowGlyphs.current[i] = g; }}
            userData={{ camera: c.id }}
            onPointerDown={(e) => { if (e.button !== 0 || !e.eventObject.visible) return; e.stopPropagation(); store.select({ kind: 'camera', camera: c.id }); }}
            onWheel={wheel(c)}
            {...link(c.id)}
          >
            <mesh>
              <boxGeometry args={[0.14, 0.1, 0.12]} />
              <meshBasicMaterial color={color} transparent opacity={0.55} />
            </mesh>
            <mesh position={[0, 0, -0.1]} rotation={[Math.PI / 2, 0, 0]}>
              <coneGeometry args={[0.06, 0.09, 12, 1, true]} />
              <meshBasicMaterial color={color} transparent opacity={0.55} side={THREE.DoubleSide} />
            </mesh>
          </group>
        );
      })}
      {trails.filter((trail) => trail.points.length > 1 && cameras.some((c) => c.id === trail.id)).map((trail) => (
        <Line key={trail.id} points={trail.points} color="#3b6cff" lineWidth={trail.id === picked || trail.id === linked ? 3 : 1.5} transparent opacity={0.7} dashed={trail.rig} dashSize={0.15} gapSize={0.1} onDoubleClick={trail.rig ? undefined : addPoint(trail.id, trail.times)} />
      ))}
      {markers.map((m) => {
        const on = Math.abs(m.t - now) < 0.5 / fps && liveCamera(scene, now).id === m.cam.id;
        const color = on || m.cam.id === linked ? '#3b6cff' : '#27272a';
        const k = n++;
        const l = m.aimed ? n++ : -1;
        return (
          <group key={`${m.cam.id}:${m.t}`}>
            <group
              ref={(g) => { glyphs.current[k] = g; }}
              position={m.position}
              quaternion={m.quaternion}
              userData={{ camera: m.cam.id, point: m.t }}
              onPointerDown={(e) => dragOn(e, m.position, m.t, m.cam.id, (p, key) => moveCameraPoint(store, m.cam.id, m.t, p, key))}
              onWheel={wheel(m.cam, m.t)}
              {...link(m.cam.id, m.t)}
            >
              {/* A small camera: body and lens, looking down its −Z axis. */}
              <mesh>
                <boxGeometry args={[0.14, 0.1, 0.12]} />
                <meshBasicMaterial color={color} />
              </mesh>
              <mesh position={[0, 0, -0.1]} rotation={[Math.PI / 2, 0, 0]}>
                <coneGeometry args={[0.06, 0.09, 12, 1, true]} />
                <meshBasicMaterial color={color} side={THREE.DoubleSide} />
              </mesh>
            </group>
            {m.aimed && (
              <>
                <Line points={[m.position, m.target]} color="#3b6cff" lineWidth={1} dashed dashSize={0.1} gapSize={0.08} transparent opacity={0.5} />
                <mesh
                  ref={(g) => { glyphs.current[l] = g; if (g) g.userData.look = true; }}
                  position={m.target}
                  onPointerDown={(e) => dragOn(e, m.target, m.t, m.cam.id, (p, key) => moveCameraLook(store, m.cam.id, m.t, p, key))}
                >
                  <sphereGeometry args={[1, 14, 10]} />
                  <meshBasicMaterial color={on ? '#3b6cff' : '#60616a'} />
                </mesh>
              </>
            )}
          </group>
        );
      })}
      <mesh ref={dot}>
        <sphereGeometry args={[0.035, 16, 12]} />
        <meshBasicMaterial color="#e5484d" />
      </mesh>
      {!clock.playing && <CameraHandles store={store} scene={scene} time={time} picked={picked ?? null} hovered={linked && cameras.some((c) => c.id === linked) ? linked : null} />}
    </group>
  );
}
