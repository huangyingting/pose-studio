'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, ArrowRightToLine, ArrowUpDown, ArrowUpFromLine, Camera as CameraIcon, Clapperboard, Eye, Focus, MoveHorizontal, Plus, RotateCcw, RotateCw, Spline, Square, Trash2, ZoomIn, type LucideIcon } from 'lucide-react';
import { addCameraPoint, applyCameraMove, deleteCameraPoint, editAsPath, editCamera, editRig, frameShot, setCameraMove, setLens } from '@/lib/actions';
import { CAMERA_GROUPS, CAMERA_MOVES, LENSES, MOVE_NAMES, SHOT_SIZES, frameAspect, liveCamera, sizeOf, viewOf } from '@/lib/cameras';
import { sceneAt } from '@/lib/evaluate';
import { sharedRenderer } from '@/lib/thumbnails';
import { shotSpans } from '@/lib/shots';
import type { Store } from '@/lib/store';
import type { Camera, CameraMove, CameraRig, MoveKind, PathCamera, Placement, RigCamera, ShotSize, Style } from '@/lib/types';
import { menu } from '../commands';
import { useProjectSettings, useStudio } from '../store-context';
import { Hint, IconButton, Info, Menu, NameHeader, NumberField, PropertyRow, Segmented, Select, Slider, Toggle, type HeaderChrome } from '../ui';
import type { Target } from './target';

/* A camera's header and sections: see sections.ts for which show when. */

export function CameraHeader({ t, chrome }: { t: Target; chrome: HeaderChrome }) {
  const cam = t.camera!;
  const through = useStudio((st) => st.through?.camera === cam.id);
  return (
    <NameHeader chrome={chrome} lead={<CameraIcon size={15} aria-hidden />} name={cam.name} label="Camera name" onRename={(name) => editCamera(t.store, cam.id, { name })} menu={() => menu('camera', { store: t.store, camera: cam.id })}>
      <IconButton icon={Eye} label="Look through this camera" active={through} pressed={through} onClick={() => t.store.lookThrough(through ? null : { camera: cam.id })} />
    </NameHeader>
  );
}

const filmsOf = (t: Target) => (t.scene.animation ? shotSpans(t.scene.animation).filter((s) => s.shot.camera === t.camera!.id) : []);
const isFirst = (t: Target) => t.scene.cameras[0].id === t.camera!.id;
export const filmsSummary = (t: Target) => {
  const films = filmsOf(t);
  return !t.scene.animation ? (isFirst(t) ? 'The still' : 'Not filming') : films.length ? `${films.length} ${films.length === 1 ? 'shot' : 'shots'}` : 'No shots';
};
export const filmsInfo = (t: Target) => (!t.scene.animation ? 'A still scene is filmed by its first camera; the others are other angles on it.' : 'Pick a camera for a shot in the shot\'s inspector.');

