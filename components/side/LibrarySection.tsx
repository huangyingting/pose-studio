'use client';

import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BookmarkPlus, Clapperboard, Film, Layers, PersonStanding, Search, Trash2, Upload, UsersRound, Video } from 'lucide-react';
import {
  addModel, applyCameraMove, applyMotion, applyPose, applyUpperBody, coverScene, deleteModel, deleteMotion, deletePose, deleteTemplate, newShoot, placeTemplate, saveTemplate, sceneFromTemplate, nearestPartners, saveMotion, savePose, setFigureModel, startAnimation,
} from '@/lib/actions';
import { clipById, clipScene } from '@/lib/assets';
import { COVERAGES, castCoverage } from '@/lib/coverage';
import { SHOOT_PRESETS, TEMPLATE_GROUPS, templatesOf } from '@/lib/templates';
import { newScene } from '@/lib/doc';
import { MissingBones, importModel, type BoneMap } from '@/lib/model';
import { MOTIONS, MOTION_GROUPS } from '@/lib/motions';
import { POSE_GROUPS } from '@/lib/presets';
import { builtInPoses } from '@/lib/poses';
import { PREVIEW_SIZE, cameraPreview, motionPreview, posePreview, runPreview, templatePreview, type PreviewJob } from '@/lib/previews';
import { CAMERA_GROUPS, CAMERA_MOVES } from '@/lib/cameras';
import { shotSpans, spanAt } from '@/lib/shots';
import { styleDef } from '@/lib/styles';
import type { LibraryTab } from '@/lib/store';
import { useScene, useStore, useStudio } from '../store-context';
import BoneMapDialog from '../BoneMapDialog';
import { IconButton, Select } from '../ui';
import type { SectionProps } from './sections';

/**
 * Ready-made things to build a scene with, in groups. They apply to what is selected: a pose or a
 * motion to the selected figure, a scene template to the open scene (or as a new one), a camera
 * move to the selected (or current) shot. Resting the pointer on one shows what it does: the
 * pose, the motion playing, the move filming this scene.
 */
export default function LibrarySection(props: SectionProps) {
  const store = useStore();
  const tab = useStudio((s) => s.settings.libraryTab);
  const setTab = (libraryTab: LibraryTab) => store.setSettings({ libraryTab });
  const preview = usePreview();
  return (
    <div className="side-section">
      <div className="side-head">
        <h2>Library</h2>
        <div className="library-pick">
          <Select<LibraryTab>
            label="Library section"
            value={tab}
            onChange={(t) => { preview.hide(); setTab(t); }}
            options={[
              { value: 'templates', label: 'Templates', hint: 'A new scene, or into this one around the selected figure' },
              { value: 'characters', label: 'Characters', hint: 'Who the selected figure is drawn as' },
              { value: 'poses', label: 'Poses', hint: 'On the selected figure' },
              { value: 'motions', label: 'Motions', hint: 'On the selected figure, at the playhead' },
              { value: 'camera', label: 'Camera', hint: 'Coverage of the scene; a move for the selected shot' },
            ]}
          />
        </div>
      </div>
      {tab === 'poses' && <Poses {...props} preview={preview.bind} />}
      {tab === 'motions' && <Motions {...props} preview={preview.bind} />}
      {tab === 'characters' && <Characters {...props} />}
      {tab === 'templates' && <Templates {...props} preview={preview.bind} />}
      {tab === 'camera' && <CameraMoves {...props} preview={preview.bind} />}
      {preview.card}
    </div>
  );
}

/* ---------------- preview on hover ---------------- */

interface Shown { title: string; note?: string; frames: string[]; top: number; left: number }
type Bind = (title: string, note: string | undefined, job: () => PreviewJob) => {
  onPointerEnter(e: PointerEvent<HTMLElement>): void;
  onPointerLeave(): void;
  onFocus(e: FocusEvent<HTMLElement>): void;
  onBlur(): void;
  onPointerDown(): void;
  onKeyDown(e: KeyboardEvent<HTMLElement>): void;
};

/**
 * A card beside the panel showing what the item under the mouse (or keyboard focus) does. Not for
 * touch: a tap uses the item.
 */
