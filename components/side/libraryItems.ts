import type { ComponentType } from 'react';
import { Clapperboard, Film, Layers, LayoutTemplate, PersonStanding, Trash2, UserRound, UsersRound, Video, type LucideIcon } from 'lucide-react';
import {
  applyCameraMove, applyMotion, applyPose, applyUpperBody, coverScene, deleteModel, deleteMotion, deletePose, deleteShoot, deleteTemplate, motionProblem, nearestPartners,
  newShoot, placeTemplate, sceneFromTemplate, setFigureModel,
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
import { filmOf } from '@/lib/film';
import { MOTIONS, MOTION_GROUPS } from '@/lib/motions';
import { builtInPoses, withPose } from '@/lib/poses';
import { POSE_GROUPS } from '@/lib/presets';
import {
  cameraPreview, characterPreview, characterThumb, motionPreview, posePreview, poseThumb, templatePreview, templateThumb, type PreviewJob,
} from '@/lib/previews';
import { shotSpans, spanAt } from '@/lib/shots';
import type { LibraryTab, Store } from '@/lib/store';
import { SHOOT_PRESETS, TEMPLATE_GROUPS, shootsOf, templatesOf } from '@/lib/templates';
import { CameraBar, CharactersBar, MotionsBar, PosesBar, TemplatesBar, type BarProps } from './LibraryBars';
import type { DropTarget } from '../dragdrop';
import { placeOrAdd } from '../commands';
import { placingTemplate } from '../placing';

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

const style = (store: Store) => filmOf(store.getState().library).style;

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
  return [...built, ...mine.map((p) => ({ p, group: 'My poses', mine: true }))].map(({ p, group, mine: own }): LibraryItem => ({
    key: `pose:${p.id}`,
    tab: 'poses',
    part: 'Poses',
    group,
    name: p.name,
    icon: PersonStanding,
    note: figure ? `Click to put it on ${figure.name}` : undefined,
    disabled: !figure,
    run: () => { if (figure && applyPose(store, figure.id, p.id)) { ui.notifyUndo(`${figure.name}: ${p.name}`); ui.onPick?.(); } },
    drop: { figure: (id) => { const f = posableById(store, id); if (f && applyPose(store, f.id, p.id)) ui.notifyUndo(`${f.name}: ${p.name}`); } },
    preview: () => posePreview(p, style(store)),
    ghost: figure ? () => { const f = atPlayhead(store, figure.id); return f ? ghostOf(withPose(f, p)) : null; } : undefined,
    thumb: poseThumb(p),
    actions: own ? [{ icon: Trash2, label: `Delete my pose ${p.name}`, run: () => { deletePose(store, p.id); ui.notifyUndo(`Deleted “${p.name}”`); } }] : undefined,
  }));
}

// A motion's length (building one solves IK, so do it once per motion).
const lengths = new Map<string, number>();
function motionLength(id: string) {
  if (!lengths.has(id)) lengths.set(id, MOTIONS.find((m) => m.id === id)?.build().animation?.duration ?? 0);
  return lengths.get(id)!;
}

