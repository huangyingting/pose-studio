import { cameraFrom, newScene, nextName, uid } from '../doc';
import { snapTime, newAnimation } from '../animation';
import { BUILT_IN } from '../assets';
import { coverageById } from '../coverage';
import { templatesOf, shootsOf, putTemplate, asTemplate } from '../templates';
import { clipInfo } from '../clip';
import { saveClips } from '../assetstore';
import { fitted, addUpper } from '../track';
import { bodyFor } from '../model';
import { MOTIONS, HANDLING } from '../motions';
import { allPoses, withPose, poseFromFigure } from '../poses';
import { withCamera, angleAt } from '../cameras';
import { updateShot } from '../shots';
import type { Store } from '../store';
import type { Scene, Figure, ShootPreset, Vec3, Clip, ModelInfo } from '../types';
import { cover, setDirector } from './cameras';
import { addFigures } from './figures';
import { startAnimation } from './motion';
import { addScene, appendScenes } from './scenes';

/* The storyboard, the Library's assets applied to the scene, and scene templates (lib/templates.ts). */

/** Put a scene in the story or leave it out of it (the storyboard and its exports). */
export function setInStory(store: Store, sceneId: string, inStory: boolean) {
  const put = (s: Scene): Scene => {
    if (!inStory) return { ...s, offStory: true };
    const { offStory: _, ...rest } = s;
    void _;
    return rest;
  };
  store.commit((lib) => ({ ...lib, scenes: lib.scenes.map((s) => (s.id !== sceneId ? s : put(s))) }));
}

/** How long a still scene stays on screen in the story. */
export function setHold(store: Store, sceneId: string, hold: number) {
  store.commit((lib) => ({ ...lib, scenes: lib.scenes.map((s) => (s.id === sceneId ? { ...s, hold: Math.min(60, Math.max(0.2, hold)) } : s)) }), `hold:${sceneId}`);
}

/** What happens in a shot (`shot`) of any scene of the project, or in a still scene. */
export function setCaption(store: Store, sceneId: string, shot: string | null, caption: string) {
  const text = caption.slice(0, 500);
  store.commit((lib) => ({
    ...lib,
    scenes: lib.scenes.map((s) => {
      if (s.id !== sceneId) return s;
      if (shot && s.animation) return { ...s, animation: updateShot(s.animation, shot, { caption: text || undefined }) };
      const { caption: _old, ...rest } = s;
      void _old;
      return text ? { ...rest, caption: text } : rest;
    }),
  }), `caption:${sceneId}:${shot}`);
}
/** Put a library pose on a figure (it keeps its place and facing; keyed when animated). */
export function applyPose(store: Store, figureId: string, poseId: string) {
  const pose = allPoses(store.getState().library).find((p) => p.id === poseId);
  if (!pose) return false;
  store.updateFigure(figureId, (f) => (f.proxy ? f : withPose(f, pose)), '');
  return true;
}

/**
 * People posed from a photo, with a "Photo camera" looking as the photo did (straight on): in a
 * new scene, or (`figure`) the first on that figure, the others beside it as they stood in the
 * photo, as a pose from the library is applied (keyed at the playhead), in one undo step.
 */
export function applyPhotoPose(store: Store, figures: Figure[], figure?: string) {
  const photo = cameraFrom({ yaw: 0, pitch: 0, fov: 30 }, 'Photo camera');
  if (!figure) {
    appendScenes(store, [{ ...newScene('From photo', figures), cameras: [photo] }]);
    return;
  }
  const on = store.scene.figures.find((f) => f.id === figure);
  if (!on || on.proxy) return;
  const [first, ...rest] = figures;
  const [dx, dz] = [on.position[0] - first.position[0], on.position[2] - first.position[2]];
  store.group(() => {
    store.updateFigure(figure, (f) => ({ ...f, bones: first.bones }));
    store.updateScene((s) => {
      const had = s.cameras.find((c) => c.name === photo.name);
      return withCamera(s, had ? { ...photo, id: had.id } : photo);
    });
    if (rest.length) addFigures(store, rest.map((f) => ({ ...f, position: [f.position[0] + dx, f.position[1], f.position[2] + dz] })));
  });
}

