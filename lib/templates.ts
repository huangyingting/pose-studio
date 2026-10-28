import { placeAnimation, normalize } from './animation';
import { duplicateScene, ensureCamera } from './doc';
import { MOTIONS, highJump } from './motions';
import { facing, withFacing } from './relations';
import { STAGINGS } from './stagings';
import { clear } from './track';
import { uid } from './uid';
import { COVERAGES } from './coverage';
import type { Animation, Figure, Library, Scene, ShootPreset, TemplateAsset, Vec3 } from './types';

/*
 * Scene templates: what is filmed, without how it is filmed. A template is a cast (its roles:
 * people as they start), a set (props, around a stage origin), what they do (actions) and the
 * light; no cameras and no cuts, so any template can be filmed with any coverage
 * (lib/coverage.ts). Built in: people standing together, several people's motions (as made, key
 * by key, to edit), and set-ups with their props; the user's own are saved from any scene. A template opens as a new scene, or
 * goes into the open one: its first role taken by the selected figure (where it stands, facing
 * its way), the others by the figures nearest it, new figures for the rest.
 */

export const TEMPLATE_GROUPS = ['Standing together', 'Moving together', 'Set-ups'] as const;

export interface SceneTemplate {
  id: string;
  name: string;
  group: (typeof TEMPLATE_GROUPS)[number] | 'Mine';
  people: number;
  build(): Scene;
}


export const SCENE_TEMPLATES: SceneTemplate[] = [
  ...STAGINGS.map((s) => ({ id: s.id, name: s.name, group: 'Standing together' as const, people: s.people, build: s.build })),
  ...MOTIONS.filter((m) => m.people > 1).map((m) => ({ id: m.id, name: m.name, group: 'Moving together' as const, people: m.people, build: m.build })),
  { id: 'high-jump', name: 'High jump', group: 'Set-ups', people: 1, build: highJump },
];

/**
 * Shoot presets: a scene template and a coverage to film it with, by reference (neither holds
 * the other). Picking one opens the template as a new scene and films it; a still template is
 * given an animation this long first.
 */
export const SHOOT_PRESETS: ShootPreset[] = [
  { id: 'shoot-interview', name: 'Interview', template: 'conversation', coverage: 'dialogue', duration: 9 },
  { id: 'shoot-deal', name: 'Closing the deal', template: 'handshake', coverage: 'dialogue', duration: 6 },
  { id: 'shoot-bout', name: 'The bout', template: 'boxing', coverage: 'dialogue' },
  { id: 'shoot-dance', name: 'First dance', template: 'waltz-turn', coverage: 'follow' },
  { id: 'shoot-jump', name: 'Over the bar', template: 'high-jump', coverage: 'follow' },
];

/** The shoot presets there are: the built-in ones and the library's (those whose template and coverage are there). */
export function shootsOf(lib: Library): ShootPreset[] {
  const templates = new Set(templatesOf(lib).map((t) => t.id));
  return [...SHOOT_PRESETS, ...(lib.shoots ?? []).filter((p) => templates.has(p.template) && COVERAGES.some((c) => c.id === p.coverage))];
}

/** The templates there are: the built-in ones and the library's (fresh ids each time one is built). */
export function templatesOf(lib: Library): SceneTemplate[] {
  return [
    ...SCENE_TEMPLATES,
    ...(lib.templates ?? []).map((t) => ({ id: t.id, name: t.name, group: 'Mine' as const, people: t.scene.figures.length, build: () => ensureCamera({ ...duplicateScene(t.scene), name: t.name }) })),
  ];
}

/** A scene with all its people, props and actions turned by `deg` about the stage origin and moved by (x, z). */
export function placeScene(scene: Scene, deg: number, x: number, z: number): Scene {
  const r = (deg * Math.PI) / 180;
  const place = (px: number, pz: number): [number, number] => [px * Math.cos(r) + pz * Math.sin(r) + x, -px * Math.sin(r) + pz * Math.cos(r) + z];
  const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0;
  const figures = scene.figures.map((f) => {
    const [fx, fz] = place(f.position[0], f.position[2]);
    return withFacing({ ...f, position: [r3(fx), f.position[1], r3(fz)] }, facing(f) + deg);
  });
  const props = scene.props.map((p) => {
    if (p.hold) return p;
    const [px, pz] = place(p.position[0], p.position[2]);
    return { ...p, position: [r3(px), p.position[1], r3(pz)] as typeof p.position, rotation: [p.rotation[0], r3(p.rotation[1] + deg), p.rotation[2]] as typeof p.rotation };
  });
  return { ...scene, figures, props, ...(scene.animation ? { animation: placeAnimation(scene.animation, deg, place) } : {}) };
}