function usePreview() {
  const style = useStudio((s) => s.settings.style);
  const [shown, setShown] = useState<Shown | null>(null);
  const timer = useRef(0);
  const stop = useRef<() => void>(() => {});
  const hide = () => {
    window.clearTimeout(timer.current);
    stop.current();
    setShown(null);
  };
  const show = (el: HTMLElement, title: string, note: string | undefined, job: () => PreviewJob) => {
    window.clearTimeout(timer.current);
    stop.current();
    // A short wait, so passing over the list does not start every item on the way.
    timer.current = window.setTimeout(() => {
      const row = el.getBoundingClientRect();
      const panel = el.closest('.side-panel')?.getBoundingClientRect() ?? row;
      const height = PREVIEW_SIZE.height + 64;
      setShown({ title, note, frames: [], left: panel.right + 8, top: Math.max(56, Math.min(window.innerHeight - height - 8, row.top - 40)) });
      // Frames arrive one by one: the card shows the first at once and plays as more come.
      stop.current = runPreview(job(), (frames) => setShown((s) => (s && s.title === title ? { ...s, frames } : s)));
    }, 160);
  };
  useEffect(() => () => {
    window.clearTimeout(timer.current);
    stop.current();
  }, []);
  const bind: Bind = (title, note, job) => ({
    onPointerEnter: (e) => { if (e.pointerType === 'mouse') show(e.currentTarget, title, note, job); },
    onPointerLeave: hide,
    onFocus: (e) => { if (e.currentTarget.matches(':focus-visible')) show(e.currentTarget, title, note, job); },
    onBlur: hide,
    // Used: the preview has done its job (and stops rendering).
    onPointerDown: hide,
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') hide(); },
  });
  const card = shown && createPortal(<PreviewCard shown={shown} background={styleDef(style).background} />, document.body);
  return { bind, hide, card };
}

function PreviewCard({ shown, background }: { shown: Shown; background: string }) {
  const [tick, setTick] = useState(0);
  const playing = shown.frames.length > 1;
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setTick((f) => f + 1), 1000 / 8);
    return () => window.clearInterval(id);
  }, [playing]);
  const src = shown.frames.length ? shown.frames[tick % shown.frames.length] : null;
  return (
    <div className="lib-preview" role="tooltip" style={{ left: shown.left, top: shown.top }}>
      {src ? (
        // Generated data: URLs, so next/image does not apply.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={PREVIEW_SIZE.width} height={PREVIEW_SIZE.height} style={{ background }} />
      ) : (
        <div className="lib-preview-wait" style={{ width: PREVIEW_SIZE.width, height: PREVIEW_SIZE.height, background }} />
      )}
      <strong>{shown.title}</strong>
      {shown.note && <span>{shown.note}</span>}
    </div>
  );
}

/* ---------------- lists ---------------- */

/** Who the library applies to, or what to select first. */
function Target({ children }: { children: ReactNode }) {
  return <p className="library-target">{children}</p>;
}

function Group({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <div className="lib-group">
      <h3 className="lib-group-head">{title}{count !== undefined && <span className="count">{count}</span>}</h3>
      <ul className="side-list library-list" aria-label={title}>{children}</ul>
    </div>
  );
}

function useActiveFigure() {
  const scene = useScene();
  const id = useStudio((s) => s.activeFigure);
  return scene.figures.find((f) => f.id === id) ?? null;
}

type Listed = SectionProps & { preview: Bind };

