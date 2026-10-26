import {
  ArrowDownToLine, ArrowLeftRight, ArrowUpFromDot, ChevronsDown, Goal, BookmarkPlus, ClipboardCopy, Footprints, Hand, MoveUpRight, RefreshCw, RotateCw, Send, Spline, Wind, Copy, Eye, EyeOff, Film, LayoutPanelTop, Pencil, PersonStanding, Scan, Scissors, Trash2, UserRound, Video,
} from 'lucide-react';
import {
  addFigure, addProp, addStandIn, addToBoard, copyMotion, deleteFigure, deleteProp, deleteScene, duplicateCurrentScene, duplicateFigure,
  dribbleProp, duplicateProp, holdProp, removeShotCut, savePose, setFigureHidden, setGaze, setJumpHeight, setTravel, throwProp, travelTo,
} from '@/lib/actions';
import { HOLDABLE } from '@/lib/hold';
import { describeSpan } from '@/lib/prompt';
import { shotSpans } from '@/lib/shots';
import type { Store } from '@/lib/store';
import { HANDHELD, PROP_KINDS, PROP_LABELS, type Figure, type PoseKey, type Travel, type Vec3 } from '@/lib/types';
import { JUMP_PREP, chainAt, jumpHeight } from '@/lib/locomotion';
import { PROP_ICONS } from './icons';
import { startRename } from './rename';
import type { MenuItem, Notify } from './ui';

/*
 * The right-click menus, one per kind of thing. The same menu opens wherever the thing is shown
 * (the canvas, the scene outline), so each action has one definition.
 */

export type MenuUi = { notify: Notify; notifyUndo(text: string): void };

/** Rename in the scene outline (opening it if another section is showing). */
export function renameInOutline(store: Store, id: string) {
  if (store.getState().settings.side !== 'scene') store.setSettings({ side: 'scene' });
  startRename(id);
}

export function figureMenu(store: Store, id: string, { notifyUndo }: MenuUi): MenuItem[] {
  const f = store.scene.figures.find((x) => x.id === id);
  if (!f) return [];
  const library = (libraryTab: 'poses' | 'motions') => () => {
    store.select({ kind: 'figure', figure: id });
    store.setSettings({ side: 'library', libraryTab });
  };
  return [
    { label: 'Rename', icon: Pencil, shortcut: 'F2', onSelect: () => renameInOutline(store, id) },
    { label: 'Duplicate', icon: Copy, shortcut: 'Ctrl D', onSelect: () => duplicateFigure(store, id) },
    { label: f.hidden ? 'Show' : 'Hide', icon: f.hidden ? Eye : EyeOff, onSelect: () => setFigureHidden(store, id, !f.hidden) },
    ...(f.proxy ? [] : [
      '-' as const,
      { label: 'Choose a pose…', icon: PersonStanding, onSelect: library('poses') },
      { label: 'Choose a motion…', icon: Film, onSelect: library('motions') },
      {
        label: 'Save pose to library', icon: BookmarkPlus, onSelect: () => {
          const saved = savePose(store, id, `${store.scene.name} · ${f.name}`);
          if (saved) notifyUndo(`Saved “${saved.name}” to the library`);
        },
      },
    ]),
    ...(f.proxy ? [] : gazeItems(store, f)),
    // The same moves for someone else (a crowd, a synchronised routine).
    ...(store.scene.animation?.keys.some((k) => k.poses[id]) && store.scene.figures.length > 1 ? [
      { group: 'Copy moves to' } as MenuItem,
      ...store.scene.figures.filter((x) => x.id !== id).map((x): MenuItem => ({
        label: x.name, icon: Copy, onSelect: () => { if (copyMotion(store, id, x.id)) notifyUndo(`${x.name} now moves like ${f.name}`); },
      })),
    ] : []),
    '-',
    {
      label: 'Delete', icon: Trash2, shortcut: 'Del', danger: true, disabled: store.scene.figures.length <= 1,
      onSelect: () => { if (deleteFigure(store, id)) notifyUndo(`Deleted ${f.name}`); },
    },
  ];
}

/** Where a figure keeps its eyes: nobody, another figure, or a prop. */
function gazeItems(store: Store, f: Figure): MenuItem[] {
  const others = store.scene.figures.filter((x) => x.id !== f.id && !x.hidden);
  if (!others.length && !store.scene.props.length) return [];
  const on = f.gaze;
  return [
    { group: 'Eyes on' },
    { label: 'Free (as posed)', icon: Eye, checked: !on, onSelect: () => setGaze(store, f.id, null) },
    ...others.map((x): MenuItem => ({ label: x.name, icon: Eye, checked: !!on && 'figure' in on && on.figure === x.id, onSelect: () => setGaze(store, f.id, { figure: x.id }) })),
    ...store.scene.props.map((p): MenuItem => ({ label: p.name, icon: Eye, checked: !!on && 'prop' in on && on.prop === p.id, onSelect: () => setGaze(store, f.id, { prop: p.id }) })),
  ];
}

