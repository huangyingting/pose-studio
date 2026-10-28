import INDEX from '../public/motions/index.json';
import { BUILT_IN, LIBRARY, clipById } from './assets';
import { BODY_PRESETS, DEFAULT_BODY } from './body';
import { newAnimation, propKeyOf } from './animation';
import { newFigure, newProp, newScene } from './doc';
import { held } from './hold';
import { LIGHT_PRESETS } from './lighting';
import { putPropKey } from './propmotion';
import { facing, withFacing } from './relations';
import { addTravel } from './track';
import { uid } from './uid';
import type { Action, BodyParams, Prop, PropKind, Scene, Travel, Vec3 } from './types';

/*
 * Films: scene templates staged as a director would, beat by beat, for a shoot preset to film
 * (lib/templates.ts): a wuxia duel, a stand-off, street basketball, a house party. Who is in it,
 * where they stand, the light, and what each does when, mostly the Library's motion capture
 * (public/motions, by its index: fetched when the scene first plays) timed to one another: a
 * block as the kick lands, a fall as the punch does.
 */

interface Entry { id: string; name: string; duration: number; people: number; loop?: boolean; starts?: { at: [number, number]; facing: number }[]; impact?: number }
const motions = INDEX as Entry[];

/** One of the Library's motions, by its file's name. */
function motion(slug: string): Entry {
  const m = motions.find((x) => x.id === LIBRARY + slug);
  if (!m) throw new Error(`No motion ${slug} in the Library`);
  return m;
}

const body = (name: string): BodyParams => ({ ...(BODY_PRESETS.find((p) => p.name === name)?.body ?? DEFAULT_BODY) });

/** The yaw that faces from one spot to another (degrees). */
const toward = (from: [number, number], to: [number, number]) => (Math.atan2(to[0] - from[0], to[1] - from[1]) * 180) / Math.PI;

/** A scene being staged: its people by name, what they do added in time. */
class Stage {
  scene: Scene;
  private ids = new Map<string, string>();

  constructor(name: string, cast: { name: string; body: string; at: [number, number]; facing: number }[], light: string) {
    const figures = cast.map((c) => withFacing(newFigure({ name: c.name, body: body(c.body), position: [c.at[0], 0, c.at[1]] }), c.facing));
    cast.forEach((c, i) => this.ids.set(c.name, figures[i].id));
    const scene = newScene(name, figures);
    this.scene = { ...scene, light: { ...LIGHT_PRESETS.find((l) => l.id === light)!.light }, animation: { ...newAnimation(scene, 1), loop: false } };
  }

  id(name: string) {
    return this.ids.get(name)!;
  }

  /** A prop on the set. */
  prop(kind: PropKind, at: Vec3, o: { scale?: Vec3; turn?: number; name?: string } = {}): string {
    const p: Prop = { ...newProp(kind, at, o.name), ...(o.scale ? { scale: o.scale } : {}), ...(o.turn ? { rotation: [0, o.turn, 0] as Vec3 } : {}) };
    this.scene = { ...this.scene, props: [...this.scene.props, p] };
    return p.id;
  }

  /** A prop in someone's right hand from the start. */
  hold(prop: string, who: string) {
    const s = this.scene;
    const p = s.props.find((x) => x.id === prop)!;
    const h = held(p, s.figures.find((f) => f.id === this.id(who))!, 'R');
    const props = s.props.map((x) => (x.id === prop ? h.prop : x));
    this.scene = { ...s, props, figures: s.figures.map((f) => (f.id === h.figure.id ? h.figure : f)), animation: putPropKey(s.animation!, 0, prop, propKeyOf(h.prop, 0)) };
  }

  private add(act: Action) {
    const a = this.scene.animation!;
    this.scene = { ...this.scene, animation: { ...a, actions: [...a.actions, act].sort((p, q) => p.start - q.start), duration: Math.max(a.duration, act.start + act.duration) } };
    return act.start + act.duration;
  }

  /**
   * One of the Library's motions played by `who` from t: as long as it is, or `seconds` (one that
   * loops goes round); mirrored, if so. The time it ends.
   */
  play(who: string, slug: string, t: number, o: { seconds?: number; mirror?: boolean } = {}): number {
    const m = motion(slug);
    return this.add({
      id: uid('act'), start: t, duration: o.seconds ?? m.duration, blendIn: 0.25, roles: [{ figure: this.id(who) }],
      source: { kind: 'clip', clip: m.id, ...(o.mirror ? { mirror: true } : {}) },
    });
  }

  /** A reaction to a strike: `who` plays `slug` so that it starts `lead` seconds before the strike played from `at` lands. */
  react(who: string, slug: string, strike: string, at: number, lead = 0.25) {
    return this.play(who, slug, Math.max(0, at + (motion(strike).impact ?? 0.5) - lead));
  }