/** Save a figure's pose to the library; returns the saved pose. */
export function savePose(store: Store, figureId: string, name: string) {
  const f = store.scene.figures.find((x) => x.id === figureId);
  if (!f) return null;
  const pose = poseFromFigure(f, name, angleAt(store.scene, store.getState().time));
  store.commit((lib) => ({ ...lib, poses: [...(lib.poses ?? []), pose] }));
  return pose;
}

export function deletePose(store: Store, id: string) {
  store.commit((lib) => {
    const poses = (lib.poses ?? []).filter((p) => p.id !== id);
    const { poses: _old, ...rest } = lib;
    void _old;
    return poses.length ? { ...rest, poses } : rest;
  });
}
/** A new scene from a template, opened. */
export function sceneFromTemplate(store: Store, id: string) {
  const t = templatesOf(store.getState().library).find((x) => x.id === id);
  if (!t) return false;
  addScene(store, t.build());
  return true;
}

/**
 * A new scene animated from the start (#14): empty, a template, or a shoot preset (a template
 * and how to film it), `length` seconds long, filmed by the director (the preset's way, else one
 * that suits who is in it). Whether it was made.
 */
export function startAnimatedScene(store: Store, what: { template?: string; shoot?: string }, length: number): boolean {
  return store.group(() => {
    // (A shoot preset: its template, filmed its way if it can be, else as suits who is in it.)
    const preset = what.shoot ? shootsOf(store.getState().library).find((x) => x.id === what.shoot) : undefined;
    if (what.shoot) {
      if (!preset || !sceneFromTemplate(store, preset.template)) return false;
      store.updateScene((s) => ({ ...s, name: preset.name }));
    } else if (what.template) {
      if (!sceneFromTemplate(store, what.template)) return false;
    } else addScene(store);
    if (!store.scene.animation) startAnimation(store, length);
    store.updateScene((s) => fitted(s, length));
    const people = store.scene.figures.filter((f) => !f.hidden && !f.proxy).length;
    const fallback = people > 1 ? 'dialogue' : 'follow';
    if (!setDirector(store, preset?.coverage ?? fallback, preset && presetCast(store, preset))) setDirector(store, fallback);
    dropIdleCamera(store);
    store.setTime(0);
    return true;
  });
}

/** A shoot preset (lib/templates.ts): its template as a new scene, filmed with its coverage. */
export function newShoot(store: Store, id: string) {
  return store.group(() => shoot(store, id));
}

function shoot(store: Store, id: string) {
  const p = shootsOf(store.getState().library).find((x) => x.id === id);
  const t = p && templatesOf(store.getState().library).find((x) => x.id === p.template);
  if (!p || !t) return false;
  addScene(store, { ...t.build(), name: p.name });
  if (!store.scene.animation) startAnimation(store, p.duration ?? 6);
  const done = !!cover(store, p.coverage, presetCast(store, p));
  if (done) dropIdleCamera(store);
  return done;
}

/** A new animated scene's cameras are the coverage's: the camera the scene came with, filming none of it, goes. */
function dropIdleCamera(store: Store) {
  store.updateScene((s) => {
    const shots = s.animation?.shots ?? [];
    if (shots.some((x) => !x.camera)) return s;
    const kept = s.cameras.filter((c) => c.made || shots.some((x) => x.camera === c.id));
    return kept.length && kept.length < s.cameras.length ? { ...s, cameras: kept } : s;
  }, '');
}