export function propMenu(store: Store, id: string, { notifyUndo }: MenuUi): MenuItem[] {
  const p = store.scene.props.find((x) => x.id === id);
  if (!p) return [];
  // Hold it in the active figure's hand (or the holder's other hand), or let it go.
  const figure = store.scene.figures.find((f) => f.id === p.hold?.figure) ?? store.figure;
  const hands: MenuItem[] = HOLDABLE.includes(p.kind) && figure
    ? (['R', 'L'] as const)
      .filter((hand) => !(p.hold?.figure === figure.id && p.hold.hand === hand))
      .map((hand) => ({
        label: `In ${figure.name}'s ${hand === 'L' ? 'left' : 'right'} hand`,
        icon: Hand,
        onSelect: () => holdProp(store, id, { figure: figure.id, hand }),
      }))
    : [];
  return [
    { label: 'Rename', icon: Pencil, shortcut: 'F2', onSelect: () => renameInOutline(store, id) },
    { label: 'Duplicate', icon: Copy, shortcut: 'Ctrl D', onSelect: () => duplicateProp(store, id) },
    ...(hands.length || p.hold ? ['-' as const] : []),
    ...hands,
    ...(p.hold ? [{ label: store.scene.animation ? 'Let go (it falls)' : 'Let go', icon: ArrowDownToLine, onSelect: () => holdProp(store, id, null) }] : []),
    // Thrown to someone else, caught in a hand; tossed up and caught; a ball dribbled or shot.
    ...(p.hold ? store.scene.figures.filter((x) => x.id !== p.hold!.figure).flatMap((x) => (['R', 'L'] as const).map((hand): MenuItem => ({
      label: `Throw to ${x.name}'s ${hand === 'L' ? 'left' : 'right'} hand`, icon: Send, onSelect: () => throwProp(store, id, { figure: x.id, hand }),
    }))) : []),
    ...(p.hold ? [{ label: 'Toss up and catch', icon: ArrowUpFromDot, onSelect: () => throwProp(store, id, { figure: p.hold!.figure, hand: p.hold!.hand }) }] : []),
    ...(p.hold && p.kind === 'sphere' ? [
      { label: 'Dribble (2 s)', icon: ChevronsDown, onSelect: () => dribbleProp(store, id) },
      ...store.scene.props.filter((x) => x.kind === 'hoop').map((x): MenuItem => ({ label: `Shoot at ${x.name}`, icon: Goal, onSelect: () => throwProp(store, id, { hoop: x.id }) })),
    ] : []),
    '-',
    { label: 'Delete', icon: Trash2, shortcut: 'Del', danger: true, onSelect: () => { deleteProp(store, id); notifyUndo(`Deleted ${p.name}`); } },
  ];
}

export function shotMenu(store: Store, id: string, { notify, notifyUndo }: MenuUi): MenuItem[] {
  const a = store.scene.animation;
  const span = a && shotSpans(a).find((sp) => sp.shot.id === id);
  if (!span) return [];
  return [
    { label: 'Rename', icon: Pencil, shortcut: 'F2', onSelect: () => renameInOutline(store, id) },
    {
      label: 'Choose a camera move…', icon: Video, onSelect: () => {
        store.setTime(span.start);
        store.select({ kind: 'shot', shot: id });
        store.setSettings({ side: 'library', libraryTab: 'camera' });
      },
    },
    {
      label: 'Copy description', icon: ClipboardCopy, onSelect: () => {
        const text = describeSpan(store.scene, span);
        navigator.clipboard?.writeText(text).then(() => notify('Shot description copied (for AI video tools)'), () => notify(text));
      },
    },
    ...(span.index > 0 ? [
      '-' as const,
      { label: 'Remove cut', icon: Scissors, shortcut: 'Del', danger: true, onSelect: () => { removeShotCut(store, id); notifyUndo(`Removed the cut before ${span.shot.name}`); } },
    ] : []),
  ];
}

/** A scene in the scene picker. */
export function sceneMenu(store: Store, index: number, { notifyUndo }: Pick<MenuUi, 'notifyUndo'>): MenuItem[] {
  const { library } = store.getState();
  const s = library.scenes[index];
  if (!s) return [];
  return [
    {
      label: 'Rename', icon: Pencil, onSelect: () => {
        store.setSceneIndex(index);
        const input = document.querySelector<HTMLInputElement>('.scene-name');
        input?.focus();
        input?.select();
      },
    },
    { label: 'Duplicate', icon: Copy, onSelect: () => duplicateCurrentScene(store, index) },
    { label: 'Add to storyboard', icon: LayoutPanelTop, onSelect: () => { addToBoard(store, s.id); notifyUndo(`Added “${s.name}” to the storyboard (B)`); } },
    '-',
    {
      label: 'Delete', icon: Trash2, danger: true, disabled: library.scenes.length <= 1,
      onSelect: () => { if (deleteScene(store, index)) notifyUndo(`Deleted “${s.name}”`); },
    },
  ];
}