  /**
   * A motion of two from the start: the lead where it stands, the other put where the motion has
   * them (turned and placed as the lead is). As long as `seconds` (going round). The time it ends.
   */
  together(lead: string, other: string, slug: string, seconds: number): number {
    const m = motion(slug);
    const [s0, s1] = m.starts!;
    const f = this.scene.figures.find((x) => x.id === this.id(lead))!;
    const by = facing(f) - s0.facing;
    const r = (by * Math.PI) / 180;
    const [dx, dz] = [s1.at[0] - s0.at[0], s1.at[1] - s0.at[1]];
    const at: [number, number] = [f.position[0] + dx * Math.cos(r) + dz * Math.sin(r), f.position[2] - dx * Math.sin(r) + dz * Math.cos(r)];
    this.scene = {
      ...this.scene,
      figures: this.scene.figures.map((x) => (x.id === this.id(other) ? withFacing({ ...x, position: [at[0], 0, at[1]] }, s1.facing + by) : x)),
    };
    return this.add({ id: uid('act'), start: 0, duration: seconds, blendIn: 0.25, roles: [{ figure: this.id(lead) }, { figure: this.id(other) }], source: { kind: 'clip', clip: m.id } });
  }

  /** `who` walks or runs from t (or when what it does then ends) to a spot. The time it gets there. */
  go(who: string, to: [number, number], t: number, mode: Travel = 'walk'): number {
    const done = addTravel(this.scene, this.id(who), t, to, mode)!;
    this.scene = { ...this.scene, animation: done.animation };
    return done.to;
  }

  /** A built-in motion with the prop in `who`'s right hand (a dribble, a shot), from t. Its end. */
  handle(who: string, prop: string, motion: 'dribble' | 'shoot', t: number, target: Action['target'], laps = 1): number {
    const clip = clipById(BUILT_IN + motion)!;
    return this.add({
      id: uid('act'), start: t, duration: clip.duration * laps, layer: 'upper', roles: [{ figure: this.id(who) }],
      source: { kind: 'clip', clip: clip.id }, prop, target,
    });
  }

  /** The scene, its film running on `tail` seconds after the last thing anyone does. */
  done(tail = 1): Scene {
    const a = this.scene.animation!;
    const end = Math.max(...a.actions.map((x) => x.start + x.duration));
    return { ...this.scene, animation: { ...a, duration: Math.round((end + tail) * a.fps) / a.fps } };
  }
}

/** A wuxia duel: a stand-off, a rush in, kick and block, punch and parry, an uppercut, a fall. */
export function wuxiaDuel(): Scene {
  const s = new Stage('Wuxia duel', [
    { name: 'Lin', body: 'Athletic', at: [-2.6, 0], facing: 90 },
    { name: 'Mei', body: 'Slender', at: [2.6, 0], facing: -90 },
  ], 'dusk');
  s.play('Lin', 'fight-idle', 0, { seconds: 2.2 });
  s.play('Mei', 'fight-idle', 0, { seconds: 2.6 });
  // The rush: Lin runs in, Mei steps up to meet her.
  const met = Math.max(s.go('Lin', [-0.75, 0], 2.2, 'run'), s.go('Mei', [0.75, 0], 2.6, 'walk')) + 0.15;
  // Kick, blocked.
  let t = met;
  const kick = s.play('Lin', 'roundhouse-kick', t);
  s.react('Mei', 'standing-block', 'roundhouse-kick', t, 0.45);
  // Mei's hook, blocked.
  t = kick;
  const hook = s.play('Mei', 'hook-punch', t);
  s.react('Lin', 'blocking', 'hook-punch', t, 0.35);
  // Lin's uppercut lands.
  t = hook;
  const upper = s.play('Lin', 'uppercut', t);
  s.react('Mei', 'punched-in-the-face', 'uppercut', t);
  // Lin's jab and cross: Mei goes down.
  t = upper + 0.4;
  s.play('Lin', 'fight-idle', upper, { seconds: 0.4 });
  const finish = s.play('Lin', 'jab-cross', t);
  s.react('Mei', 'falling-back-death', 'jab-cross', t, 0.2);
  s.play('Lin', 'fight-idle', finish, { seconds: 2 });
  return s.done();
}