function Poses({ notifyUndo, onPick, preview }: Listed) {
  const store = useStore();
  const figure = useActiveFigure();
  const mine = useStudio((s) => s.library.poses) ?? [];
  const style = useStudio((s) => s.settings.style);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const match = (name: string) => !q || name.toLowerCase().includes(q);
  const usable = !!figure && !figure.proxy;
  const groups = [
    ...POSE_GROUPS.map((g) => ({ title: g as string, poses: builtInPoses().filter((p) => p.group === g && match(p.name)), mine: false })),
    { title: 'My poses', poses: mine.filter((p) => match(p.name)), mine: true },
  ].filter((g) => g.poses.length);

  return (
    <div className="side-scroll">
      <Target>
        {usable ? <>Click a pose to put it on <strong>{figure.name}</strong>.</> : figure?.proxy ? 'Stand-ins take postures, not poses: pick a figure.' : 'Select a figure to pose it.'}
      </Target>
      <div className="library-row">
        <label className="search">
          <Search size={14} aria-hidden />
          <input type="search" placeholder="Search poses" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search poses" />
        </label>
        <IconButton
          icon={BookmarkPlus}
          label={usable ? `Save ${figure.name}'s pose` : 'Save the selected figure’s pose'}
          disabled={!usable}
          onClick={() => {
            if (!figure) return;
            const saved = savePose(store, figure.id, `${store.scene.name} · ${figure.name}`);
            if (saved) notifyUndo(`Saved “${saved.name}” to the library`);
          }}
        />
      </div>
      <section aria-label="Poses">
        {groups.map((g) => (
          <Group key={g.title} title={g.title} count={g.poses.length}>
            {g.poses.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  aria-disabled={!usable}
                  onClick={() => { if (usable && applyPose(store, figure.id, p.id)) { notifyUndo(`${figure.name}: ${p.name}`); onPick?.(); } }}
                  {...preview(p.name, usable ? `Click to put it on ${figure.name}` : undefined, () => posePreview(p, style))}
                >
                  <PersonStanding size={14} aria-hidden />
                  <span className="side-list-name">{p.name}</span>
                </button>
                {g.mine && <IconButton icon={Trash2} label={`Delete my pose ${p.name}`} className="row-delete" size={13} onClick={() => { deletePose(store, p.id); notifyUndo(`Deleted “${p.name}”`); }} />}
              </li>
            ))}
          </Group>
        ))}
        {!groups.length && <p className="empty-note">No poses match “{query}”.</p>}
      </section>
    </div>
  );
}

// A motion's length (building one solves IK, so do it once per motion).
const lengths = new Map<string, number>();
function motionLength(id: string) {
  if (!lengths.has(id)) lengths.set(id, MOTIONS.find((m) => m.id === id)?.build().animation?.duration ?? 0);
  return lengths.get(id)!;
}