/** Who plays a shoot preset's coverage's roles in the scene just made from its template (its cast, if it says). */
function presetCast(store: Store, p: ShootPreset): Record<string, string> | undefined {
  const roles = coverageById(p.coverage)?.roles;
  const figures = store.scene.figures;
  if (!p.cast || !roles || p.cast.some((i) => !figures[i])) return undefined;
  return Object.fromEntries(roles.map((r, i) => [r, figures[p.cast![i]].id]));
}

/**
 * Put a template into the open scene, at the playhead: its first role taken by the active figure
 * (where it stands, facing its way), the next by the figures nearest it, new figures for the rest.
 * The figures it brings in or casts, by role.
 */
export function placeTemplate(store: Store, id: string, lead: string | null | undefined = store.getState().activeFigure, at?: Vec3, yaw = 0): string[] | null {
  const t = templatesOf(store.getState().library).find((x) => x.id === id);
  if (!t) return null;
  const built = t.build();
  const cast = lead && store.scene.figures.some((f) => f.id === lead) ? [lead, ...nearestPartners(store, lead, built.figures.length - 1)] : [];
  const before = new Set(store.scene.figures.map((f) => f.id));
  const t0 = store.scene.animation ? snapTime(store.scene.animation, store.getState().time) : 0;
  store.updateScene((s) => putTemplate(s, built, cast, t0, at, yaw));
  return [...cast, ...store.scene.figures.filter((f) => !before.has(f.id)).map((f) => f.id)];
}

/** Save the open scene as a template in the library (its cast, set, actions and light). */
export function saveTemplate(store: Store, name: string) {
  const t = asTemplate(store.scene, name.trim().slice(0, 80) || store.scene.name);
  store.commit((lib) => ({ ...lib, templates: [...(lib.templates ?? []), t] }));
  return t;
}

/** Delete one of my templates, and my shoot presets that film it (their names). */
export function deleteTemplate(store: Store, id: string): string[] {
  const gone = (store.getState().library.shoots ?? []).filter((p) => p.template === id).map((p) => p.name);
  store.commit((lib) => {
    const templates = (lib.templates ?? []).filter((t) => t.id !== id);
    const shoots = (lib.shoots ?? []).filter((p) => p.template !== id);
    const { templates: _t, shoots: _s, ...rest } = lib;
    void [_t, _s];
    return { ...rest, ...(templates.length ? { templates } : {}), ...(shoots.length ? { shoots } : {}) };
  });
  return gone;
}

/** Keep a shoot preset of my own: a template filmed with a coverage (and, for a still template, for how long). */
export function saveShoot(store: Store, p: Omit<ShootPreset, 'id'>): ShootPreset {
  const preset: ShootPreset = { ...p, id: uid('shoot'), name: p.name.trim().slice(0, 80) || 'Shoot' };
  store.commit((lib) => ({ ...lib, shoots: [...(lib.shoots ?? []), preset] }));
  return preset;
}

/** The open scene, filmed with a coverage, kept as a template and a shoot preset filming it so, in one step. */
export function saveAsShoot(store: Store, name: string): ShootPreset | null {
  const s = store.scene;
  if (!s.coverage) return null;
  const coverage = s.coverage.id;
  return store.group(() => {
    const t = saveTemplate(store, name);
    return saveShoot(store, { name, template: t.id, coverage, ...(s.animation ? {} : { duration: 6 }) });
  });
}

export function deleteShoot(store: Store, id: string) {
  store.commit((lib) => {
    const shoots = (lib.shoots ?? []).filter((p) => p.id !== id);
    const { shoots: _old, ...rest } = lib;
    void _old;
    return shoots.length ? { ...rest, shoots } : rest;
  });
}

/** Keep an imported motion in the library (My motions): listed there, its frames kept as an asset. */
export function saveMotion(store: Store, clip: Clip) {
  void saveClips([clip]);
  store.commit((lib) => ({ ...lib, clips: [...(lib.clips ?? []), clipInfo(clip)] }));
}