/**
 * A scene as a template: no cameras, coverage or cuts (a scene made from it is given a camera),
 * its people around the stage origin (where they stand at the start).
 */
export function asTemplate(scene: Scene, name: string): TemplateAsset {
  const shown = scene.figures.length ? scene.figures : [{ position: [0, 0, 0] }];
  const cx = shown.reduce((s, f) => s + f.position[0], 0) / shown.length;
  const cz = shown.reduce((s, f) => s + f.position[2], 0) / shown.length;
  const { coverage: _v, animation: a, ...rest } = structuredClone(scene);
  void _v;
  const bare: Scene = { ...rest, cameras: [] };
  if (a) bare.animation = { ...a, shots: [] };
  return { id: uid('tpl'), name, scene: { ...placeScene(bare, 0, -cx, -cz), name } };
}

/**
 * A template put into a scene, its actions from `t0`: its first role taken by `cast[0]` (the
 * template turned and moved so that role starts where that figure stands, facing its way), the
 * next ones by the rest of `cast`, new figures for the others (beside everyone, without a cast).
 * The figures cast keep who they are (body, name, look) and take the template's pose and
 * actions; what they did from `t0` on gives way.
 */
export function putTemplate(scene: Scene, template: Scene, cast: string[], t0: number, at?: Vec3): Scene {
  const lead = scene.figures.find((f) => f.id === cast[0]);
  const first = template.figures[0];
  const spare = Math.max(0, ...scene.figures.map((f) => f.position[0] + 1.2));
  // Its first role on the lead (where it stands, facing its way), or at a spot (its first figure there), or beside the others.
  const placed = !first ? template
    : lead ? placeScene(placeScene(template, 0, -first.position[0], -first.position[2]), facing(lead) - facing(first), lead.position[0], lead.position[2])
      : at ? placeScene(template, 0, at[0] - first.position[0], at[2] - first.position[2])
        : placeScene(template, 0, scene.figures.length ? spare : 0, 0);
  const ids = new Map(placed.figures.map((f, i) => [f.id, cast[i] && scene.figures.some((x) => x.id === cast[i]) ? cast[i] : f.id]));
  const taken = new Set(cast);
  const role = (f: Figure) => placed.figures.find((x) => ids.get(x.id) === f.id);
  const figures = [
    ...scene.figures.map((f) => {
      const r = taken.has(f.id) ? role(f) : undefined;
      return r ? { ...f, bones: r.bones, position: r.position, hands: structuredClone(r.hands), grounded: r.grounded } : f;
    }),
    ...placed.figures.filter((f) => ids.get(f.id) === f.id),
  ];
  const remap = (id: string) => ids.get(id) ?? id;
  const props = [...scene.props, ...placed.props.map((p) => (p.hold ? { ...p, hold: { ...p.hold, figure: remap(p.hold.figure) } } : p))];
  let animation = scene.animation;
  if (placed.animation) {
    const moved = placeAnimation(placed.animation, 0, (x, z) => [x, z], t0);
    const actions = moved.actions.map((x) => ({
      ...x,
      roles: x.roles.map((r) => ({ ...r, figure: remap(r.figure) })),
      ...(x.target && 'figure' in x.target ? { target: { ...x.target, figure: remap(x.target.figure) } } : {}),
    }));
    const props2 = moved.props && Object.fromEntries(Object.entries(moved.props).map(([id, keys]) => [id, keys.map((k) => (k.hold ? { ...k, hold: { ...k.hold, figure: remap(k.hold.figure) } } : k))]));
    const holds = moved.constraints?.map((c) => ({ ...c, figure: remap(c.figure), ...('figure' in c.target ? { target: { ...c.target, figure: remap(c.target.figure) } } : {}) }));
    const end = t0 + placed.animation.duration;
    // What the figures cast did from t0 on gives way to the template's.
    let base: Animation = scene.animation ?? { duration: end, fps: placed.animation.fps, loop: placed.animation.loop, actions: [], shots: [{ id: 'main', start: 0, name: 'Shot 1', camera: scene.cameras[0].id }] };
    for (const id of taken) if (scene.animation && scene.figures.some((f) => f.id === id)) base = clear({ ...scene, animation: base }, id, t0, 60);
    animation = {
      ...base,
      duration: Math.max(base.duration, end),
      actions: [...base.actions, ...actions].sort((p, q) => p.start - q.start),
      ...(props2 || base.props ? { props: { ...base.props, ...props2 } } : {}),
      ...(holds?.length || base.constraints?.length ? { constraints: [...(base.constraints ?? []), ...(holds ?? [])] } : {}),
    };
  }
  const next: Scene = { ...scene, figures, props, ...(placed.light && !scene.figures.length ? { light: placed.light } : {}) };
  return animation ? { ...next, animation: normalize(animation, figures) } : next;
}