function Motions({ notify, notifyUndo, onPick, preview }: Listed) {
  const store = useStore();
  const figure = useActiveFigure();
  const mine = useStudio((s) => s.library.clips) ?? [];
  const style = useStudio((s) => s.settings.style);
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const usable = !!figure && !figure.proxy;
  const give = (id: string, name: string) => { if (usable && applyMotion(store, figure.id, id)) { notifyUndo(`${figure.name}: ${name}`); onPick?.(); } };
  /** From the waist up, over what the figure is doing (waving while walking). */
  const over = (id: string, name: string) => { if (usable && applyUpperBody(store, figure.id, id)) { notifyUndo(`${figure.name}: ${name} (upper body)`); onPick?.(); } };
  const scene = useScene();
  const nameOf = (id: string) => scene.figures.find((f) => f.id === id)?.name ?? '';
  /** Who joins the selected figure in a motion of several people (the nearest), or null if too few. */
  const partnersFor = (people: number) => {
    if (!usable) return null;
    const p = nearestPartners(store, figure.id, people - 1);
    return p.length === people - 1 ? p : null;
  };
  const together = (id: string, name: string, partners: string[]) => {
    if (!usable || !applyMotion(store, figure.id, id, partners)) return;
    notifyUndo(`${[figure.name, ...partners.map(nameOf)].join(' and ')}: ${name}`);
    onPick?.();
  };

  const [mapping, setMapping] = useState<{ file: File; err: MissingBones } | null>(null);
  const read = async (file: File, map?: BoneMap) => {
    setReading(true);
    try {
      // The loaders are only fetched when a motion is imported.
      const { importMotion } = await import('@/lib/importmotion');
      const motion = await importMotion(file.name, await file.arrayBuffer(), map);
      saveMotion(store, motion);
      notifyUndo(`Imported “${motion.name}” (${motion.duration.toFixed(1)} s) to My motions`);
    } catch (e) {
      if (e instanceof MissingBones && !map) setMapping({ file, err: e });
      else notify(`Could not import ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="side-scroll">
      <Target>
        {usable ? <>Motions go on <strong>{figure.name}</strong>&apos;s track at the playhead (with the nearest figures for two people).</> : 'Select a figure to give it a motion.'}
      </Target>
      <div className="library-row">
        <button
          type="button"
          className="btn subtle library-import"
          disabled={reading}
          onClick={() => fileRef.current?.click()}
          data-tip="A BVH, FBX or glTF/GLB animation (motion capture, Mixamo…), fitted to the mannequin"
        >
          <Upload size={14} aria-hidden /> {reading ? 'Importing…' : 'Import motion…'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".bvh,.fbx,.glb,.gltf"
          hidden
          aria-label="Motion file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void read(f);
            e.target.value = '';
          }}
        />
      </div>
      <section aria-label="Motions">
        {MOTION_GROUPS.map((g) => {
          const motions = MOTIONS.filter((m) => m.group === g);
          return (
            <Group key={g} title={g} count={motions.length}>
              {motions.map((m) => {
                // One person's motion goes on the selected figure, several people's on it and the nearest.
                const solo = m.people === 1;
                const partners = m.people > 1 ? partnersFor(m.people) : null;
                const note = solo
                  ? (usable ? `Click to give it to ${figure.name}` : undefined)
                  : partners && figure
                    ? `Click to put it on ${figure.name} (leading) and ${partners.map(nameOf).join(', ')}, at the playhead`
                    : `For ${m.people} people: select a figure with ${m.people - 1 === 1 ? 'another' : `${m.people - 1} others`} in the scene (or start from the ${m.name} template)`;
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      aria-disabled={solo ? !usable : !partners}
                      onClick={() => (solo ? give(m.id, m.name) : partners && together(m.id, m.name, partners))}
                      {...preview(m.name, note, () => motionPreview(m.id, m.build, style))}
                    >
                      {solo ? <Film size={14} aria-hidden /> : <UsersRound size={14} aria-hidden />}
                      <span className="side-list-name">{m.name}</span>
                      <em>{solo ? `${motionLength(m.id).toFixed(1)} s` : `${m.people} people`}</em>
                    </button>
                    {solo && !m.travel && usable && <IconButton icon={Layers} label={`${m.name}: upper body only, over what ${figure.name} is doing`} className="row-action" size={13} onClick={() => over(m.id, m.name)} />}
                  </li>
                );
              })}
            </Group>
          );
        })}
        {mapping && <BoneMapDialog file={mapping.file.name} names={mapping.err.names} found={mapping.err.found} onClose={() => setMapping(null)} onDone={(map) => { setMapping(null); void read(mapping.file, map); }} />}
        {mine.length > 0 && (
          <Group title="My motions" count={mine.length}>
            {mine.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  aria-disabled={!usable}
                  onClick={() => give(m.id, m.name)}
                  {...preview(m.name, usable ? `Click to give it to ${figure.name}` : undefined, () => motionPreview(m.id, () => { const c = clipById(m.id); return c ? clipScene(c) : newScene(m.name); }, style))}
                >
                  <Film size={14} aria-hidden />
                  <span className="side-list-name">{m.name}</span>
                  <em>{m.duration.toFixed(1)} s</em>
                </button>
                <IconButton icon={Trash2} label={`Delete my motion ${m.name}`} className="row-delete" size={13} onClick={() => { deleteMotion(store, m.id); notifyUndo(`Deleted “${m.name}”`); }} />
              </li>
            ))}
          </Group>
        )}
      </section>
    </div>
  );
}

/** Characters to draw figures as: the mannequin, or one imported (a glTF/GLB or FBX with a skeleton). */
function Characters({ notify, notifyUndo }: SectionProps) {
  const store = useStore();
  const figure = useActiveFigure();
  const mine = useStudio((s) => s.library.models) ?? [];
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [mapping, setMapping] = useState<{ file: File; err: MissingBones } | null>(null);
  const usable = !!figure && !figure.proxy;
  const give = (id: string | null, name: string) => {
    if (!usable) return;
    setFigureModel(store, figure.id, id);
    notifyUndo(`${figure.name}: drawn as ${name}`);
  };
  const read = async (file: File, map?: BoneMap) => {
    setReading(true);
    try {
      const info = await importModel(file.name, await file.arrayBuffer(), map);
      addModel(store, info);
      if (usable) setFigureModel(store, figure.id, info.id);
      notifyUndo(`Imported “${info.name}”${usable ? `: ${figure.name} is drawn as it` : ''}`);
    } catch (e) {
      if (e instanceof MissingBones && !map) setMapping({ file, err: e });
      else notify(`Could not import ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setReading(false);
    }
  };
  const row = (id: string | null, name: string) => (
    <li key={id ?? 'mannequin'}>
      <button type="button" aria-disabled={!usable} aria-pressed={usable ? (figure.model ?? null) === id : undefined} onClick={() => give(id, name)}>
        <PersonStanding size={14} aria-hidden />
        <span className="side-list-name">{name}</span>
        {usable && (figure.model ?? null) === id && <em>{figure.name}</em>}
      </button>
      {id && <IconButton icon={Trash2} label={`Delete my character ${name}`} className="row-delete" size={13} onClick={() => { deleteModel(store, id); notifyUndo(`Deleted “${name}”`); }} />}
    </li>
  );
  return (
    <div className="side-scroll">
      <Target>
        {usable ? <>Click a character to draw <strong>{figure.name}</strong> as it.</> : 'Select a figure to draw it as a character.'}
      </Target>
      <div className="library-row">
        <button
          type="button"
          className="btn subtle library-import"
          disabled={reading}
          onClick={() => fileRef.current?.click()}
          data-tip="A character with a skeleton (glTF/GLB or FBX: Mixamo, VRoid…), posed and animated like the mannequin"
        >
          <Upload size={14} aria-hidden /> {reading ? 'Importing…' : 'Import character…'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".glb,.gltf,.fbx"
          hidden
          aria-label="Character file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void read(f);
            e.target.value = '';
          }}
        />
      </div>
      <section aria-label="Characters">
        <Group title="Built in" count={1}>{row(null, 'Mannequin')}</Group>
        {mine.length > 0 && <Group title="My characters" count={mine.length}>{mine.map((m) => row(m.id, m.name))}</Group>}
      </section>
      {mapping && <BoneMapDialog file={mapping.file.name} names={mapping.err.names} found={mapping.err.found} onClose={() => setMapping(null)} onDone={(map) => { setMapping(null); void read(mapping.file, map); }} />}
    </div>
  );
}