/** The shots it films. */
export function FilmsPanel({ t }: { t: Target }) {
  const films = filmsOf(t);
  if (!t.scene.animation) return <Hint>{isFirst(t) ? 'The still' : 'Another angle on the still'}</Hint>;
  if (!films.length) return <Hint>No shot films with it yet</Hint>;
  return (
    <ul className="side-list" aria-label="Shots it films">
      {films.map((s) => (
        <li key={s.shot.id}>
          <button type="button" onClick={() => { t.store.setTime(s.start); t.store.select({ kind: 'shot', shot: s.shot.id }); }}>
            <span className="shot-no">{s.index + 1}</span>
            <span className="side-list-name">{s.shot.name}</span>
            <em>{s.start.toFixed(1)}–{s.end.toFixed(1)} s</em>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Its shot size and lens: a rig's always; a path's at the playhead, while it is filming (or in a still). */
function framingOf(store: Store, cam: Camera, time: number) {
  const scene = store.scene;
  const a = scene.animation;
  const rig = cam.kind === 'rig' ? cam.rig : null;
  const t = a ? time : 0;
  const live = !a || liveCamera(scene, time).id === cam.id;
  const view = live && !rig ? viewOf(scene, cam, t) : null;
  const size = rig ? rig.size : view ? sizeOf(scene, cam, t, view) : null;
  const lens = rig ? Math.round(rig.lens) : view ? Math.round(view.lens) : null;
  return { rig, size, lens };
}
const subjectOf = (t: Target) => {
  const shown = t.scene.figures.filter((f) => !f.hidden);
  return shown.find((f) => f.id === t.camera!.subject);
};
export const framingSummary = (t: Target) => [subjectOf(t)?.name ?? 'Everyone', SHOT_SIZES.find((x) => x.id === framingOf(t.store, t.camera!, t.time).size)?.short].filter(Boolean).join(' · ');
export const lensSummary = (t: Target) => { const { lens } = framingOf(t.store, t.camera!, t.time); return lens ? `${lens} mm` : 'Not filming now'; };

/** What it films: its subject (and whom with), its shot size, where the subject sits. */
export function FramingPanel({ t }: { t: Target }) {
  const time = useStudio((s) => s.time);
  const [placed, setPlaced] = useState<Placement>('center');
  const cam = t.camera!;
  const { rig, size, lens } = framingOf(t.store, cam, time);
  const place = rig ? rig.place ?? 'center' : placed;
  const set = (patch: Parameters<typeof editCamera>[2]) => editCamera(t.store, cam.id, patch);
  const shown = t.scene.figures.filter((f) => !f.hidden);
  const subject = subjectOf(t)?.id;
  const frame = (to: ShotSize, at: Placement) => (rig ? editRig(t.store, cam.id, { size: to, place: at }) : frameShot(t.store, to, { place: at, camera: cam.id }));
  return (
    <>
      <div className="field">
        <span>Subject</span>
        <Select
          label="Camera subject"
          value={subject ?? 'all'}
          onChange={(v) => set({ subject: v === 'all' ? '' : v })}
          options={[{ value: 'all', label: 'Everyone' }, ...shown.map((f) => ({ value: f.id, label: f.name }))]}
        />
        {subject && shown.length > 1 && (
          // A two-shot (or more): whom it frames with its subject.
          <div className="chips" role="group" aria-label="Frames with">
            {shown.filter((f) => f.id !== subject).map((f) => {
              const on = !!cam.also?.includes(f.id);
              return (
                <button key={f.id} type="button" className={on ? 'chip on' : 'chip'} aria-pressed={on} onClick={() => set({ also: on ? cam.also!.filter((x) => x !== f.id) : [...(cam.also ?? []), f.id] })}>
                  with {f.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {size && lens ? (
        <>
          <PropertyRow label="Size" info={rig ? 'Kept as the subject moves.' : t.scene.animation ? 'At the playhead: the camera moves to frame it.' : undefined}>
            <Select<ShotSize> label="Shot size" value={size} onChange={(x) => frame(x, place)} options={SHOT_SIZES.map((x) => ({ value: x.id, label: `${x.short} · ${x.name}` }))} />
          </PropertyRow>
          <PropertyRow label="Place">
            <Segmented<Placement>
              label="Subject in the frame"
              full
              value={place}
              onChange={(p) => { setPlaced(p); frame(size, p); }}
              options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }, ...(rig ? [{ value: 'auto' as const, label: 'Auto', title: 'Room in front of where it faces' }] : [])]}
            />
          </PropertyRow>
        </>
      ) : (
        <Hint>Move the playhead into a shot it films to frame it</Hint>
      )}
      {rig && cam.kind === 'rig' && <RigAngle t={t} cam={cam} rig={rig} />}
    </>
  );
}

/** A framing's angle on its subject, what it is measured from, how it follows, its Dutch angle. */
function RigAngle({ t, cam, rig }: { t: Target; cam: RigCamera; rig: CameraRig }) {
  const edit = (patch: Partial<CameraRig>, key?: string) => editRig(t.store, cam.id, patch, key);
  const others = t.scene.figures.filter((f) => !f.hidden && f.id !== cam.subject);
  return (
    <>
      <div className="field">
        <span>Angle<Info text="Around the subject from its front (+ from its left), and from above." label="About angle" /></span>
        <div className="lens-row">
          <NumberField prefix="°" label="Angle around" value={rig.yaw} step={5} min={-180} max={180} digits={0} onChange={(v) => edit({ yaw: v }, `rig-yaw:${cam.id}`)} />
          <NumberField prefix="↑" label="Angle above" value={rig.pitch} step={2} min={-60} max={80} digits={0} onChange={(v) => edit({ pitch: v }, `rig-pitch:${cam.id}`)} />
        </div>
      </div>
      {cam.subject && others.length > 0 && (
        <PropertyRow label="From">
          <Select<string>
            label="Angle measured from"
            value={rig.toward ?? ''}
            onChange={(v) => edit({ toward: v || undefined })}
            options={[{ value: '', label: 'Its facing' }, ...others.map((f) => ({ value: f.id, label: `Towards ${f.name}` }))]}
          />
        </PropertyRow>
      )}
      <Toggle label="Turns with it" hint="Turns as the subject turns. Off: keeps the angle the subject faced at the camera's first shot" checked={!!rig.turn} onChange={(on) => edit({ turn: on })} />
      <PropertyRow label="Smoothing" info="Seconds the subject's motion is smoothed over: a steadier frame">
        <NumberField prefix="s" label="Smoothing" value={rig.smooth ?? 0} step={0.1} min={0} max={5} digits={1} onChange={(v) => edit({ smooth: v }, `rig-smooth:${cam.id}`)} />
      </PropertyRow>
      <PropertyRow label="Dutch" info="Tilted about the line of sight: unease, tension">
        <NumberField prefix="°" label="Dutch angle" value={rig.roll ?? 0} step={5} min={-90} max={90} digits={0} onChange={(v) => edit({ roll: v }, `rig-roll:${cam.id}`)} />
      </PropertyRow>
    </>
  );
}

/** Its lens: changed keeping the subject's size (the camera moves) or keeping the camera put (a zoom). */
export function LensPanel({ t }: { t: Target }) {
  const time = useStudio((s) => s.time);
  const [zoom, setZoom] = useState(false);
  const cam = t.camera!;
  const { rig, lens } = framingOf(t.store, cam, time);
  if (!lens) return <Hint>Move the playhead into a shot it films to set its lens</Hint>;
  const setLensTo = (mm: number, key?: string) => (rig ? editRig(t.store, cam.id, { lens: mm }) : setLens(t.store, mm, zoom ? 'place' : 'size', key, cam.id));
  return (
    <>
      <div className="field">
        <span>Lens</span>
        <div className="lens-row">
          <Select<string>
            label="Lens"
            value={LENSES.includes(lens) ? String(lens) : 'other'}
            onChange={(v) => { if (v !== 'other') setLensTo(Number(v)); }}
            options={[...LENSES.map((mm) => ({ value: String(mm), label: `${mm} mm` })), ...(LENSES.includes(lens) ? [] : [{ value: 'other', label: `${lens} mm` }])]}
          />
          <NumberField prefix="mm" label="Focal length" value={lens} step={1} min={8} max={400} digits={0} onChange={(v) => setLensTo(v, `lens:${cam.id}`)} />
        </div>
      </div>
      {!rig && <Toggle label="Zoom" hint="On: the camera stays put. Off: it moves to keep the subject's size, as with a dolly zoom" checked={zoom} onChange={setZoom} />}
    </>
  );
}

export const movesSummary = (t: Target) => { const cam = t.camera!; return cam.kind === 'path' ? 'Custom path' : cam.rig.move ? MOVE_NAMES[cam.rig.move.kind] : 'Holds'; };
export const movesInfo = (t: Target) => (t.camera!.kind === 'rig'
  ? 'It moves over each shot it films, from its framing at the shot\'s start, as it frames its subject every frame: the move holds when the blocking or the cut changes.'
  : 'On the canvas, drag a camera to move it (Shift: up and down) and its look point; double-click its path to add a point. Looking through it, frame the view and set a camera point from the timeline.');

/** The moves to pick from (#16): none, the kinds, or a custom path. */
const MOVES: { id: 'none' | MoveKind | 'path'; label: string; icon: LucideIcon; tip: string }[] = [
  { id: 'none', label: 'None', icon: Square, tip: 'Holds its framing' },
  { id: 'push', label: 'Push', icon: ArrowRightToLine, tip: 'Closer (or wider) over the shot' },
  { id: 'arc', label: 'Arc', icon: RotateCw, tip: 'Round its subject' },
  { id: 'crane', label: 'Crane', icon: ArrowUpFromLine, tip: 'Up (or down)' },
  { id: 'truck', label: 'Truck', icon: MoveHorizontal, tip: 'Sideways' },
  { id: 'pan', label: 'Pan', icon: ArrowLeftRight, tip: 'Turns to another figure, or by degrees' },
  { id: 'tilt', label: 'Tilt', icon: ArrowUpDown, tip: 'Tilts up (or down)' },
  { id: 'zoom', label: 'Zoom', icon: ZoomIn, tip: 'The lens changes; the camera stays' },
  { id: 'dolly', label: 'Dolly zoom', icon: Focus, tip: 'The lens changes, the subject keeps its size: the world behind it stretches' },
  { id: 'roll', label: 'Roll', icon: RotateCcw, tip: 'Turns about the line of sight' },
  { id: 'path', label: 'Path', icon: Spline, tip: 'A custom path of points, edited one by one (from a move: one way)' },
];

/** A move of a kind, as it starts out (how far, where to). */
function startMove(kind: MoveKind, rig: CameraRig | null): CameraMove {
  const lens = rig?.lens ?? 50;
  const closer = (size: ShotSize) => SHOT_SIZES[Math.min(SHOT_SIZES.length - 1, SHOT_SIZES.findIndex((x) => x.id === size) + 2)].id;
  switch (kind) {
    case 'push': return { kind, size: closer(rig?.size ?? 'fs') };
    case 'arc': return { kind, by: 90 };
    case 'crane': return { kind, by: 40 };
    case 'truck': return { kind, by: 1.5 };
    case 'pan': return { kind, by: 45 };
    case 'tilt': return { kind, by: 25 };
    case 'zoom': return { kind, by: Math.min(200, Math.round(lens * 2)) };
    case 'dolly': return { kind, by: lens >= 50 ? 24 : 85 };
    case 'roll': return { kind, by: 30 };
  }
}

/** How it moves over each shot it films (#16): a move from its framing, or a custom path. */
export function MovesPanel({ t }: { t: Target }) {
  const cam = t.camera!;
  const set = (patch: Parameters<typeof editCamera>[2]) => editCamera(t.store, cam.id, patch);
  const now = cam.kind === 'path' ? 'path' : cam.rig.move?.kind ?? 'none';
  const pick = (id: (typeof MOVES)[number]['id']) => {
    if (id === now) return;
    if (id === 'path') editAsPath(t.store, cam.id);
    else setCameraMove(t.store, cam.id, id === 'none' ? null : startMove(id, cam.kind === 'rig' ? cam.rig : null));
  };
  return (
    <>
      <div className="move-grid" role="radiogroup" aria-label="Camera move">
        {MOVES.map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={m.id === now} className={m.id === now ? 'on' : ''} data-tip={m.tip} onClick={() => pick(m.id)}>
            <m.icon size={15} strokeWidth={1.75} aria-hidden />
            <span>{m.label}</span>
          </button>
        ))}
      </div>
      {/* (The classic shots, ready-made: a framing and a move for this camera; a still scene is animated to film one.) */}
      <Menu
        label="Ready-made moves"
        className="btn subtle camera-presets"
        items={() => CAMERA_GROUPS.flatMap((g) => [{ group: g }, ...CAMERA_MOVES.filter((m) => m.group === g).map((m) => ({ label: m.name, onSelect: () => applyCameraMove(t.store, m.id, cam.id) }))])}
      >
        <Clapperboard size={14} aria-hidden /> Ready-made…
      </Menu>
      {cam.kind === 'rig' ? <MoveSettings t={t} cam={cam} /> : <PathSettings t={t} cam={cam} set={set} />}
      <Slider label="Hand-held" value={cam.shake ?? 0} min={0} max={1} step={0.05} display={(cam.shake ?? 0) > 0 ? `${Math.round((cam.shake ?? 0) * 100)}%` : 'Off'} onChange={(v) => set({ shake: v })} />
    </>
  );
}

/** A rig's move: how far and to what, its pace, and where it starts and ends (pictures of the shot). */
function MoveSettings({ t, cam }: { t: Target; cam: RigCamera }) {
  const m = cam.rig.move;
  if (!t.scene.animation) return <Hint>A move plays over a shot: animate the scene to film one</Hint>;
  if (!m) return null;
  const edit = (patch: Partial<CameraMove>, key?: string) => setCameraMove(t.store, cam.id, { ...m, ...patch }, key);
  const deg = (label: string) => (
    <PropertyRow label={label}>
      <NumberField prefix="°" label={`${MOVE_NAMES[m.kind]} by`} value={m.by ?? 0} step={5} min={-720} max={720} digits={0} onChange={(v) => edit({ by: v }, `move-by:${cam.id}`)} />
    </PropertyRow>
  );
  const lensTo = (
    <PropertyRow label="Ends at">
      <Select<string>
        label="The lens it ends at"
        value={String(m.by ?? cam.rig.lens)}
        onChange={(v) => edit({ by: Number(v) })}
        options={[...LENSES.map((mm) => ({ value: String(mm), label: `${mm} mm` })), ...(LENSES.includes(m.by ?? cam.rig.lens) ? [] : [{ value: String(m.by ?? cam.rig.lens), label: `${m.by ?? cam.rig.lens} mm` }])]}
      />
    </PropertyRow>
  );
  const people = t.scene.figures.filter((f) => !f.hidden && f.id !== cam.subject);
  return (
    <>
      {m.kind === 'arc' && deg('Round by')}
      {m.kind === 'crane' && deg('Up by')}
      {m.kind === 'tilt' && deg('Up by')}
      {m.kind === 'roll' && deg('Roll by')}
      {m.kind === 'truck' && (
        <PropertyRow label="Sideways">
          <NumberField prefix="m" label="Truck by" value={m.by ?? 0} step={0.25} min={-20} max={20} digits={2} onChange={(v) => edit({ by: v }, `move-by:${cam.id}`)} />
        </PropertyRow>
      )}
      {m.kind === 'pan' && (
        <>
          <PropertyRow label="To">
            <Select<string>
              label="Pan to"
              value={m.to ?? ''}
              onChange={(v) => edit({ to: v || undefined })}
              options={[{ value: '', label: 'By degrees' }, ...people.map((f) => ({ value: f.id, label: f.name }))]}
            />
          </PropertyRow>
          {!m.to && deg('By')}
        </>
      )}
      {(m.kind === 'zoom' || m.kind === 'dolly') && lensTo}
      <PropertyRow label={m.kind === 'push' ? 'Ends at' : 'Size at end'}>
        <Select<string>
          label="The size it ends at"
          value={m.size ?? ''}
          onChange={(v) => edit({ size: (v || undefined) as ShotSize | undefined })}
          options={[...(m.kind === 'push' ? [] : [{ value: '', label: 'The same' }]), ...SHOT_SIZES.map((x) => ({ value: x.id, label: `${x.short} · ${x.name}` }))]}
        />
      </PropertyRow>
      <PropertyRow label="Pace">
        <Segmented<'smooth' | 'even' | 'snap'>
          label="Pace"
          full
          value={m.pace ?? 'smooth'}
          onChange={(pace) => edit({ pace: pace === 'smooth' ? undefined : pace })}
          options={[{ value: 'smooth', label: 'Smooth', title: 'Eases in and out' }, { value: 'even', label: 'Even', title: 'At an even pace' }, { value: 'snap', label: 'Snap', title: 'Holds, then fast (a whip pan, a crash zoom)' }]}
        />
      </PropertyRow>
      <div className="field">
        <span>Wait, hold<Info text="Seconds it holds its framing before it moves, and where it ended after (within the shots it films)." label="About wait and hold" /></span>
        <div className="lens-row">
          <NumberField prefix="⇤" label="Wait before" value={m.wait ?? 0} step={0.1} min={0} max={60} digits={1} onChange={(v) => edit({ wait: v || undefined }, `move-wait:${cam.id}`)} />
          <NumberField prefix="⇥" label="Hold after" value={m.hold ?? 0} step={0.1} min={0} max={60} digits={1} onChange={(v) => edit({ hold: v || undefined }, `move-hold:${cam.id}`)} />
        </div>
      </div>
      <MoveEnds t={t} cam={cam} />
    </>
  );
}

/** The shot at the playhead (or the first it films) as it starts and ends: two small pictures; a click looks through it then. */
function MoveEnds({ t, cam }: { t: Target; cam: RigCamera }) {
  const time = useStudio((s) => s.time);
  const style = useProjectSettings().style;
  const films = filmsOf(t);
  const span = films.find((s) => time >= s.start && time < s.end) ?? films[0];
  if (!span) return <Hint>It films no shot yet: pick it for a shot to see its move</Hint>;
  const end = Math.max(span.start, span.end - 1 / (t.scene.animation?.fps ?? 24));
  return (
    <div className="move-ends">
      <ShotStill t={t} cam={cam} at={span.start} label="Start" style={style} />
      <ShotStill t={t} cam={cam} at={end} label="End" style={style} />
    </div>
  );
}

function ShotStill({ t, cam, at, label, style }: { t: Target; cam: RigCamera; at: number; label: string; style: Style }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const aspect = frameAspect();
  const [w, h] = [120, Math.round(120 / aspect)];
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    const id = requestAnimationFrame(() => ctx.drawImage(sharedRenderer().renderShot(sceneAt(t.scene, at, true), w, h, 1, { camera: viewOf(t.scene, cam, at, aspect), style }), 0, 0, w, h));
    return () => cancelAnimationFrame(id);
  }, [t.scene, cam, at, w, h, aspect, style]);
  return (
    <button type="button" className="move-end" data-tip={`Look through it at ${at.toFixed(2)} s`} onClick={() => { t.store.setTime(at); t.store.lookThrough({ camera: cam.id }); }}>
      <canvas ref={canvas} width={w} height={h} aria-hidden />
      <span>{label} · {at.toFixed(1)} s</span>
    </button>
  );
}

/** Where a camera's path is, what it looks at, how it moves, its points. */
function PathSettings({ t, cam, set }: { t: Target; cam: PathCamera; set(patch: Parameters<typeof editCamera>[2]): void }) {
  const time = useStudio((s) => s.time);
  return (
    <>
      <div className="field">
        <span>Path</span>
        <Segmented<PathCamera['anchor']>
          label="Camera path"
          full
          value={cam.anchor}
          onChange={(anchor) => set({ anchor })}
          options={[{ value: 'world', label: 'Fixed', title: 'Fixed in the scene' }, { value: 'subject', label: 'Rides along', title: 'Rides along with its subject' }]}
        />
      </div>
      <PropertyRow label="Aim">
        <Segmented<PathCamera['aim']>
          label="Looks at"
          full
          value={cam.aim}
          onChange={(aim) => set({ aim })}
          options={[{ value: 'subject', label: 'Subject' }, { value: 'point', label: 'Point', title: 'A point (its handle on the canvas)' }, { value: 'path', label: 'Ahead', title: 'Ahead along its path' }]}
        />
      </PropertyRow>
      <PropertyRow label="Shape">
        <Segmented<'smooth' | 'linear'>
          label="Path shape"
          full
          value={cam.ease ?? 'smooth'}
          onChange={(ease) => set({ ease })}
          options={[{ value: 'smooth', label: 'Curve', title: 'A smooth curve through its points' }, { value: 'linear', label: 'Straight', title: 'Straight lines between its points' }]}
        />
      </PropertyRow>
      <PropertyRow label="Pace">
        <Segmented<'points' | 'even'>
          label="Path pace"
          full
          value={cam.pace ?? 'points'}
          onChange={(pace) => set({ pace: pace === 'even' ? 'even' : undefined })}
          options={[{ value: 'points', label: 'By its points', title: 'As fast as its points\' times say' }, { value: 'even', label: 'Even', title: 'An even speed along its whole path' }]}
        />
      </PropertyRow>
      <Toggle label="Hand-held" hint="A slight shake" checked={(cam.shake ?? 0) > 0} onChange={(on) => set({ shake: on ? 0.5 : 0 })} />
      {cam.points.length > 0 && (
        <ul className="side-list camera-points" aria-label="Camera points">
          {cam.points.map((p) => (
            <li key={p.t}>
              <button type="button" className={Math.abs(p.t - time) < 0.02 ? 'on' : ''} onClick={() => t.store.setTime(p.t)}>
                <CameraIcon size={13} aria-hidden />
                <span className="side-list-name">{p.t.toFixed(2)} s{p.stop ? ' · stops' : ''}</span>
                <em>{Math.round(p.lens)} mm</em>
              </button>
              <IconButton icon={Trash2} label={`Delete the camera point at ${p.t.toFixed(2)} s`} className="row-delete" size={13} onClick={() => deleteCameraPoint(t.store, p.t, cam.id)} />
            </li>
          ))}
        </ul>
      )}
      {/* (Another point, at the playhead: the camera as it is then; moved there after, on the canvas or through it.) */}
      {t.scene.animation && (
        <button
          type="button"
          className="btn subtle camera-point-add"
          disabled={cam.points.some((p) => Math.abs(p.t - time) < 0.5 / t.scene.animation!.fps)}
          data-tip="The camera as it is now; then move it there (drag it, or look through it)"
          onClick={() => addCameraPoint(t.store, cam.id, time)}
        >
          <Plus size={14} aria-hidden /> A point at {time.toFixed(2)} s
        </button>
      )}
    </>
  );
}
