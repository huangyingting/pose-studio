import type { ComponentType } from 'react';
import { Ban, Castle, Clapperboard, SunMedium, Film, Layers, PersonStanding, Trash2, UserRound, UsersRound, Video, type LucideIcon } from 'lucide-react';
import {
  applyCameraMove, applyMotion, applyPose, applyUpperBody, coverScene, deleteModel, deleteMotion, deletePose,
  applyLightingPreset, placeTemplate, setFigureModel, setSceneSet,
} from '@/lib/actions';
import { BUILT_IN, clipById, clipScene, hasClip } from '@/lib/assets';
import { fetchLibraryClip, libraryMotions } from '@/lib/librarymotions';
import { sceneAt } from '@/lib/evaluate';
import { insertClip } from '@/lib/track';
import type { Figure, Scene } from '@/lib/types';
import { CAMERA_GROUPS, CAMERA_MOVES } from '@/lib/cameras';
import { BUILT_IN_CHARACTERS, characterImage } from '@/lib/characters';
import { COVERAGES, castCoverage } from '@/lib/coverage';
import { newScene } from '@/lib/doc';
import { projectSettingsOf } from '@/lib/project';
import { MOTIONS, MOTION_GROUPS } from '@/lib/motions';
import { builtInPoses, withPose } from '@/lib/poses';
import { POSE_GROUPS } from '@/lib/presets';
import {
  cameraPreview, characterPreview, characterThumb, lightingPreview, lightingThumb, motionPreview, posePreview, poseThumb, setPreview, setThumb, templatePreview, templateThumb, type PreviewJob,
} from '@/lib/previews';
import { STAGINGS } from '@/lib/stagings';
import { SETS, SET_GROUPS } from '@/lib/sets';
import { LIGHTING_PRESETS, lightingName, lightingOf } from '@/lib/lighting';
import { shotSpans, spanAt } from '@/lib/shots';
import type { LibraryTab, Store } from '@/lib/store';
import { CameraBar, CharactersBar, MotionsBar, PosesBar, type BarProps } from './LibraryBars';
import type { DropTarget } from '../dragdrop';

/*
 * The library's items, category by category, as data: what each is called, where it is listed,
 * what using it does and how it looks. The Library panel lists them, its search (and the command
 * palette's) finds them, and a new category is one entry in LIBRARY_CATEGORIES.
 */

export interface LibraryUi {
  notify(text: string): void;
  notifyUndo(text: string): void;
  /** Something was used (closes the drawer on small screens, to show it). */
  onPick?(): void;
}

/** A thumbnail: drawn when the page is idle (and kept), or an image that comes with the app. */
export type Thumb = { key: string; make(): string } | { url: string };

export interface LibraryItem {
  key: string;
  tab: LibraryTab;
  /** The part of its category it is in (its own list region), and its group there. */
  part: string;
  group: string;
  name: string;
  icon: LucideIcon;
  /** A short note on its row (a length, how many people). */
  meta?: string;
  /** What using it does, under its hover preview (or as a tooltip, without one). */
  note?: string;
  /** What it is, in words (a pose's description), in its hover preview. */
  about?: string;
  /** Not usable now (nothing to use it on). */
  disabled?: boolean;
  /** In use (the character the figure is drawn as). */
  on?: boolean;
  run(): void;
  preview?(): PreviewJob;
  thumb?: Thumb;
  /** More it can do, as small buttons on its row. */
  actions?: { icon: LucideIcon; label: string; run(): void }[];
  /** Dropped on what it applies to (a figure, the floor, a shot), instead of on the selection. */
  drop?: DropTarget;
  /** What it would make of the selected figure, shown on the canvas while the pointer rests on it. */
  ghost?(): Scene | null;
}

export interface LibraryCategory {
  id: LibraryTab;
  label: string;
  icon: LucideIcon;
  /** Shown as a grid of thumbnails (what is looked for by its shape), or as rows. */
  grid?: boolean;
  items(store: Store, ui: LibraryUi): LibraryItem[];
  /** Above its items: what they apply to, and what adds to it. */
  Bar?: ComponentType<BarProps>;
}

/** A figure that can take poses, motions and characters (stand-ins cannot). */
const posableById = (store: Store, id: string) => store.scene.figures.find((f) => f.id === id && !f.proxy);

/** The selected figure, if it can take poses, motions and characters (stand-ins cannot). */
function posable(store: Store) {
  const { activeFigure, selection } = store.getState();
  // A prop, a camera, the light or several things selected: nothing for a figure's items to go on (one target at a time).
  if (selection?.kind === 'prop' || selection?.kind === 'camera' || selection?.kind === 'light' || selection?.kind === 'many') return null;
  const f = store.scene.figures.find((x) => x.id === activeFigure);
  return f && !f.proxy ? f : null;
}

