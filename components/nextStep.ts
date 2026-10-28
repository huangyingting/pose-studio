import { newFigure } from '@/lib/doc';
import { setDirector } from '@/lib/actions';
import { shotSpans } from '@/lib/shots';
import type { Store } from '@/lib/store';
import { App, command, type Ctx } from './commands';

/*
 * The next step the header bar's hint suggests for where the scene is: one at a time, each with
 * its command as a button. A suggestion acted on, or dismissed, does not come back for that scene
 * (kept on this device).
 */

export interface Suggestion {
  id: string;
  text: string;
  actions: { label: string; run(): void }[];
}

const KEY = 'pose-studio-next-steps';

function doneFor(scene: string): string[] {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string[]>)[scene] ?? [];
  } catch {
    return [];
  }
}

/** A suggestion acted on or dismissed: not shown again for this scene. */
export function stepDone(scene: string, id: string) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string[]>;
    if (all[scene]?.includes(id)) return;
    all[scene] = [...(all[scene] ?? []), id];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
}

const DEFAULT_BONES = JSON.stringify(newFigure().bones);

/** What to suggest next in the open scene, if anything. */
export function nextStep(store: Store): Suggestion | null {
  const scene = store.scene;
  const done = doneFor(scene.id);
  const c: Ctx = { store };
  const act = (id: string, label: string, ctx: Ctx = c) => ({ label, run: () => { stepDone(scene.id, step); command(id).run!(ctx); } });
  const figures = scene.figures.filter((f) => !f.hidden);
  const a = scene.animation;
  const acting = !!a?.actions.some((x) => x.source.kind !== 'keys');
  const people = figures.filter((f) => !f.proxy);
  const lead = people.find((f) => f.id === store.getState().activeFigure) ?? people[0];
  let step = '';
  const offer = (id: string, s: Omit<Suggestion, 'id'>): Suggestion | null => (done.includes(id) ? null : ((step = id), { id, ...s }));

  const out =
    (!figures.length && offer('figure', { text: 'Empty scene: add a figure', actions: [] }))
    || (lead && !acting && people.length === 1 && JSON.stringify(lead.bones) === DEFAULT_BONES
      && offer('pose', { text: `Pose ${lead.name}: drag a part, or pick a pose`, actions: [] }))
    || (lead && !acting && offer('act', { text: `Give ${lead.name} something to do`, actions: [] }))
    || (a && acting && shotSpans(a).length === 1 && offer('cut', { text: 'One shot so far: let the director film it, or cut it', actions: [] }))
    || (a && shotSpans(a).length > 1 && new Set(shotSpans(a).map((sp) => sp.shot.camera)).size === 1
      && offer('camera', { text: 'All shots use one camera: give shot 2 its own', actions: [] }))
    || (a && acting && offer('check', { text: 'Check for sliding feet, collisions and pops', actions: [] }))
    || null;
  if (!out) return null;
  // The buttons: the commands that take the step.
  if (out.id === 'figure') out.actions = [act('floor.figure', 'Add a figure')];
  if (out.id === 'pose') out.actions = [act('figure.pose', 'Poses', { store, figure: lead!.id })];
  if (out.id === 'act') out.actions = [act('figure.walk', 'Walk to…', { store, figure: lead!.id }), act('figure.motion', 'Motions', { store, figure: lead!.id })];
  if (out.id === 'cut') {
    // (The director: in the style that suits who is in it.)
    const style = people.length > 1 ? 'dialogue' : 'follow';
    out.actions = [
      ...(scene.coverage?.live ? [] : [{ label: 'Director', run: () => {
        // (Filming the one the hint is about: who is active is who the director follows.)
        if (lead) store.setActiveFigure(lead.id);
        if (setDirector(store, style)) stepDone(scene.id, 'cut');
        else App().notify('The director could not film this scene');
      } }]),
      act('timeline.cut', 'Cut here'),
    ];
  }
  if (out.id === 'camera') {
    const second = shotSpans(a!)[1];
    const newCamera = command('shot.camera').items!({ store, shot: second.shot.id }).at(-1)!;
    out.actions = [{ label: 'New camera', run: () => { stepDone(scene.id, 'camera'); store.select({ kind: 'shot', shot: second.shot.id }); newCamera.run(); } }];
  }
  if (out.id === 'check') out.actions = [act('timeline.check', 'Check')];
  return out;
}
