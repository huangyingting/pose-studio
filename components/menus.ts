import {
  BookmarkPlus, ClipboardCopy, Copy, Eye, EyeOff, Film, LayoutPanelTop, Pencil, PersonStanding, Scan, Scissors, Trash2, UserRound, Video,
} from 'lucide-react';
import {
  addFigure, addProp, addStandIn, addToBoard, deleteFigure, deleteProp, deleteScene, duplicateCurrentScene, duplicateFigure,
  duplicateProp, removeShotCut, savePose, setFigureHidden,
} from '@/lib/actions';
import { describeSpan } from '@/lib/prompt';
import { shotSpans } from '@/lib/shots';
import type { Store } from '@/lib/store';
import { PROP_KINDS, PROP_LABELS, type Vec3 } from '@/lib/types';
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
    '-',
    {
      label: 'Delete', icon: Trash2, shortcut: 'Del', danger: true, disabled: store.scene.figures.length <= 1,
      onSelect: () => { if (deleteFigure(store, id)) notifyUndo(`Deleted ${f.name}`); },
    },
  ];
}

export function propMenu(store: Store, id: string, { notifyUndo }: MenuUi): MenuItem[] {
  const p = store.scene.props.find((x) => x.id === id);
  if (!p) return [];
  return [
    { label: 'Rename', icon: Pencil, shortcut: 'F2', onSelect: () => renameInOutline(store, id) },
    { label: 'Duplicate', icon: Copy, shortcut: 'Ctrl D', onSelect: () => duplicateProp(store, id) },
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

/** Empty space on the canvas: add things where it was clicked. */
export function canvasMenu(store: Store, at: Vec3 | undefined, frameAll: () => void): MenuItem[] {
  const spot = at && ([Math.round(at[0] * 100) / 100, 0, Math.round(at[2] * 100) / 100] as Vec3);
  return [
    { label: 'Add figure', icon: PersonStanding, onSelect: () => addFigure(store, spot) },
    { label: 'Add stand-in', icon: UserRound, onSelect: () => addStandIn(store, spot) },
    { group: 'Add a prop' },
    ...PROP_KINDS.map((k): MenuItem => ({ label: PROP_LABELS[k], icon: PROP_ICONS[k], onSelect: () => addProp(store, k, spot) })),
    '-',
    { label: 'Frame all', icon: Scan, shortcut: 'F', onSelect: frameAll },
  ];
}