/** Scene templates: each as a new scene, or into the open one (its first role on the selected figure). */
function Templates({ notifyUndo, onPick, preview }: Listed) {
  const store = useStore();
  const scene = useScene();
  const figure = useActiveFigure();
  const library = useStudio((s) => s.library);
  const style = useStudio((s) => s.settings.style);
  const all = templatesOf(library);
  const groups = [...TEMPLATE_GROUPS, 'Mine'] as const;
  const save = () => {
    const name = window.prompt('Template name', scene.name)?.trim();
    if (!name) return;
    saveTemplate(store, name);
    notifyUndo(`Saved “${name}” to My templates`);
  };
  return (
    <div className="side-scroll">
      <Target>
        A template is a cast, a set and what they do, without cameras; a shoot preset films one with a coverage. Click to open it as a new scene;
        {' '}{figure ? <>or put it here, its first role on <strong>{figure.name}</strong>.</> : 'or select a figure to put it into this scene around it.'}
      </Target>
      <div className="library-row">
        <button type="button" className="btn subtle library-import" onClick={save} data-tip="Its cast, set, actions and light, without cameras or cuts">
          <BookmarkPlus size={14} aria-hidden /> Save scene as template…
        </button>
      </div>
      <section aria-label="Shoot presets">
        <Group title="Ready to shoot" count={SHOOT_PRESETS.length}>
          {SHOOT_PRESETS.map((p) => {
            const t = all.find((x) => x.id === p.template)!;
            const how = COVERAGES.find((c) => c.id === p.coverage)!;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => { if (newShoot(store, p.id)) { notifyUndo(`${p.name}: ${t.name}, filmed as ${how.name.toLowerCase()}`); onPick?.(); } }}
                  {...preview(p.name, `${t.name}, filmed as ${how.name.toLowerCase()}: opens as a new scene, cameras and cuts made`, () => templatePreview(t.id, t.build, style))}
                >
                  <Clapperboard size={14} aria-hidden />
                  <span className="side-list-name">{p.name}</span>
                  <em>{how.name}</em>
                </button>
              </li>
            );
          })}
        </Group>
      </section>
      <section aria-label="Scene templates">
        {groups.map((g) => {
          const list = all.filter((t) => t.group === g);
          if (!list.length) return null;
          return (
            <Group key={g} title={g === 'Mine' ? 'My templates' : g} count={list.length}>
              {list.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => { sceneFromTemplate(store, t.id); onPick?.(); }}
                    {...preview(t.name, 'Click to open it as a new scene', () => templatePreview(t.id, t.build, style))}
                  >
                    {t.people > 1 ? <UsersRound size={14} aria-hidden /> : <PersonStanding size={14} aria-hidden />}
                    <span className="side-list-name">{t.name}</span>
                    <em>{t.people === 1 ? '1 person' : `${t.people} people`}</em>
                  </button>
                  <IconButton
                    icon={Layers}
                    label={figure ? `Put ${t.name} into this scene, ${figure.name} in its first role` : `Put ${t.name} into this scene`}
                    className="row-action"
                    size={13}
                    onClick={() => { if (placeTemplate(store, t.id)) { notifyUndo(`${t.name} put into ${scene.name}`); onPick?.(); } }}
                  />
                  {g === 'Mine' && <IconButton icon={Trash2} label={`Delete the template ${t.name}`} className="row-action" size={13} onClick={() => { deleteTemplate(store, t.id); notifyUndo(`Deleted the template ${t.name}`); }} />}
                </li>
              ))}
            </Group>
          );
        })}
      </section>
    </div>
  );
}