const style = (store: Store) => projectSettingsOf(store.getState().library).style;

/** A figure alone in a scene, for a ghost on the canvas. */
const ghostOf = (f: Figure) => newScene('Ghost', [{ ...f, id: 'ghost' }]);
/** A figure as it is at the playhead. */
const atPlayhead = (store: Store, id: string) => (store.scene.animation ? sceneAt(store.scene, store.getState().time) : store.scene).figures.find((f) => f.id === id);

/** A figure doing a motion from the playhead, half-way through it (a motion's ghost). */
function motionGhost(store: Store, id: string, clipId: string) {
  const clip = clipById(clipId);
  const t = store.scene.animation ? store.getState().time : 0;
  const s = clip ? insertClip(store.scene, [id], clipId, t) : store.scene;
  if (s === store.scene) return null;
  const f = sceneAt(s, t + clip!.duration / 2).figures.find((x) => x.id === id);
  return f ? ghostOf(f) : null;
}

function poses(store: Store, ui: LibraryUi): LibraryItem[] {
  const figure = posable(store);
  const mine = store.getState().library.poses ?? [];
  const built = POSE_GROUPS.flatMap((g) => builtInPoses().filter((p) => p.group === g)).map((p) => ({ p, group: p.group as string, mine: false }));
  const one = [...built, ...mine.map((p) => ({ p, group: 'My poses', mine: true }))].map(({ p, group, mine: own }): LibraryItem => ({
    key: `pose:${p.id}`,
    tab: 'poses',
    part: 'Poses',
    group,
    name: p.name,
    about: p.description,
    icon: PersonStanding,
    disabled: !figure,
    run: () => { if (figure && applyPose(store, figure.id, p.id)) ui.onPick?.(); },
    drop: { figure: (id) => { const f = posableById(store, id); if (f) applyPose(store, f.id, p.id); } },
    preview: () => posePreview(p, style(store)),
    ghost: figure ? () => { const f = atPlayhead(store, figure.id); return f ? ghostOf(withPose(f, p)) : null; } : undefined,
    thumb: poseThumb(p),
    actions: own ? [{ icon: Trash2, label: `Delete my pose ${p.name}`, run: () => { deletePose(store, p.id); ui.notifyUndo(`Deleted “${p.name}”`); } }] : undefined,
  }));
  // Two people posed together (lib/stagings.ts): the selected figure and the one nearest it take it, figures added for the rest.
  const two = STAGINGS.filter((t) => t.people === 2).map((t): LibraryItem => ({
    key: `pose:pair:${t.id}`,
    tab: 'poses',
    part: 'Poses',
    group: 'Two people',
    name: t.name,
    about: t.description,
    icon: UsersRound,
    run: () => { if (placeTemplate(store, t.id, figure?.id ?? null)) ui.onPick?.(); },
    preview: () => templatePreview(t.id, t.build, style(store)),
    thumb: templateThumb(t.id, t.build),
  }));
  const at = one.findIndex((it) => it.group === 'My poses');
  return at < 0 ? [...one, ...two] : [...one.slice(0, at), ...two, ...one.slice(at)];
}

// A motion's length (building one solves IK, so do it once per motion).
const lengths = new Map<string, number>();
function motionLength(id: string) {
  if (!lengths.has(id)) lengths.set(id, MOTIONS.find((m) => m.id === id)?.build().animation?.duration ?? 0);
  return lengths.get(id)!;
}