function motions(store: Store, ui: LibraryUi): LibraryItem[] {
  const figure = posable(store);
  const nameOf = (id: string) => store.scene.figures.find((f) => f.id === id)?.name ?? '';
  const give = (id: string, name: string) => { if (figure && applyMotion(store, figure.id, id)) { ui.notifyUndo(`${figure.name}: ${name}`); ui.onPick?.(); } };
  const built = MOTIONS.filter((m) => MOTION_GROUPS.includes(m.group)).map((m): LibraryItem => {
    const solo = m.people === 1;
    // One person's motion goes on the selected figure, several people's on it and the nearest.
    const partners = !solo && figure ? nearestPartners(store, figure.id, m.people - 1) : [];
    const together = !solo && figure && partners.length === m.people - 1;
    return {
      key: `motion:${m.id}`,
      tab: 'motions',
      part: 'Motions',
      group: m.group,
      name: m.name,
      icon: solo ? Film : UsersRound,
      meta: solo ? `${motionLength(m.id).toFixed(1)} s` : `${m.people} people`,
      note: solo
        ? (figure ? `Click to give it to ${figure.name}` : undefined)
        : together
          ? `Click to put it on ${figure.name} (leading) and ${partners.map(nameOf).join(', ')}, at the playhead`
          : `For ${m.people} people: select a figure with ${m.people - 1 === 1 ? 'another' : `${m.people - 1} others`} in the scene (or start from the ${m.name} template)`,
      disabled: solo ? !figure : !together,
      run: () => {
        if (solo) return give(m.id, m.name);
        if (!together) return;
        const why = motionProblem(store, m.id, [figure.id, ...partners]);
        if (why) return ui.notify(why);
        if (!applyMotion(store, figure.id, m.id, partners)) return;
        ui.notifyUndo(`${[figure.name, ...partners.map(nameOf)].join(' and ')}: ${m.name}`);
        ui.onPick?.();
      },
      drop: {
        figure: (id) => {
          const f = posableById(store, id);
          if (!f) return;
          const cast = solo ? [] : nearestPartners(store, f.id, m.people - 1);
          const why = solo ? null : cast.length < m.people - 1 ? `${m.name} needs ${m.people} people` : motionProblem(store, m.id, [f.id, ...cast]);
          if (why) return ui.notify(why);
          if (applyMotion(store, f.id, m.id, solo ? undefined : cast)) ui.notifyUndo(`${[f.name, ...cast.map(nameOf)].join(' and ')}: ${m.name}`);
        },
        length: m.travel ? undefined : motionLength(m.id),
      },
      preview: () => motionPreview(m.id, m.build, style(store)),
      ghost: solo && !m.travel && figure ? () => motionGhost(store, figure.id, BUILT_IN + m.id) : undefined,
      // From the waist up, over what the figure is doing (waving while walking).
      actions: solo && !m.travel && figure ? [{
        icon: Layers,
        label: `${m.name}: upper body only, over what ${figure.name} is doing`,
        run: () => { if (applyUpperBody(store, figure.id, m.id)) { ui.notifyUndo(`${figure.name}: ${m.name} (upper body)`); ui.onPick?.(); } },
      }] : undefined,
    };
  });
  /**
   * An imported clip's item (the Library's motion files, my motions): one of several people goes on
   * the figure and the nearest others, as the built-in ones; `load` brings it to hand first.
   */
  const clipItem = (m: { id: string; name: string; duration: number; people: number; group: string }, load: () => Promise<boolean>): LibraryItem => {
    const solo = m.people <= 1;
    const partners = !solo && figure ? nearestPartners(store, figure.id, m.people - 1) : [];
    const together = !solo && figure && partners.length === m.people - 1;
    const giveTo = (id: string) => void load().then((ok) => {
      const f = posableById(store, id);
      if (!ok) return ui.notify(`Could not load ${m.name}`);
      if (!f) return;
      const cast = solo ? [] : nearestPartners(store, f.id, m.people - 1);
      if (cast.length < m.people - 1) return ui.notify(`${m.name} needs ${m.people} people`);
      if (applyMotion(store, f.id, m.id, cast)) ui.notifyUndo(`${[f.name, ...cast.map(nameOf)].join(' and ')}: ${m.name}`);
    });
    return {
      key: `motion:${m.id}`,
      tab: 'motions',
      part: 'Motions',
      group: m.group,
      name: m.name,
      icon: solo ? Film : UsersRound,
      meta: solo ? `${m.duration.toFixed(1)} s` : `${m.people} people`,
      note: solo
        ? (figure ? `Click to give it to ${figure.name}` : undefined)
        : together
          ? `Click to put it on ${figure.name} (leading) and ${partners.map(nameOf).join(', ')}, at the playhead`
          : `For ${m.people} people: select a figure with ${m.people - 1 === 1 ? 'another' : `${m.people - 1} others`} in the scene`,
      disabled: solo ? !figure : !together,
      run: () => { if (figure && (solo || together)) { giveTo(figure.id); ui.onPick?.(); } },
      drop: { figure: giveTo, length: m.duration },
      preview: () => {
        void load();
        return { ...motionPreview(m.id, () => { const c = clipById(m.id); return c ? clipScene(c) : newScene(m.name); }, style(store)), ready: () => hasClip(m.id) };
      },
      ghost: solo && figure ? () => (hasClip(m.id) ? motionGhost(store, figure.id, m.id) : (void load(), null)) : undefined,
    };
  };
  // The Library's motion files: each fetched the first time it is used or shown.
  const files = libraryMotions().map((m) => clipItem(m, () => fetchLibraryClip(m.id)));
  const mine = (store.getState().library.clips ?? []).map((m): LibraryItem => ({
    ...clipItem({ ...m, people: m.people.length, group: 'My motions' }, () => Promise.resolve(hasClip(m.id))),
    actions: [{ icon: Trash2, label: `Delete my motion ${m.name}`, run: () => { deleteMotion(store, m.id); ui.notifyUndo(`Deleted “${m.name}”`); } }],
  }));
  return [...built, ...files, ...mine];
}