/** A stand-off: a man holds a hostage; a cop walks in and takes aim; someone nearby cowers. */
export function standOff(): Scene {
  const cop: [number, number] = [-2.6, 7.5], passer: [number, number] = [2.8, 3.4];
  const s = new Stage('Stand-off', [
    { name: 'Vince', body: 'Heroic', at: [0, 0], facing: 0 },
    { name: 'Ana', body: 'Slender', at: [0, 0.5], facing: 0 },
    { name: 'Officer Diaz', body: 'Male', at: cop, facing: toward(cop, [0, 0]) },
    { name: 'Passer-by', body: 'Female', at: passer, facing: toward(passer, [0, 0]) },
  ], 'night');
  const end = 12;
  s.together('Vince', 'Ana', 'hostage', end);
  // The officer stops 3.6 m short of them, on the way straight at them: aiming at them.
  const d = Math.hypot(cop[0], cop[1]);
  const there = s.go('Officer Diaz', [(cop[0] / d) * 3.6, (cop[1] / d) * 3.6], 0.8, 'walk');
  s.play('Officer Diaz', 'aim-pistol', there, { seconds: end - there });
  s.play('Passer-by', 'scared', 0, { seconds: end });
  return s.done(0.5);
}

/** Street basketball: a drive up the court dribbling, a shot over the defender's jump, a fan cheering. */
export function streetBasketball(): Scene {
  const s = new Stage('Street basketball', [
    { name: 'Jay', body: 'Athletic', at: [0, 0], facing: 0 },
    { name: 'Rico', body: 'Male', at: [0.3, 5], facing: 180 },
    { name: 'Fan', body: 'Female', at: [3.2, 2.5], facing: -90 },
  ], 'noon');
  const hoop = s.prop('hoop', [0, 0, 7.5], { turn: 180 });
  const ball = s.prop('sphere', [0.5, 0, 0.5], { scale: [0.24, 0.24, 0.24], name: 'Ball' });
  s.hold(ball, 'Jay');
  // Up the court dribbling; the defender shuffles to meet him.
  const up = s.go('Jay', [0, 3.6], 0, 'walk');
  s.handle('Jay', ball, 'dribble', 0, { bounce: true }, Math.max(1, Math.floor(up / 0.5)));
  s.play('Rico', 'strafe', 0.4, { seconds: up - 0.4, mirror: true });
  // The shot, over his jump.
  const shot = s.handle('Jay', ball, 'shoot', up, { hoop });
  s.play('Rico', 'jump', up);
  s.play('Fan', 'surprised', 0, { seconds: up + 0.4 });
  s.play('Fan', 'standing-thumbs-up', up + 0.4, { seconds: Math.max(3, shot - up + 2) });
  return s.done(1.5);
}

/** A house party: a couple dancing salsa, someone dancing alone, friends talking, laughing and drinking. */
export function houseParty(): Scene {
  const at = { rosa: [-0.7, 0], leo: [0.7, 0], dee: [2.4, 1.6], sam: [-2.4, 1.8], kim: [-1.5, 2.7] } as Record<string, [number, number]>;
  const s = new Stage('House party', [
    { name: 'Rosa', body: 'Female', at: at.rosa, facing: toward(at.rosa, at.leo) },
    { name: 'Leo', body: 'Male', at: at.leo, facing: toward(at.leo, at.rosa) },
    { name: 'Dee', body: 'Slender', at: at.dee, facing: toward(at.dee, [0, 0]) },
    { name: 'Sam', body: 'Athletic', at: at.sam, facing: toward(at.sam, at.kim) },
    { name: 'Kim', body: 'Female', at: at.kim, facing: toward(at.kim, at.sam) },
  ], 'dusk');
  const end = 14;
  s.play('Rosa', 'salsa-dancing', 0, { seconds: end });
  s.play('Leo', 'salsa-dancing', 0, { seconds: end, mirror: true });
  s.play('Dee', 'hip-hop-dancing', 0, { seconds: end });
  s.play('Sam', 'talking', 0, { seconds: 6 });
  s.play('Sam', 'drinking', 6, { seconds: end - 6 });
  s.play('Kim', 'laughing', 0, { seconds: end });
  return s.done(0);
}

/** The films, as scene templates (people, set, light, what they do), with how each is filmed. */
export const FILMS: { id: string; name: string; people: number; build(): Scene; coverage: string; cast?: number[] }[] = [
  { id: 'film-wuxia', name: 'Wuxia duel', people: 2, build: wuxiaDuel, coverage: 'fight' },
  // (The officer and the man holding the hostage; the shooter and the defender.)
  { id: 'film-standoff', name: 'Stand-off', people: 4, build: standOff, coverage: 'dialogue', cast: [2, 0] },
  { id: 'film-basketball', name: 'Street basketball', people: 3, build: streetBasketball, coverage: 'sports', cast: [0, 1] },
  // (Hand-held on the one dancing alone: nobody in front of her, the party round her.)
  { id: 'film-party', name: 'House party', people: 5, build: houseParty, coverage: 'documentary', cast: [2] },
];