function motions(store: Store, ui: LibraryUi): LibraryItem[] {
  const figure = posable(store);
  const give = (id: string) => { if (figure && applyMotion(store, figure.id, id)) ui.onPick?.(); };
  const built = MOTIONS.filter((m) => MOTION_GROUPS.includes(m.group)).map((m): LibraryItem => {
    return {
      key: `motion:${m.id}`,
      tab: 'motions',
      part: 'Motions',
      group: m.group,
      name: m.name,
      icon: Film,
      meta: `${motionLength(m.id).toFixed(1)} s`,
      disabled: !figure,
      run: () => give(m.id),
      drop: {
        figure: (id) => {
          const f = posableById(store, id);
          if (f) applyMotion(store, f.id, m.id);
        },
        length: m.travel ? undefined : motionLength(m.id),
      },
      preview: () => motionPreview(m.id, m.build, style(store)),
      ghost: !m.travel && figure ? () => motionGhost(store, figure.id, BUILT_IN + m.id) : undefined,
      // From the waist up, over what the figure is doing (waving while walking).
      actions: !m.travel && figure ? [{
        icon: Layers,
        label: `${m.name}: upper body only, over what ${figure.name} is doing`,
        run: () => { if (applyUpperBody(store, figure.id, m.id)) ui.onPick?.(); },
      }] : undefined,
    };
  });
  /** An imported clip's item (the Library's motion files, my motions): `load` brings it to hand first. */
  const clipItem = (m: { id: string; name: string; duration: number; group: string }, load: () => Promise<boolean>): LibraryItem => {
    const giveTo = (id: string) => void load().then((ok) => {
      const f = posableById(store, id);
      if (!ok) return ui.notify(`Could not load ${m.name}`);
      if (f) applyMotion(store, f.id, m.id);
    });
    return {
      key: `motion:${m.id}`,
      tab: 'motions',
      part: 'Motions',
      group: m.group,
      name: m.name,
      icon: Film,
      meta: `${m.duration.toFixed(1)} s`,
      disabled: !figure,
      run: () => { if (figure) { giveTo(figure.id); ui.onPick?.(); } },
      drop: { figure: giveTo, length: m.duration },
      preview: () => {
        void load();
        return { ...motionPreview(m.id, () => { const c = clipById(m.id); return c ? clipScene(c) : newScene(m.name); }, style(store)), ready: () => hasClip(m.id) };
      },
      ghost: figure ? () => (hasClip(m.id) ? motionGhost(store, figure.id, m.id) : (void load(), null)) : undefined,
    };
  };
  // The Library's motion files: each fetched the first time it is used or shown.
  const files = libraryMotions().map((m) => clipItem(m, () => fetchLibraryClip(m.id)));
  // (One person's each: an imported clip of several people is not offered.)
  const mine = (store.getState().library.clips ?? []).filter((m) => m.people.length <= 1).map((m): LibraryItem => ({
    ...clipItem({ ...m, group: 'My motions' }, () => Promise.resolve(hasClip(m.id))),
    actions: [{ icon: Trash2, label: `Delete my motion ${m.name}`, run: () => { deleteMotion(store, m.id); ui.notifyUndo(`Deleted “${m.name}”`); } }],
  }));
  return [...built, ...files, ...mine];
}

/** Sets the scene can be played in (lib/sets.ts): one at a time, or none. */
function sets(store: Store, ui: LibraryUi): LibraryItem[] {
  const now = store.scene.set;
  const none: LibraryItem = {
    key: 'set:none', tab: 'sets', part: 'Sets', group: 'Indoor', name: 'No set', icon: Ban, on: !now,
    note: 'The bare stage', run: () => { if (now) { setSceneSet(store, null); } },
  };
  const built = SET_GROUPS.flatMap((g) => SETS.filter((s) => s.group === g)).map((s): LibraryItem => ({
    key: `set:${s.id}`,
    tab: 'sets',
    part: 'Sets',
    group: s.group,
    name: s.name,
    meta: s.place,
    about: s.description,
    icon: Castle,
    on: now === s.id,
    run: () => { if (now !== s.id) { setSceneSet(store, s.id); ui.onPick?.(); } },
    preview: () => setPreview(s.id, style(store)),
    thumb: setThumb(s.id),
  }));
  return [none, ...built];
}

/** Lighting schemes: the scene's lights at once, placed round its people (the set's own lamps kept). */
function lighting(store: Store, ui: LibraryUi): LibraryItem[] {
  const now = lightingOf(store.scene);
  return LIGHTING_PRESETS.map((p): LibraryItem => ({
    key: `lighting:${p.id}`,
    tab: 'lighting',
    part: 'Lighting',
    group: 'Schemes',
    name: p.name,
    about: p.description,
    icon: SunMedium,
    on: lightingName(now) === p.name,
    run: () => { applyLightingPreset(store, p.id); ui.onPick?.(); },
    preview: () => lightingPreview(p.id, p.lighting),
    thumb: lightingThumb(p.id, p.lighting),
  }));
}