function characters(store: Store, ui: LibraryUi): LibraryItem[] {
  const figure = posable(store);
  const item = (id: string | null, name: string, group: string, thumb: Thumb | undefined, own = false): LibraryItem => ({
    key: `character:${id ?? 'mannequin'}`,
    tab: 'characters',
    part: 'Characters',
    group,
    name,
    icon: UserRound,
    note: figure ? `Click to draw ${figure.name} as ${name}` : undefined,
    disabled: !figure,
    on: !!figure && (figure.model ?? null) === id,
    run: () => {
      if (!figure) return;
      setFigureModel(store, figure.id, id);
      ui.notifyUndo(`${figure.name}: drawn as ${name}`);
    },
    drop: { figure: (fid) => { const f = posableById(store, fid); if (!f) return; setFigureModel(store, f.id, id); ui.notifyUndo(`${f.name}: drawn as ${name}`); } },
    preview: id ? () => characterPreview(id, style(store)) : undefined,
    thumb,
    actions: id && own ? [{ icon: Trash2, label: `Delete my character ${name}`, run: () => { deleteModel(store, id); ui.notifyUndo(`Deleted “${name}”`); } }] : undefined,
  });
  return [
    item(null, 'Mannequin', 'Built in', characterThumb(null)),
    ...BUILT_IN_CHARACTERS.map((c) => item(c.id, c.name, 'Built in', { url: characterImage(c.id) })),
    ...(store.getState().library.models ?? []).map((m) => item(m.id, m.name, 'My characters', m.thumb ? { url: m.thumb } : undefined, true)),
  ];
}