function CameraMoves({ notify, onPick, preview }: Listed) {
  const store = useStore();
  const scene = useScene();
  const style = useStudio((s) => s.settings.style);
  const selection = useStudio((s) => s.selection);
  const time = useStudio((s) => s.time);
  const a = scene.animation;
  const selected = a && selection?.kind === 'shot' ? shotSpans(a).find((sp) => sp.shot.id === selection.shot) : undefined;
  const span = selected ?? (a ? spanAt(a, time) : undefined);
  const active = useStudio((s) => s.activeFigure);
  const name = (id: string | undefined) => scene.figures.find((f) => f.id === id)?.name ?? '?';
  return (
    <div className="side-scroll">
      <section aria-label="Coverage">
        <Group title="Coverage of the whole animation">
          {COVERAGES.map((c) => {
            const cast = scene.coverage?.id === c.id ? scene.coverage.roles : castCoverage(scene, c, active ?? undefined);
            const who = cast ? c.roles.map((r) => `${r}: ${name(cast[r])}`).join(', ') : `needs ${c.roles.length} people`;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={!cast}
                  data-tip={`${c.description} (${who})`}
                  onClick={() => {
                    if (!coverScene(store, c.id)) return;
                    const n = store.scene;
                    notify(`${c.name}: ${n.cameras.filter((x) => x.made?.startsWith(`${c.id}:`)).length} cameras, ${shotSpans(n.animation!).length} shots`);
                    onPick?.();
                  }}
                >
                  <Clapperboard size={14} aria-hidden />
                  <span className="side-list-name">{c.name}</span>
                  <em>{scene.coverage?.id === c.id ? 'again' : who}</em>
                </button>
              </li>
            );
          })}
        </Group>
      </section>
      <Target>
        {span ? <>Moves apply to <strong>{span.shot.name}</strong>{a && shotSpans(a).length > 1 ? ' (select another shot in the Scene outline)' : ''}.</> : 'A move animates this still scene and films it.'}
      </Target>
      <section aria-label="Camera moves">
        {CAMERA_GROUPS.map((g) => (
          <Group key={g} title={g}>
            {CAMERA_MOVES.filter((m) => m.group === g).map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (!store.scene.animation) startAnimation(store);
                    if (span) store.setTime(span.start);
                    applyCameraMove(store, m.id);
                    notify(`${m.name}: ${m.description}`);
                    onPick?.();
                  }}
                  {...preview(m.name, m.description, () => cameraPreview(m, scene, style))}
                >
                  <Video size={14} aria-hidden />
                  <span className="side-list-name">{m.name}</span>
                </button>
              </li>
            ))}
          </Group>
        ))}
      </section>
    </div>
  );
}