function characters(store: Store, ui: LibraryUi): LibraryItem[] {
  const figure = posable(store);
  // (`credit`: who made it and on what terms, as its file says: a VRM avatar's.)
  const item = (id: string | null, name: string, group: string, thumb: Thumb | undefined, own = false, credit?: string): LibraryItem => ({
    key: `character:${id ?? 'mannequin'}`,
    tab: 'characters',
    part: 'Characters',
    group,
    name,
    icon: UserRound,
    ...(credit ? { meta: credit } : {}),
    note: credit,
    disabled: !figure,
    on: !!figure && (figure.model ?? null) === id,
    run: () => { if (figure) setFigureModel(store, figure.id, id); },
    drop: { figure: (fid) => { const f = posableById(store, fid); if (f) setFigureModel(store, f.id, id); } },
    preview: id ? () => characterPreview(id, style(store)) : undefined,
    thumb,
    actions: id && own ? [{ icon: Trash2, label: `Delete my character ${name}`, run: () => { deleteModel(store, id); ui.notifyUndo(`Deleted “${name}”`); } }] : undefined,
  });
  return [
    item(null, 'Mannequin', 'Built in', characterThumb(null)),
    ...BUILT_IN_CHARACTERS.map((c) => item(c.id, c.name, 'Built in', { url: characterImage(c.id) }, false, c.credit)),
    ...(store.getState().library.models ?? []).map((m) => item(m.id, m.name, 'My characters', m.thumb ? { url: m.thumb } : undefined, true, m.credit)),
  ];
}

function camera(store: Store, ui: LibraryUi): LibraryItem[] {
  const scene = store.scene;
  const { selection, time, activeFigure } = store.getState();
  const a = scene.animation;
  const selected = a && selection?.kind === 'shot' ? shotSpans(a).find((sp) => sp.shot.id === selection.shot) : undefined;
  const span = selected ?? (a ? spanAt(a, time) : undefined);
  const cam = selection?.kind === 'camera' ? scene.cameras.find((c) => c.id === selection.camera) : undefined;
  const name = (id: string | undefined) => scene.figures.find((f) => f.id === id)?.name ?? '?';
  const coverage = COVERAGES.map((c): LibraryItem => {
    const cast = scene.coverage?.id === c.id ? scene.coverage.roles : castCoverage(scene, c, activeFigure ?? undefined);
    const who = cast ? c.roles.map((r) => `${r}: ${name(cast[r])}`).join(', ') : `needs ${c.roles.length} people`;
    return {
      key: `coverage:${c.id}`,
      tab: 'camera',
      part: 'Coverage',
      group: 'Whole scene',
      name: c.name,
      icon: Clapperboard,
      meta: scene.coverage?.id === c.id ? 'again' : who,
      note: `${c.description} (${who})`,
      disabled: !cast,
      run: () => {
        if (coverScene(store, c.id)) ui.onPick?.();
      },
    };
  });
  const moves = CAMERA_GROUPS.flatMap((g) => CAMERA_MOVES.filter((m) => m.group === g)).map((m): LibraryItem => ({
    key: `camera:${m.id}`,
    tab: 'camera',
    part: 'Camera moves',
    group: m.group,
    name: m.name,
    icon: Video,
    note: m.description,
    run: () => {
      if (!cam && span) store.setTime(span.start);
      applyCameraMove(store, m.id, cam?.id);
      ui.onPick?.();
    },
    drop: {
      shot: (id) => {
        const sp = scene.animation && shotSpans(scene.animation).find((x) => x.shot.id === id);
        if (!sp) return;
        store.setTime(sp.start);
        store.select({ kind: 'shot', shot: id });
        applyCameraMove(store, m.id);
      },
    },
    preview: () => cameraPreview(m, scene, style(store)),
  }));
  return [...coverage, ...moves];
}

export const LIBRARY_CATEGORIES: LibraryCategory[] = [
  // A cast, a set and what they do (and shoot presets: one filmed with a coverage).
  // Who a figure is drawn as.
  { id: 'characters', label: 'Characters', icon: UserRound, grid: true, items: characters, Bar: CharactersBar },
  { id: 'poses', label: 'Poses', icon: PersonStanding, grid: true, items: poses, Bar: PosesBar },
  // On the selected figure's track, at the playhead.
  { id: 'motions', label: 'Motions', icon: Film, items: motions, Bar: MotionsBar },
  // Where the scene is played: a set behind it.
  { id: 'sets', label: 'Sets', icon: Castle, grid: true, items: sets },
  // How the scene is lit, at once (each light itself in the outline and the inspector).
  { id: 'lighting', label: 'Lighting', icon: SunMedium, grid: true, items: lighting },
  // Coverage of the scene, and moves for a shot or a camera.
  { id: 'camera', label: 'Camera', icon: Video, items: camera, Bar: CameraBar },
];

/** The library's items whose names hold `query` (every category's, or one's). */
export function searchLibrary(store: Store, ui: LibraryUi, query: string, tab?: LibraryTab): LibraryItem[] {
  const q = query.trim().toLowerCase();
  return LIBRARY_CATEGORIES.filter((c) => !tab || c.id === tab).flatMap((c) => c.items(store, ui)).filter((it) => it.name.toLowerCase().includes(q));
}