/**
 * How a figure gets to its key at time t (from its previous key): glide as keyed, walk, run or
 * jump; facing; and for a jump its height and turns in the air.
 */
export function travelMenu(store: Store, figureId: string, t: number): MenuItem[] {
  const a = store.scene.animation;
  const pose = a?.keys.find((k) => Math.abs(k.t - t) < 0.5 / a.fps)?.poses[figureId];
  if (!a || !pose) return [];
  const kind = pose.travel ?? null;
  const keep = { strafe: pose.strafe, spin: pose.spin, flip: pose.flip };
  const set = (k: Travel | null, patch: Partial<PoseKey> = {}) => setTravel(store, figureId, t, k, { ...keep, ...patch });
  const items: MenuItem[] = [
    { group: 'Getting here' },
    { label: 'Glide (as keyed)', icon: Spline, checked: !kind, onSelect: () => set(null) },
    { label: 'Walk', icon: Footprints, checked: kind === 'walk', onSelect: () => set('walk') },
    { label: 'Run', icon: Wind, checked: kind === 'run', onSelect: () => set('run') },
    { label: 'Jump', icon: MoveUpRight, checked: kind === 'jump', onSelect: () => set('jump') },
  ];
  if (kind === 'walk' || kind === 'run') {
    items.push('-', {
      label: 'Keep facing (side steps, backing up)', icon: ArrowLeftRight, checked: !!pose.strafe,
      onSelect: () => set(kind, { strafe: !pose.strafe }),
    });
  }
  if (kind === 'jump') {
    const c = chainAt(a, figureId, t - 1e-3);
    const flight = c ? Math.max(0, c.t1 - c.t0 - 2 * JUMP_PREP) : 0;
    const now = jumpHeight(flight);
    const near = (h: number) => Math.abs(now - h) < 0.06;
    items.push({ group: `Height · ${now.toFixed(2)} m` });
    for (const [label, h] of [['Low (0.3 m)', 0.3], ['Medium (0.5 m)', 0.5], ['High (0.8 m)', 0.8], ['Very high (1.2 m)', 1.2]] as const) {
      items.push({ label, checked: near(h), onSelect: () => setJumpHeight(store, figureId, t, h) });
    }
    items.push({ group: 'In the air' });
    for (const [label, spin] of [['No turn', 0], ['Half turn', 0.5], ['Full turn', 1], ['Two turns', 2]] as const) {
      items.push({ label, icon: RotateCw, checked: (pose.spin ?? 0) === spin, onSelect: () => set('jump', { spin }) });
    }
    for (const [label, flip] of [['No flip', 0], ['Front flip', 1], ['Back flip', -1]] as const) {
      items.push({ label, icon: RefreshCw, checked: (pose.flip ?? 0) === flip, onSelect: () => set('jump', { flip }) });
    }
  }
  return items;
}

/** Empty space on the canvas: move the selected figure there, or add things there. */
export function canvasMenu(store: Store, at: Vec3 | undefined, frameAll: () => void): MenuItem[] {
  const spot = at && ([Math.round(at[0] * 100) / 100, 0, Math.round(at[2] * 100) / 100] as Vec3);
  const f = store.figure;
  const go = (kind: Travel, opts: { strafe?: boolean } = {}) => () => { if (f && spot) travelTo(store, f.id, [spot[0], spot[2]], kind, opts); };
  // What the selected figure holds right now can be thrown here.
  const throws: MenuItem[] = f && spot
    ? store.scene.props.filter((p) => p.hold?.figure === f.id).map((p) => ({
      label: `Throw ${p.name} here`, icon: Send, onSelect: () => throwProp(store, p.id, { at: [spot[0], spot[2]] }),
    }))
    : [];
  const moves: MenuItem[] = f && spot ? [
    { group: `Move ${f.name} here` },
    { label: 'Walk here', icon: Footprints, onSelect: go('walk') },
    { label: 'Run here', icon: Wind, onSelect: go('run') },
    { label: 'Jump here', icon: MoveUpRight, onSelect: go('jump') },
    { label: 'Step here, keeping facing', icon: ArrowLeftRight, onSelect: go('walk', { strafe: true }) },
    ...throws,
    '-',
  ] : [];
  return [
    ...moves,
    { label: 'Add figure', icon: PersonStanding, onSelect: () => addFigure(store, spot) },
    { label: 'Add stand-in', icon: UserRound, onSelect: () => addStandIn(store, spot) },
    { group: 'Add a prop' },
    ...PROP_KINDS.filter((k) => !HANDHELD.includes(k)).map((k): MenuItem => ({ label: PROP_LABELS[k], icon: PROP_ICONS[k], onSelect: () => addProp(store, k, spot) })),
    '-',
    { label: 'Frame all', icon: Scan, shortcut: 'F', onSelect: frameAll },
  ];
}