function templates(store: Store, ui: LibraryUi): LibraryItem[] {
  const library = store.getState().library;
  const figure = store.scene.figures.find((f) => f.id === store.getState().activeFigure);
  const all = templatesOf(library);
  const shoots = shootsOf(library).map((p): LibraryItem => {
    const t = all.find((x) => x.id === p.template)!;
    const how = COVERAGES.find((c) => c.id === p.coverage)!;
    const mine = !SHOOT_PRESETS.includes(p);
    return {
      key: `shoot:${p.id}`,
      tab: 'templates',
      part: 'Shoot presets',
      group: mine ? 'My presets' : 'Ready to shoot',
      name: p.name,
      icon: Clapperboard,
      meta: how.name,
      note: `${t.name}, filmed as ${how.name.toLowerCase()}: opens as a new scene, cameras and cuts made`,
      run: () => { if (newShoot(store, p.id)) { ui.notifyUndo(`${p.name}: ${t.name}, filmed as ${how.name.toLowerCase()}`); ui.onPick?.(); } },
      preview: () => templatePreview(t.id, t.build, style(store)),
      thumb: templateThumb(t.id, t.build),
      actions: mine ? [{ icon: Trash2, label: `Delete the shoot preset ${p.name}`, run: () => { deleteShoot(store, p.id); ui.notifyUndo(`Deleted the shoot preset ${p.name}`); } }] : undefined,
    };
  });
  const scenes = [...TEMPLATE_GROUPS, 'Mine' as const].flatMap((g) => all.filter((t) => t.group === g)).map((t): LibraryItem => ({
    key: `template:${t.id}`,
    tab: 'templates',
    part: 'Scene templates',
    group: t.group === 'Mine' ? 'My templates' : t.group,
    name: t.name,
    icon: t.people > 1 ? UsersRound : PersonStanding,
    meta: t.people === 1 ? '1 person' : `${t.people} people`,
    note: 'Click to open it as a new scene',
    run: () => { sceneFromTemplate(store, t.id); ui.onPick?.(); },
    drop: {
      figure: (id) => { if (placeTemplate(store, t.id, id)) ui.notifyUndo(`${t.name} put into ${store.scene.name}`); },
      floor: (at) => { if (placeTemplate(store, t.id, null, at)) ui.notifyUndo(`${t.name} put into ${store.scene.name}`); },
    },
    preview: () => templatePreview(t.id, t.build, style(store)),
    thumb: templateThumb(t.id, t.build),
    actions: [
      {
        icon: Layers,
        label: figure ? `Put ${t.name} into this scene, ${figure.name} in its first role` : `Put ${t.name} into this scene`,
        // Placed with the pointer: onto a figure (its first role) or the floor.
        run: () => placeOrAdd(placingTemplate(store, t.id), () => { if (placeTemplate(store, t.id)) ui.notifyUndo(`${t.name} put into ${store.scene.name}`); }),
      },
      ...(t.group === 'Mine' ? [{
        icon: Trash2,
        label: `Delete the template ${t.name}`,
        run: () => { const gone = deleteTemplate(store, t.id); ui.notifyUndo(`Deleted the template ${t.name}${gone.length ? ` and the shoot presets filming it (${gone.join(', ')})` : ''}`); },
      }] : []),
    ],
  }));
  return [...shoots, ...scenes];
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
      group: 'Coverage of the whole animation',
      name: c.name,
      icon: Clapperboard,
      meta: scene.coverage?.id === c.id ? 'again' : who,
      note: `${c.description} (${who})`,
      disabled: !cast,
      run: () => {
        if (!coverScene(store, c.id)) return;
        const n = store.scene;
        ui.notify(`${c.name}: ${n.cameras.filter((x) => x.made?.startsWith(`${c.id}:`)).length} cameras, ${shotSpans(n.animation!).length} shots`);
        ui.onPick?.();
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
      ui.notify(`${m.name}: ${m.description}`);
      ui.onPick?.();
    },
    drop: {
      shot: (id) => {
        const sp = scene.animation && shotSpans(scene.animation).find((x) => x.shot.id === id);
        if (!sp) return;
        store.setTime(sp.start);
        store.select({ kind: 'shot', shot: id });
        applyCameraMove(store, m.id);
        ui.notify(`${m.name}: ${m.description}`);
      },
    },
    preview: () => cameraPreview(m, scene, style(store)),
  }));
  return [...coverage, ...moves];
}

export const LIBRARY_CATEGORIES: LibraryCategory[] = [
  // A cast, a set and what they do (and shoot presets: one filmed with a coverage).
  { id: 'templates', label: 'Templates', icon: LayoutTemplate, items: templates, Bar: TemplatesBar },
  // Who a figure is drawn as.
  { id: 'characters', label: 'Characters', icon: UserRound, grid: true, items: characters, Bar: CharactersBar },
  { id: 'poses', label: 'Poses', icon: PersonStanding, grid: true, items: poses, Bar: PosesBar },
  // On the selected figure's track, at the playhead.
  { id: 'motions', label: 'Motions', icon: Film, items: motions, Bar: MotionsBar },
  // Coverage of the scene, and moves for a shot or a camera.
  { id: 'camera', label: 'Camera', icon: Video, items: camera, Bar: CameraBar },
];

/** The library's items whose names hold `query` (every category's, or one's). */
export function searchLibrary(store: Store, ui: LibraryUi, query: string, tab?: LibraryTab): LibraryItem[] {
  const q = query.trim().toLowerCase();
  return LIBRARY_CATEGORIES.filter((c) => !tab || c.id === tab).flatMap((c) => c.items(store, ui)).filter((it) => it.name.toLowerCase().includes(q));
}