/** Imported motions brought in from a library file: listed (those not listed yet), their frames kept. */
export function addMotions(store: Store, clips: Clip[]) {
  if (!clips.length) return;
  void saveClips(clips);
  store.commit((lib) => {
    const have = new Set((lib.clips ?? []).map((c) => c.id));
    return { ...lib, clips: [...(lib.clips ?? []), ...clips.filter((c) => !have.has(c.id)).map(clipInfo)] };
  });
}

/** Keep an imported character in the library (its file is already kept: lib/model.ts importModel). */
export function addModel(store: Store, info: ModelInfo) {
  store.commit((lib) => ({ ...lib, models: [...(lib.models ?? []), info] }));
}

export function deleteModel(store: Store, id: string) {
  store.commit((lib) => {
    const models = (lib.models ?? []).filter((m) => m.id !== id);
    const { models: _old, ...rest } = lib;
    void _old;
    return models.length ? { ...rest, models } : rest;
  });
}

/** Draw a figure as a character (null: the mannequin), the mannequin under it fitted to the character's build. */
export function setFigureModel(store: Store, figureId: string, model: string | null) {
  store.updateFigure(figureId, (f) => {
    const { model: _old, ...rest } = f;
    void _old;
    if (!model) return rest;
    return { ...rest, model, body: bodyFor(f, model) };
  });
}

export function deleteMotion(store: Store, id: string) {
  store.commit((lib) => {
    const clips = (lib.clips ?? []).filter((m) => m.id !== id);
    const { clips: _old, ...rest } = lib;
    void _old;
    return clips.length ? { ...rest, clips } : rest;
  });
}

/** The figures nearest to one (posable ones, shown), nearest first: the cast of a template around it. */
function nearestPartners(store: Store, figureId: string, count: number) {
  const f = store.scene.figures.find((x) => x.id === figureId);
  if (!f) return [];
  return store.scene.figures
    .filter((x) => x.id !== figureId && !x.proxy && !x.hidden)
    .sort((p, q) => Math.hypot(p.position[0] - f.position[0], p.position[2] - f.position[2]) - Math.hypot(q.position[0] - f.position[0], q.position[2] - f.position[2]))
    .slice(0, count)
    .map((x) => x.id);
}

/**
 * Play a motion from the waist up over what a figure is doing at the playhead (waving while
 * walking): an upper-body action. False if it cannot (a walk).
 */
export function applyUpperBody(store: Store, figureId: string, motionId: string) {
  const mine = store.getState().library.clips?.some((c) => c.id === motionId);
  // (A motion from the Library, or one of those prop menus put on, as carrying.)
  const motion = [...MOTIONS, ...HANDLING].find((m) => m.id === motionId);
  if (!mine && (!motion || motion.travel)) return false;
  if (!store.scene.animation) store.updateScene((s) => ({ ...s, animation: { ...newAnimation(s, 2), loop: false } }), '');
  const animation = addUpper(store.scene, figureId, mine ? motionId : BUILT_IN + motionId, store.getState().time);
  if (!animation) return false;
  store.updateScene((s) => ({ ...s, animation }));
  return true;
}

/**
 * A keyed block kept in the Library (My motions) as a motion of its own, to give to any figure: its
 * keys from where it starts, made on its figure's proportions. Returns its name.
 */
export function saveKeysAsMotion(store: Store, id: string): string | null {
  const act = store.scene.animation?.actions.find((x) => x.id === id);
  const f = act && store.scene.figures.find((x) => x.id === act.roles[0].figure);
  if (!act || !f || act.source.kind !== 'keys' || act.layer || act.duration <= 1e-6) return null;
  const name = nextName(`${f.name}'s motion`, (store.getState().library.clips ?? []).map((c) => c.name));
  const part = act.source.clip.parts[0];
  saveMotion(store, { ...act.source.clip, id: uid('clip'), name, loop: false, duration: act.duration, parts: [{ ...part, name: f.name, body: { ...f.body } }] });
  return name;
}
