import INDEX from '../public/motions/index.json';
import { BUILT_IN, LIBRARY, clipById } from './assets';
import { BODY_PRESETS, DEFAULT_BODY } from './body';
import { newAnimation, propKeyOf } from './animation';
import { newFigure, newProp, newScene } from './doc';
import { arrivalAt } from './evaluate';
import { held } from './hold';
import { fromPreset } from './lighting';
import { legsOf, travelTime, turnTime } from './locomotion';
import { turnArriving } from './track';
import { lightingForSet } from './sets';
import { putPropKey } from './propmotion';
import { REACT_LEAD } from './strike';
import { withFacing } from './relations';
import { uid } from './uid';
import type { Action, BodyParams, Mark, Prop, PropKind, Scene, Side, Travel, Vec3 } from './types';

/*
 * Films: scene templates staged as a director would, beat by beat, a minute or more each, for a
 * shoot preset to film (lib/templates.ts). Who is in it, where they stand, the light, and what
 * each does when, mostly the Library's motion capture (public/motions, by its index: fetched when
 * the scene first plays) timed to one another.
 *
 * Staged by where everyone is (Stage keeps each one's mark: where a motion takes them, from the
 * index's course of it), so that what is done to someone reaches them: a fighter steps in as far
 * as the blow reaches and turns so it lands on the other (the index keeps where each strike's
 * fist or foot is when it lands), the one struck reacts as it does; someone sits only on a chair,
 * walking to the front of it and sitting back onto it. Between what they do, each waits in their
 * own idle facing whom they watch.
 */

interface Entry { id: string; name: string; duration: number; loop?: boolean; impact?: number; move: [number, number]; turn: number; reach?: [number, number, number] }
const motions = INDEX as unknown as Entry[];

/** One of the Library's motions, by its file's name. */
function motion(slug: string): Entry {
  const m = motions.find((x) => x.id === LIBRARY + slug);
  if (!m) throw new Error(`No motion ${slug} in the Library`);
  return m;
}

const body = (name: string): BodyParams => ({ ...(BODY_PRESETS.find((p) => p.name === name)?.body ?? DEFAULT_BODY) });

type Spot = [number, number];
/** Whom or what someone faces: someone (by name), a spot, or a way (degrees). */
type Facing = string | Spot | number;

const D2R = Math.PI / 180;
/** The yaw that faces from one spot to another (degrees). */
const toward = (from: Spot, to: Spot) => Math.atan2(to[0] - from[0], to[1] - from[1]) / D2R;
const wrap = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;
/** A vector in someone's own frame (+x their left, +z ahead) in the world, for someone facing `deg`. */
const turn = (x: number, z: number, deg: number): Spot => [x * Math.cos(deg * D2R) + z * Math.sin(deg * D2R), -x * Math.sin(deg * D2R) + z * Math.cos(deg * D2R)];
const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0;
const FPS = 24;
const frame = (t: number) => Math.round(t * FPS) / FPS;
/** How far in front of someone's middle a blow lands on them (their chest, their face). */
const SURFACE = 0.14;

/** A scene being staged: its people by name and where each is, what they do added in time. */
class Stage {
  scene: Scene;
  private ids = new Map<string, string>();
  private bodies = new Map<string, BodyParams>();
  /** Where each is after what they have been given to do, and when that ends. */
  private marks = new Map<string, Mark>();
  private free = new Map<string, number>();
  /** Where each goes when: from one mark to the next over each thing they do (straight, near enough). */
  private paths = new Map<string, { t0: number; t1: number; from: Spot; via: Spot[]; to: Spot }[]>();
  /** What stands on the floor to walk round (the chairs and tables put in): where, and how far round. */
  private blocks: { at: Spot; r: number }[] = [];
  /** What each does while waiting, and whom they watch meanwhile. */
  private idles = new Map<string, { slug: string; watch?: Facing }>();

  constructor(name: string, cast: { name: string; body: string; at: Spot; facing: Facing; idle?: string }[], light: string, set?: string) {
    const spots = new Map(cast.map((c) => [c.name, c.at]));
    const yaw = (c: (typeof cast)[number]) => (typeof c.facing === 'number' ? c.facing : toward(c.at, typeof c.facing === 'string' ? spots.get(c.facing)! : c.facing));
    const figures = cast.map((c) => withFacing(newFigure({ name: c.name, body: body(c.body), position: [c.at[0], 0, c.at[1]] }), yaw(c)));
    cast.forEach((c, i) => {
      this.ids.set(c.name, figures[i].id);
      this.bodies.set(c.name, body(c.body));
      this.marks.set(c.name, { at: c.at, facing: yaw(c) });
      this.free.set(c.name, 0);
      this.paths.set(c.name, []);
      this.idles.set(c.name, { slug: c.idle ?? 'idle', ...(typeof c.facing === 'string' ? { watch: c.facing } : {}) });
    });
    const scene = newScene(name, figures);
    const lighting = fromPreset(light)!;
    this.scene = { ...scene, lighting: lightingForSet(lighting, set ?? null), ...(set ? { set } : {}), animation: { ...newAnimation(scene, 1), loop: false } };
  }

  id(name: string) {
    return this.ids.get(name)!;
  }

  /** Where someone is (after what they have been given to do). */
  where(who: string): Mark {
    return this.marks.get(who)!;
  }

  /** When someone is free (what they have been given to do ends). */
  until(who: string): number {
    return this.free.get(who)!;
  }

  /** The length of someone's legs: what the Library's courses are measured in. */
  private legs(who: string) {
    return legsOf(this.bodies.get(who)!).rootY;
  }

  /** The way someone at `from` faces to face this. */
  private yaw(from: Spot, f: Facing): number {
    if (typeof f === 'number') return f;
    const to = typeof f === 'string' ? this.where(f).at : f;
    return Math.hypot(to[0] - from[0], to[1] - from[1]) < 1e-3 ? 0 : toward(from, to);
  }

  /** What someone does while they wait from now on, and whom they watch. */
  idle(who: string, slug: string, watch?: Facing) {
    this.idles.set(who, { slug, ...(watch !== undefined ? { watch } : {}) });
  }

  /** How far ahead of someone one of the Library's strikes lands (m). */
  reach(who: string, slug: string): number {
    const r = motion(slug).reach!;
    return Math.hypot(r[0], r[2]) * this.legs(who);
  }

  /** A prop on the set. */
  prop(kind: PropKind, at: Vec3, o: { scale?: Vec3; turn?: number; name?: string } = {}): string {
    const p: Prop = { ...newProp(kind, at, o.name), ...(o.scale ? { scale: o.scale } : {}), ...(o.turn ? { rotation: [0, o.turn, 0] as Vec3 } : {}) };
    this.scene = { ...this.scene, props: [...this.scene.props, p] };
    return p.id;
  }

  /** A prop in someone's hand from the start. */
  hold(prop: string, who: string, hand: Side = 'R') {
    const s = this.scene;
    const p = s.props.find((x) => x.id === prop)!;
    const h = held(p, s.figures.find((f) => f.id === this.id(who))!, hand);
    const props = s.props.map((x) => (x.id === prop ? h.prop : x));
    this.scene = { ...s, props, figures: s.figures.map((f) => (f.id === h.figure.id ? h.figure : f)), animation: putPropKey(s.animation!, 0, prop, propKeyOf(h.prop, 0)) };
  }

  private add(act: Action) {
    const a = this.scene.animation!;
    this.scene = { ...this.scene, animation: { ...a, actions: [...a.actions, act].sort((p, q) => p.start - q.start), duration: Math.max(a.duration, act.start + act.duration) } };
    return act.start + act.duration;
  }

  /** Someone waits in their idle, watching whom they watch, until t. */
  private wait(who: string, t: number) {
    const from = this.free.get(who)!;
    if (t < from - 1e-3) throw new Error(`${who} is still busy at ${t.toFixed(2)} s (till ${from.toFixed(2)} s)`);
    if (t - from < 0.05) return;
    const { slug, watch } = this.idles.get(who)!;
    this.play(who, slug, from, { seconds: t - from, ...(watch !== undefined ? { face: watch } : {}) });
  }

  /**
   * One of the Library's motions played by `who` from t (they wait till then): as long as it is,
   * or `seconds` (one that loops goes round; one that does not holds its last pose); mirrored, if
   * so. It takes them where its course does, or (`at`, `face`) eases them to a spot and a way as
   * it plays (a stance turning to someone, a step into range); `blend`: seconds it eases in over
   * (going down on one knee, slowly). The time it ends.
   */
  play(who: string, slug: string, t: number, o: { seconds?: number; mirror?: boolean; at?: Spot; face?: Facing; blend?: number } = {}): number {
    t = frame(t);
    this.wait(who, t);
    const m = motion(slug);
    // (Turning to face something straight after walking there: the walk turns as it arrives, its
    // last steps taking them round; turning on the spot as they stand would slide their feet.)
    if (o.face !== undefined && !o.at) this.arriveFacing(who, t, this.yaw(this.where(who).at, o.face));
    // (Else, with the time for it, stepping round to face it first, as people turn: not sliding round on the spot.)
    if (o.face !== undefined && !o.at && o.seconds !== undefined) {
      const here = this.where(who);
      const want = this.yaw(here.at, o.face);
      const by = wrap(want - here.facing);
      if (Math.abs(by) > 30 && o.seconds - frame(turnTime(by)) >= 0.5) {
        const t2 = this.turn(who, want, t);
        return this.play(who, slug, t2, { ...o, seconds: o.seconds - (t2 - t) });
      }
    }
    const from = this.where(who);
    const seconds = frame(o.seconds ?? m.duration);
    let end: Mark;
    if (o.at || o.face !== undefined) {
      const at = o.at ?? from.at;
      end = { at, facing: o.face !== undefined ? this.yaw(at, o.face) : from.facing };
    } else {
      const moves = Math.hypot(...m.move) > 0.05 || Math.abs(m.turn) > 5;
      if (moves && (m.loop || seconds < m.duration - 0.05)) throw new Error(`${slug} moves as it plays: give it all, or travel instead`);
      const k = o.mirror ? -1 : 1;
      const [dx, dz] = turn(m.move[0] * k * this.legs(who), m.move[1] * this.legs(who), from.facing);
      end = { at: [from.at[0] + dx, from.at[1] + dz], facing: wrap(from.facing + k * m.turn) };
    }
    end = { at: [r3(end.at[0]), r3(end.at[1])], facing: Math.round(wrap(end.facing) * 10) / 10 || 0 };
    this.moved(who, t, t + seconds, from.at, [], end);
    return this.add({
      id: uid('act'), start: t, duration: seconds, blendIn: o.blend ?? 0.25, roles: [{ figure: this.id(who), end }],
      source: { kind: 'clip', clip: m.id, ...(o.mirror ? { mirror: true } : {}) },
    });
  }

  /** `who` turns to face this way from t, stepping round where they stand. When they have. */
  turn(who: string, facing: number, t: number): number {
    t = frame(t);
    this.wait(who, t);
    const here = this.where(who);
    const end = { at: here.at, facing: Math.round(wrap(facing) * 10) / 10 || 0 };
    const t1 = t + frame(turnTime(wrap(facing - here.facing)));
    this.moved(who, t, t1, here.at, [], end);
    return this.add({ id: uid('act'), start: t, duration: t1 - t, roles: [{ figure: this.id(who), end }], source: { kind: 'travel', mode: 'walk' } });
  }

  /** The walk or run of someone's arriving at t ends facing this way (if it can: lib/track.ts). */
  private arriveFacing(who: string, t: number, facing: number) {
    const a = turnArriving(this.scene, this.id(who), t, facing);
    if (!a) return;
    this.scene = { ...this.scene, animation: a };
    this.marks.set(who, { ...this.where(who), facing: Math.round(wrap(facing) * 10) / 10 || 0 });
  }

  /**
   * `who` walks or runs from t (they wait till then) to a spot, facing the way they go (or,
   * `strafe`, still facing the way they do: stepping back or aside). The time they get there.
   */
  go(who: string, to: Spot, t: number, mode: Travel = 'walk', strafe = false): number {
    t = frame(t);
    this.wait(who, t);
    const from = this.where(who).at;
    const facing = this.where(who).facing;
    const d = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (d < 0.05) return t;
    // Round anyone in the way (where they are as they pass) and the chairs and tables, on the side away from them.
    const length = (pts: Spot[]) => pts.slice(1).reduce((n, q, i) => n + Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]), 0);
    const sideways = strafe ? Math.abs(Math.sin((toward(from, to) - facing) * D2R)) : 0;
    const time = (pts: Spot[]) => frame(travelTime(mode, length(pts), this.bodies.get(who)!, undefined, sideways));
    const via: Spot[] = [];
    for (let tries = 0; tries < 3; tries++) {
      const pts = [from, ...via, to];
      const seconds = time(pts);
      let found: { leg: number; at: Spot; them: Spot; clear: number } | null = null;
      let gone = 0;
      for (let i = 0; i < pts.length - 1 && !found; i++) {
        const leg = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
        const c = this.crowded(who, t + (seconds * gone) / Math.max(1e-6, length(pts)), (seconds * leg) / Math.max(1e-6, length(pts)), pts[i], pts[i + 1]);
        if (c) found = { leg: i, ...c };
        gone += leg;
      }
      if (!found) break;
      const [a, b] = [pts[found.leg], pts[found.leg + 1]];
      const n = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const [ux, uz] = [(b[0] - a[0]) / n, (b[1] - a[1]) / n];
      const side = (found.them[0] - found.at[0]) * -uz + (found.them[1] - found.at[1]) * ux > 0 ? -1 : 1;
      via.splice(found.leg, 0, [r3(found.them[0] - uz * side * found.clear), r3(found.them[1] + ux * side * found.clear)]);
    }
    const seconds = time([from, ...via, to]);
    const last = via.at(-1) ?? from;
    const end = { at: [r3(to[0]), r3(to[1])] as Spot, facing: Math.round((strafe ? facing : toward(last, to)) * 10) / 10 || 0 };
    this.moved(who, t, t + seconds, from, via, end);
    return this.add({
      id: uid('act'), start: t, duration: seconds, roles: [{ figure: this.id(who), end }],
      source: {
        kind: 'travel', mode, ...(strafe ? { strafe: true } : {}),
        ...(via.length ? { via: via.map((v, i) => ({ at: v, facing: Math.round((strafe ? facing : toward(i ? via[i - 1] : from, v)) * 10) / 10 || 0 })) } : {}),
      },
    });
  }

  /** Someone's new mark, and the way there from t0 to t1. */
  private moved(who: string, t0: number, t1: number, from: Spot, via: Spot[], end: Mark) {
    this.marks.set(who, end);
    this.free.set(who, t1);
    this.paths.get(who)!.push({ t0, t1, from, via, to: end.at });
  }

  /** Where someone is at t, as far as they have been given things to do (where they last were, after). */
  at(who: string, t: number): Spot {
    const legs = this.paths.get(who)!;
    const leg = legs.find((x) => t >= x.t0 - 1e-6 && t <= x.t1 + 1e-6);
    if (!leg) return legs.filter((x) => x.t1 <= t).at(-1)?.to ?? legs[0]?.from ?? this.where(who).at;
    const pts = [leg.from, ...leg.via, leg.to];
    const lens = pts.slice(1).map((q, i) => Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]));
    let d = ((t - leg.t0) / Math.max(1e-6, leg.t1 - leg.t0)) * lens.reduce((a, b) => a + b, 0);
    for (let i = 0; i < lens.length; i++) {
      if (d <= lens[i] || i === lens.length - 1) {
        const u = lens[i] > 1e-6 ? Math.min(1, d / lens[i]) : 1;
        return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u];
      }
      d -= lens[i];
    }
    return leg.to;
  }

  /** The first moment someone going straight from `from` to `to` over these seconds comes too near another: where, and where they are. */
  private crowded(who: string, t: number, seconds: number, from: Spot, to: Spot): { at: Spot; them: Spot; clear: number } | null {
    for (let k = 1; k < 20; k++) {
      const u = k / 20;
      const at: Spot = [from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u];
      for (const o of this.ids.keys()) {
        if (o === who) continue;
        const them = this.at(o, t + seconds * u);
        if (Math.hypot(them[0] - at[0], them[1] - at[1]) < 0.7) return { at, them, clear: 0.85 };
      }
      for (const b of this.blocks) if (Math.hypot(b.at[0] - at[0], b.at[1] - at[1]) < b.r + 0.15) return { at, them: b.at, clear: b.r + 0.45 };
    }
    return null;
  }

  /** `who` turns to face someone or something, from t, in their idle. The time they have. */
  face(who: string, f: Facing, t: number, seconds = 0.6): number {
    return this.play(who, this.idles.get(who)!.slug, t, { seconds, face: f });
  }

  /**
   * `who` strikes `target` with one of the Library's strikes from t: stepping in (walking or
   * running there if far) to where the blow reaches, turned so that it lands on them. When it
   * lands, and when the strike ends.
   */
  strike(who: string, slug: string, t: number, target: string, o: { mirror?: boolean; stance?: string } = {}): { lands: number; end: number } {
    const m = motion(slug);
    if (!m.reach || m.impact === undefined) throw new Error(`${slug} is not a strike`);
    const legs = this.legs(who);
    const [rx, rz] = [m.reach[0] * (o.mirror ? -1 : 1) * legs, m.reach[2] * legs];
    const them = this.where(target).at;
    const me = this.where(who).at;
    const d0 = Math.hypot(me[0] - them[0], me[1] - them[1]);
    const back: Spot = d0 > 1e-3 ? [(me[0] - them[0]) / d0, (me[1] - them[1]) / d0] : turn(0, 1, this.where(target).facing);
    // The blow lands on them; they are hit from where it comes: so far back from it, turned so it points there.
    const hit: Spot = [them[0] + back[0] * SURFACE, them[1] + back[1] * SURFACE];
    const far = Math.hypot(rx, rz);
    const at: Spot = [hit[0] + back[0] * far, hit[1] + back[1] * far];
    const facing = toward(at, hit) - Math.atan2(rx, rz) / D2R;
    const stance = o.stance ?? 'fight-idle';
    let t1 = Math.max(t, this.until(who));
    const d = Math.hypot(at[0] - me[0], at[1] - me[1]);
    // (Back or aside, near: stepping there still facing them, not turning away and round again.)
    const away = d <= 3 && Math.abs(wrap(toward(me, at) - this.where(who).facing)) > 90;
    if (d > 0.8) t1 = this.go(who, at, t1, d > 3 ? 'run' : 'walk', away);
    t1 = this.play(who, stance, t1, { seconds: d > 0.8 ? 0.35 : 0.5, at, face: facing });
    const end = this.play(who, slug, t1, { mirror: o.mirror });
    return { lands: frame(t1) + m.impact, end };
  }

  /** A reaction to a blow that lands at `lands`: `who` plays `slug` so that it starts `lead` seconds before. When it ends. */
  react(who: string, slug: string, lands: number, lead = REACT_LEAD, o: { mirror?: boolean } = {}): number {
    return this.play(who, slug, Math.max(this.until(who), lands - lead), o);
  }

  /** A chair of the scene's own, facing `facing`, for someone to sit on: where their hips go (a little forward of its seat's middle, the legs clear of it). */
  chair(seat: Spot, facing: number): Spot {
    const [dx, dz] = turn(0, -0.1, facing);
    this.prop('chair', [r3(seat[0] + dx), 0, r3(seat[1] + dz)], { turn: facing });
    this.blocks.push({ at: [seat[0] + dx, seat[1] + dz], r: 0.32 });
    return seat;
  }

  /** Something on the floor to walk round: where, and how far round (its radius). */
  block(at: Spot, r: number) {
    this.blocks.push({ at, r });
  }

  /**
   * `who` sits on a seat (a chair's, a sofa's: where their hips go, and the way it faces) from t:
   * walking to the front of it, turning round and sitting back onto it. They wait sitting. When
   * they are down.
   */
  sit(who: string, seat: Spot, facing: number, t: number, idle = 'sitting-idle'): number {
    const m = motion('stand-to-sit');
    const [dx, dz] = turn(m.move[0] * this.legs(who), m.move[1] * this.legs(who), facing);
    const front: Spot = [seat[0] - dx, seat[1] - dz];
    let t1 = this.go(who, front, t, 'walk');
    // (Turning round on the spot in front of it: turning as they arrive would take their last steps through it.)
    t1 = this.play(who, 'idle', t1, { seconds: 0.7, at: front, face: facing });
    t1 = this.play(who, 'stand-to-sit', t1, { at: seat, face: facing });
    this.idle(who, idle);
    return t1;
  }

  /** `who` gets up from a chair at t, then waits standing (in `idle`, watching `watch`). When they are up. */
  rise(who: string, t: number, idle = 'idle', watch?: Facing): number {
    const end = this.play(who, 'sit-to-stand', t);
    this.idle(who, idle, watch);
    return end;
  }

  /** A built-in motion with the prop in `who`'s hand (a dribble, a pass, a shot), from t, on their upper body. Its end. */
  handle(who: string, prop: string, motion: 'dribble' | 'shoot' | 'pass', t: number, target: Action['target'], o: { laps?: number; hand?: Side } = {}): number {
    const clip = clipById(BUILT_IN + motion)!;
    return this.add({
      id: uid('act'), start: frame(t), duration: frame(clip.duration * (o.laps ?? 1)), layer: 'upper', roles: [{ figure: this.id(who) }],
      source: { kind: 'clip', clip: clip.id, ...(o.hand === 'L' ? { mirror: true } : {}) }, prop, target,
    });
  }

  /** `who` passes the ball in their hand to `to`'s right hand from t. When it gets there (caught). */
  pass(who: string, ball: string, t: number, to: string, hand: Side = 'R'): number {
    this.handle(who, ball, 'pass', t, { figure: this.id(to), hand: 'R' }, { hand });
    const release = frame(t) + 0.5;
    return arrivalAt(this.scene, ball, release) ?? release + 0.8;
  }

  /** The scene, its film running on `tail` seconds after the last thing anyone does, everyone waiting till then. */
  done(tail = 1): Scene {
    const a = this.scene.animation!;
    const end = frame(Math.max(...a.actions.map((x) => x.start + x.duration)) + tail);
    for (const who of this.ids.keys()) this.wait(who, end);
    return { ...this.scene, animation: { ...this.scene.animation!, duration: end } };
  }
}

/**
 * A wuxia duel down an old market street at dusk: a salute, the rush, kicks and blocks, a dodge,
 * blows that land both ways, a fall and a getting up, the last kick, a bow to the fallen.
 */
export function wuxiaDuel(): Scene {
  const s = new Stage('Wuxia duel', [
    { name: 'Lin', body: 'Tall man', at: [0, 3.5], facing: 'Mei', idle: 'fight-idle' },
    { name: 'Mei', body: 'Tall woman', at: [0, -3.5], facing: 'Lin', idle: 'fight-idle' },
  ], 'dusk', 'old-street');
  // The salute: fist in palm, then the stance.
  s.play('Lin', 'praying', 0.5);
  s.play('Mei', 'praying', 0.8);
  s.play('Lin', 'breathing-idle', s.until('Lin'), { seconds: 1.5, face: 'Mei' });
  // They close in slowly, then Lin's kick, blocked.
  s.go('Lin', [0, 1.8], s.until('Lin'));
  s.go('Mei', [0, -1.6], s.until('Mei') + 0.3);
  let x = s.strike('Lin', 'roundhouse-kick', Math.max(s.until('Lin'), s.until('Mei')) + 0.6, 'Mei');
  s.react('Mei', 'standing-block', x.lands, 0.45);
  // Her hook, his guard up.
  x = s.strike('Mei', 'hook-punch', s.until('Mei') + 0.3, 'Lin');
  s.react('Lin', 'blocking', x.lands, 0.35);
  // His jab and cross: she dodges aside.
  x = s.strike('Lin', 'jab-cross', s.until('Lin') + 0.4, 'Mei');
  s.react('Mei', 'standing-dodge-left', x.lands, 0.4);
  // She turns on him, a flourish (capoeira), then her uppercut lands.
  s.face('Mei', 'Lin', s.until('Mei'));
  s.play('Mei', 'capoeira', s.until('Mei'));
  s.face('Mei', 'Lin', s.until('Mei'));
  x = s.strike('Mei', 'uppercut', s.until('Mei') + 0.2, 'Lin');
  s.react('Lin', 'receive-punch-to-the-face', x.lands);
  // He shakes it off; his kick lands, she recoils.
  s.play('Lin', 'shake-fist', s.until('Lin') + 0.3);
  x = s.strike('Lin', 'roundhouse-kick', s.until('Lin') + 0.3, 'Mei');
  s.react('Mei', 'hit-reaction', x.lands, 0.15);
  // She flips back out of reach, and comes again: a jab and cross into his guard.
  s.play('Mei', 'backflip', s.until('Mei') + 0.2);
  s.face('Mei', 'Lin', s.until('Mei'));
  x = s.strike('Mei', 'jab-cross', s.until('Mei') + 0.6, 'Lin');
  s.react('Lin', 'blocking', x.lands, 0.35);
  // His hook catches her; her uppercut sends him down on one knee.
  x = s.strike('Lin', 'hook-punch', s.until('Lin') + 0.2, 'Mei');
  s.react('Mei', 'receive-punch-to-the-face', x.lands);
  x = s.strike('Mei', 'uppercut', s.until('Mei') + 0.4, 'Lin');
  s.react('Lin', 'receive-punch-to-the-face', x.lands);
  s.play('Lin', 'kneeling-idle', s.until('Lin'), { seconds: 3, blend: 0.7 });
  // He gets up slowly while she waits.
  s.play('Lin', 'crouch-to-stand', s.until('Lin'));
  s.face('Lin', 'Mei', s.until('Lin'));
  s.play('Lin', 'fight-idle', s.until('Lin'), { seconds: 1.5, face: 'Mei' });
  // The last exchange: her kick blocked, his kick lands and she falls.
  x = s.strike('Mei', 'roundhouse-kick', s.until('Lin'), 'Lin');
  s.react('Lin', 'standing-block', x.lands, 0.45);
  x = s.strike('Lin', 'roundhouse-kick', s.until('Lin') + 0.5, 'Mei');
  s.react('Mei', 'falling-back-death', x.lands, 0.2);
  s.idle('Mei', 'laying-idle');
  // He bows to her, and turns away.
  s.play('Lin', 'breathing-idle', s.until('Lin'), { seconds: 2, face: 'Mei' });
  s.play('Lin', 'praying', s.until('Lin'));
  const away = s.where('Lin').at;
  s.go('Lin', [away[0] + 0.8, away[1] + 2.5], s.until('Lin') + 0.5);
  s.play('Lin', 'sad-idle', s.until('Lin'), { seconds: 3 });
  return s.done(1);
}

/**
 * A stand-off at night: a man holds a woman hostage on the pavement; an officer walks up and
 * talks him down while a passer-by hides behind a car; she breaks free and runs, he gives up and
 * kneels, the officer goes to him.
 */
export function standOff(): Scene {
  const s = new Stage('Stand-off', [
    { name: 'Vince', body: 'Big man', at: [0, -0.4], facing: 0, idle: 'angry' },
    { name: 'Ana', body: 'Tall woman', at: [0, 0.35], facing: 0, idle: 'scared' },
    { name: 'Officer Diaz', body: 'Man', at: [-11, 1], facing: 90 },
    { name: 'Passer-by', body: 'Woman', at: [8, 0.5], facing: -90 },
  ], 'night', 'street');
  // The officer comes along the pavement and stops 4 m from them, gun on him.
  s.idle('Officer Diaz', 'pointing', 'Vince');
  s.go('Officer Diaz', [-4, 1.2], 1);
  s.face('Officer Diaz', 'Vince', s.until('Officer Diaz'));
  // The passer-by walks up, sees them and hides crouching behind the parked car.
  s.go('Passer-by', [5, 0.6], 0.5);
  s.play('Passer-by', 'surprised', s.until('Passer-by'), { face: 'Vince' });
  s.go('Passer-by', [5.6, 2.2], s.until('Passer-by'), 'run');
  s.idle('Passer-by', 'crouch-idle', 'Vince');
  // Vince shouts at him, Ana cries.
  s.idle('Vince', 'angry', 'Officer Diaz');
  s.play('Vince', 'standing-arguing', 4, { seconds: 8, face: 'Officer Diaz' });
  s.play('Ana', 'crying', 3, { seconds: 12 });
  // The officer talks: calm down, it is over.
  s.play('Officer Diaz', 'talking', 12, { seconds: 8, face: 'Vince' });
  s.play('Vince', 'shaking-head-no', 13, { seconds: 3.6, face: 'Officer Diaz' });
  s.play('Vince', 'shake-fist', s.until('Vince') + 0.5, { seconds: 4.8, face: 'Officer Diaz' });
  s.play('Officer Diaz', 'pointing', s.until('Officer Diaz'), { seconds: 4, face: 'Vince' });
  s.play('Vince', 'thinking', s.until('Vince') + 1, { seconds: 8.4, face: 'Officer Diaz' });
  s.play('Officer Diaz', 'dismissing-gesture', s.until('Officer Diaz'), { face: 'Vince' });
  s.play('Officer Diaz', 'talking', s.until('Officer Diaz'), { seconds: 6, face: 'Vince' });
  // She breaks free and runs to the passer-by behind the car.
  const free = Math.max(s.until('Vince'), s.until('Ana'), 34);
  s.go('Ana', [4.6, 1.8], free, 'run');
  s.play('Vince', 'surprised', free + 0.3, { face: 'Ana' });
  s.play('Passer-by', 'crouch-to-stand', Math.max(s.until('Passer-by'), s.until('Ana') - 1));
  s.face('Passer-by', 'Ana', s.until('Passer-by'));
  s.idle('Passer-by', 'sad-idle', 'Ana');
  s.idle('Ana', 'crying', 'Passer-by');
  s.face('Ana', 'Passer-by', s.until('Ana'));
  // Alone, he gives up: down on his knees.
  s.play('Vince', 'defeat-idle', s.until('Vince'), { seconds: 3.2, face: 'Officer Diaz' });
  s.play('Vince', 'kneeling-idle', s.until('Vince'), { seconds: 2, face: 'Officer Diaz', blend: 0.8 });
  s.idle('Vince', 'kneeling-idle');
  // The officer walks up to him, gun on him, and calls it in.
  const vince = s.where('Vince').at;
  s.go('Officer Diaz', [vince[0] - 1.6, vince[1] + 0.6], s.until('Vince'));
  s.play('Officer Diaz', 'pointing', s.until('Officer Diaz'), { seconds: 5, face: 'Vince' });
  s.play('Officer Diaz', 'talking-on-phone', s.until('Officer Diaz'), { seconds: 9, face: 'Vince' });
  s.play('Ana', 'crying', s.until('Ana'), { seconds: 4 });
  return s.done(1);
}

/**
 * Street basketball in the park: two on one, the drive and the pass and the shot that goes in;
 * the fan at the side feeding them new balls; the defender's own drive and miss; the last play,
 * and the cheering.
 */
export function streetBasketball(): Scene {
  const s = new Stage('Street basketball', [
    { name: 'Jay', body: 'Tall man', at: [-0.6, 0], facing: 0 },
    { name: 'Kofi', body: 'Man', at: [2.4, 1], facing: 0 },
    { name: 'Rico', body: 'Man', at: [0, 4.6], facing: 'Jay', idle: 'standing-idle' },
    { name: 'Fan', body: 'Woman', at: [5.2, 3.2], facing: -90, idle: 'happy-idle' },
  ], 'noon', 'park');
  const hoop = s.prop('hoop', [0, 0, 8.5], { turn: 180 });
  const ball = (name: string, at: Vec3) => s.prop('sphere', at, { scale: [0.24, 0.24, 0.24], name });
  const [a, b, c] = [ball('Ball', [0, 0, 0]), ball('Ball 2', [5, 0, 3]), ball('Ball 3', [5.3, 0, 3])];
  s.hold(a, 'Jay');
  s.hold(b, 'Fan', 'R');
  s.hold(c, 'Fan', 'L');
  s.idle('Jay', 'idle', 'Rico');
  s.idle('Kofi', 'idle', 'Jay');
  s.idle('Fan', 'happy-idle', 'Jay');
  // Up the court dribbling, the defender coming out to meet him.
  let t = s.go('Jay', [-0.6, 3], 0.4);
  s.handle('Jay', a, 'dribble', 0.4, { bounce: true }, { laps: Math.floor((t - 0.4) / 0.5) });
  s.go('Rico', [-0.4, 4.6], 1);
  s.go('Kofi', [2.6, 5.2], 1.2);
  s.face('Kofi', 'Jay', s.until('Kofi'));
  // The pass across to Kofi, and back as Jay cuts in.
  s.face('Jay', 'Kofi', t);
  let caught = s.pass('Jay', a, s.until('Jay'), 'Kofi');
  s.go('Jay', [-0.3, 6], caught);
  s.face('Jay', 'Kofi', s.until('Jay'));
  s.face('Rico', 'Jay', Math.max(s.until('Rico'), caught));
  caught = s.pass('Kofi', a, Math.max(s.until('Jay'), caught + 0.8), 'Jay');
  // The shot over Rico's jump: in.
  s.face('Jay', [0, 8.5], caught + 0.2, 0.5);
  let shot = s.until('Jay') + 0.2;
  let end = s.handle('Jay', a, 'shoot', shot, { hoop });
  s.play('Rico', 'jump', Math.max(s.until('Rico'), shot));
  t = Math.max(end, s.until('Rico')) + 0.6;
  s.play('Fan', 'standing-thumbs-up', t);
  s.play('Kofi', 'happy-idle', t, { seconds: 3, face: 'Jay' });
  // The fan throws Rico a new ball: his turn, from the top.
  s.go('Rico', [1.6, 2.4], t + 0.5);
  s.face('Rico', 'Fan', s.until('Rico'));
  s.face('Fan', 'Rico', Math.max(s.until('Fan'), s.until('Rico') - 0.6));
  caught = s.pass('Fan', b, Math.max(s.until('Rico'), s.until('Fan')), 'Rico');
  s.idle('Fan', 'happy-idle', 'Rico');
  s.go('Jay', [-0.4, 4.6], Math.max(s.until('Jay'), caught - 1.2));
  s.idle('Jay', 'standing-idle', 'Rico');
  s.face('Rico', [0, 8.5], caught + 0.4);
  // His drive, dribbling, Jay sliding across to stay in front.
  let from = s.until('Rico');
  t = s.go('Rico', [0.6, 6.2], from);
  s.handle('Rico', b, 'dribble', from, { bounce: true }, { laps: Math.max(1, Math.floor((t - from) / 0.5)) });
  s.play('Jay', 'strafe-left', Math.max(s.until('Jay'), from + 0.3), { seconds: 1.8, face: 'Rico' });
  s.face('Rico', [0, 8.5], t, 0.5);
  // His shot: off the rim.
  shot = s.until('Rico') + 0.1;
  end = s.handle('Rico', b, 'shoot', shot, { hoop, miss: true });
  s.play('Jay', 'jump', Math.max(s.until('Jay'), shot));
  t = Math.max(end, s.until('Jay')) + 1.2;
  s.play('Rico', 'disappointed', t, { seconds: 4 });
  s.play('Fan', 'shaking-head-no', Math.max(s.until('Fan'), t));
  // The last play: Kofi takes the third ball, drives, and feeds Jay for the winner.
  s.go('Kofi', [3.4, 2.6], Math.max(s.until('Kofi'), t));
  s.face('Kofi', 'Fan', s.until('Kofi'));
  s.face('Fan', 'Kofi', Math.max(s.until('Fan'), s.until('Kofi') - 0.6));
  caught = s.pass('Fan', c, Math.max(s.until('Kofi'), s.until('Fan')), 'Kofi', 'L');
  s.idle('Fan', 'happy-idle', 'Kofi');
  s.go('Jay', [-1.2, 5.8], Math.max(s.until('Jay'), caught));
  s.idle('Jay', 'idle', 'Kofi');
  s.go('Rico', [1.4, 6.8], Math.max(s.until('Rico'), caught + 0.5));
  s.idle('Rico', 'standing-idle', 'Kofi');
  s.face('Kofi', [0, 8.5], caught + 0.4);
  from = s.until('Kofi');
  t = s.go('Kofi', [2.2, 5.4], from);
  s.handle('Kofi', c, 'dribble', from, { bounce: true }, { laps: Math.max(1, Math.floor((t - from) / 0.5)) });
  s.face('Kofi', 'Jay', t);
  caught = s.pass('Kofi', c, s.until('Kofi'), 'Jay');
  s.face('Jay', [0, 8.5], Math.max(s.until('Jay'), caught + 0.2), 0.5);
  shot = s.until('Jay') + 0.2;
  end = s.handle('Jay', c, 'shoot', shot, { hoop });
  s.play('Rico', 'jump', Math.max(s.until('Rico'), shot));
  // In: they cheer, the fan waves, the defender hangs his head.
  t = Math.max(end, s.until('Rico')) + 0.8;
  s.play('Jay', 'standing-thumbs-up', t, { face: 'Kofi' });
  s.play('Kofi', 'waving', Math.max(s.until('Kofi'), t + 0.3), { face: 'Jay' });
  s.play('Fan', 'waving', Math.max(s.until('Fan'), t));
  s.play('Fan', 'happy-idle', s.until('Fan'), { seconds: 4, face: 'Jay' });
  s.play('Rico', 'defeat-idle', t + 0.5, { seconds: 5 });
  s.go('Jay', [3.5, 4.3], s.until('Jay') + 0.5);
  s.go('Kofi', [4.4, 2.3], s.until('Kofi') + 0.2);
  s.play('Jay', 'laughing', s.until('Jay'), { seconds: 5, face: 'Fan' });
  s.play('Kofi', 'talking', s.until('Kofi'), { seconds: 5, face: 'Fan' });
  s.play('Fan', 'laughing', Math.max(s.until('Fan'), s.until('Kofi') - 5), { seconds: 5, face: 'Kofi' });
  // Rico comes over: good game, a thumbs up, and they talk it over.
  s.go('Rico', [2.5, 2.6], s.until('Rico') + 0.5);
  s.play('Rico', 'standing-thumbs-up', s.until('Rico'), { face: 'Jay' });
  s.play('Jay', 'head-nod-yes', Math.max(s.until('Jay'), s.until('Rico') - 2), { face: 'Rico' });
  s.play('Rico', 'talking', s.until('Rico'), { seconds: 6, face: 'Kofi' });
  s.play('Kofi', 'laughing', Math.max(s.until('Kofi'), s.until('Rico') - 5), { seconds: 5, face: 'Rico' });
  s.play('Jay', 'shrugging', s.until('Rico') - 2, { face: 'Rico' });
  return s.done(0.5);
}

/**
 * A house party at dusk: a couple dancing salsa, someone dancing hip hop, two friends talking on
 * the sofa; a late guest comes in through the door waving and joins them, then goes to dance; the
 * host gets a drink; one friend gets up to dance too, the other stays chatting.
 */
export function houseParty(): Scene {
  const s = new Stage('House party', [
    { name: 'Rosa', body: 'Woman', at: [-0.7, -0.4], facing: 'Leo', idle: 'salsa-dancing' },
    { name: 'Leo', body: 'Man', at: [0.7, -0.4], facing: 'Rosa', idle: 'salsa-dancing' },
    { name: 'Dee', body: 'Tall woman', at: [2.8, 0.9], facing: -120, idle: 'hip-hop-dancing' },
    { name: 'Sam', body: 'Tall man', at: [-0.5, -3.42], facing: 0, idle: 'sitting-talking' },
    { name: 'Kim', body: 'Woman', at: [0.45, -3.42], facing: 0, idle: 'sitting-idle' },
    { name: 'Nia', body: 'Woman', at: [-5, -2], facing: 90 },
  ], 'dusk', 'living-room');
  // The couple's salsa and Dee's hip hop go on (their idles); Sam and Kim talk on the sofa.
  s.play('Kim', 'sitting-talking', 2, { seconds: 9 });
  // Nia comes in late through the door, waving, and comes over to the sofa.
  s.go('Nia', [-3.8, -1.6], 13);
  s.play('Nia', 'waving', s.until('Nia'), { face: [0, -0.4] });
  s.go('Nia', [-1.5, -1.2], s.until('Nia'));
  s.face('Nia', [-0.1, -3.4], s.until('Nia'));
  s.play('Nia', 'talking', s.until('Nia'), { seconds: 7.8, face: 'Kim' });
  s.play('Nia', 'laughing', s.until('Nia'), { seconds: 4, face: 'Sam' });
  s.play('Kim', 'sitting-talking', Math.max(s.until('Kim'), s.until('Nia') - 10), { seconds: 10 });
  // Nia goes to dance with Dee.
  s.go('Nia', [1.6, 2.1], s.until('Nia') + 0.3);
  s.idle('Nia', 'hip-hop-dancing', 'Dee');
  s.idle('Dee', 'hip-hop-dancing', 'Nia');
  s.play('Dee', 'dancing', s.until('Nia'), { face: 'Nia' });
  // Leo gets a drink by the TV while Rosa dances alone, then he comes back to her.
  s.go('Leo', [3.3, -0.8], 31);
  s.play('Leo', 'drinking', s.until('Leo'), { seconds: 7, face: 'Rosa' });
  s.play('Rosa', 'jazz-dancing', 31.4, { face: 'Leo' });
  s.play('Rosa', 'rumba-dancing', s.until('Rosa'), { seconds: 6.6 });
  s.go('Leo', [0.7, -0.4], s.until('Leo'));
  s.idle('Leo', 'salsa-dancing', 'Rosa');
  s.idle('Rosa', 'salsa-dancing', 'Leo');
  // Kim gets up and joins the dancing; Sam stays on the sofa, cheering them on.
  const up = Math.max(s.until('Kim'), 44);
  s.rise('Kim', up, 'swing-dancing', 'Nia');
  s.go('Kim', [1.7, -2.98], s.until('Kim') + 0.2);
  s.go('Kim', [2.0, -1.4], s.until('Kim'));
  s.go('Kim', [-0.3, 1.7], s.until('Kim'));
  s.play('Sam', 'sitting-talking', up, { seconds: 20 });
  s.play('Nia', 'waving', Math.max(s.until('Nia'), s.until('Kim')), { face: 'Kim' });
  s.play('Rosa', 'salsa-dancing', Math.max(s.until('Rosa'), 46), { seconds: 16, face: 'Leo' });
  return s.done(4);
}

/**
 * The office before a deadline: one on the phone at her desk, one thinking it over by the
 * window, a colleague comes in and gets water, the boss walks the floor on his phone and calls a
 * briefing; they sit and talk it over, it is agreed, thumbs up, back to work.
 */
export function officeDeadline(): Scene {
  const s = new Stage('Office deadline', [
    { name: 'Maya', body: 'Woman', at: [-1.6, -1.6], facing: 180 },
    { name: 'Tom', body: 'Man', at: [7.6, 0.5], facing: -90 },
    { name: 'Grace', body: 'Tall woman', at: [2.4, -1.5], facing: 150, idle: 'thinking' },
    { name: 'Mr Hale', body: 'Big man', at: [-5.6, 1.6], facing: 90 },
  ], 'studio', 'office');
  // Three chairs for a briefing.
  const seats = ([[-1.8, 0.8], [0, 0.5], [1.8, 0.8]] as Spot[]).map((at) => s.chair(at, 0));
  // Maya on the phone at her desk, Grace thinking by hers, Tom in through the side door to the water cooler.
  s.play('Maya', 'talking-on-phone', 0.2, { seconds: 16, face: 180 });
  s.play('Grace', 'thinking', 0.4, { seconds: 12.7, face: 150 });
  s.go('Tom', [6.2, -0.8], 1);
  s.go('Tom', [6.3, -5.4], s.until('Tom'));
  s.play('Tom', 'button-pushing', s.until('Tom'), { face: [6.4, -6] });
  s.play('Tom', 'drinking', s.until('Tom'), { seconds: 6, face: [3, -3] });
  // The boss walks the floor on his phone.
  s.idle('Mr Hale', 'idle', 'Maya');
  s.go('Mr Hale', [-4.6, 1.4], 0.5);
  s.play('Mr Hale', 'talking-on-phone', s.until('Mr Hale'), { seconds: 9, face: 'Maya' });
  s.go('Mr Hale', [-0.4, 1.9], s.until('Mr Hale'));
  // He calls them over for a briefing.
  s.play('Mr Hale', 'waving', s.until('Mr Hale'), { face: 'Maya' });
  const meet = s.until('Mr Hale');
  s.sit('Maya', seats[0], 0, Math.max(s.until('Maya'), meet - 1), 'sitting-idle');
  s.sit('Grace', seats[1], 0, Math.max(s.until('Grace'), meet - 0.5), 'sitting-idle');
  s.go('Tom', [6.2, -1.2], Math.max(s.until('Tom'), meet - 2));
  s.sit('Tom', seats[2], 0, s.until('Tom'), 'sitting-idle');
  // He stands before them and talks it through.
  s.go('Mr Hale', [2.4, 2.5], meet + 0.3);
  s.idle('Mr Hale', 'idle', [0, 0.6]);
  const brief = Math.max(s.until('Tom'), s.until('Mr Hale')) + 0.3;
  s.play('Mr Hale', 'talking', brief, { seconds: 8, face: [0, 0.6] });
  s.play('Mr Hale', 'pointing', s.until('Mr Hale'), { face: 'Grace' });
  s.play('Tom', 'sitting-talking', s.until('Mr Hale') - 0.5, { seconds: 7 });
  s.play('Mr Hale', 'thinking', s.until('Mr Hale') + 0.5, { face: 'Tom' });
  s.play('Mr Hale', 'head-nod-yes', s.until('Mr Hale'), { face: 'Maya' });
  s.play('Maya', 'sitting-talking', s.until('Mr Hale') - 3, { seconds: 6 });
  s.play('Grace', 'sitting-talking', s.until('Maya'), { seconds: 6 });
  s.play('Mr Hale', 'shrugging', s.until('Mr Hale') + 1, { face: 'Grace' });
  s.play('Mr Hale', 'talking', s.until('Mr Hale'), { seconds: 6, face: 'Grace' });
  // Agreed: they get up, thumbs up all round, and go back to their desks.
  const done = Math.max(s.until('Mr Hale'), s.until('Grace')) + 0.5;
  s.play('Mr Hale', 'standing-thumbs-up', done, { face: [0, 0.6] });
  s.rise('Maya', done + 0.3, 'happy-idle', 'Mr Hale');
  s.rise('Grace', done + 0.6, 'happy-idle', 'Mr Hale');
  s.rise('Tom', done + 0.9, 'happy-idle', 'Mr Hale');
  s.play('Tom', 'standing-thumbs-up', s.until('Tom') + 0.3, { face: 'Mr Hale' });
  s.play('Maya', 'head-nod-yes', s.until('Maya') + 0.4, { face: 'Mr Hale' });
  s.play('Grace', 'laughing', s.until('Grace') + 0.4, { seconds: 4, face: 'Maya' });
  s.go('Maya', [-1.6, -1.6], s.until('Maya') + 0.5);
  s.go('Grace', [2.4, -1.5], s.until('Grace') + 0.3);
  s.play('Maya', 'talking-on-phone', s.until('Maya'), { seconds: 6, face: 180 });
  s.play('Mr Hale', 'happy-idle', s.until('Mr Hale'), { seconds: 4, face: 'Tom' });
  return s.done(1);
}

/**
 * Two friends meet in a café: one sits waiting at a table by the front, the other comes in
 * waving and sits down across from her; they talk over coffee while the barista works the
 * counter; then they get up, laugh, say goodbye, and one leaves.
 */
export function cafeMeeting(): Scene {
  const s = new Stage('Café meeting', [
    { name: 'Lea', body: 'Woman', at: [-3.4, 2.6], facing: 0 },
    { name: 'Ben', body: 'Man', at: [6.8, 1.1], facing: -90 },
    { name: 'Ira', body: 'Tall woman', at: [2.2, -5.2], facing: 0, idle: 'bored' },
  ], 'dusk', 'cafe');
  // Their table at the front, a chair either side of it.
  s.prop('cylinder', [-2.4, 0, 1.4], { scale: [0.7, 0.74, 0.7], name: 'Table' });
  s.block([-2.4, 1.4], 0.35);
  const [hers, his] = [s.chair([-3.4, 1.4], 90), s.chair([-1.4, 1.4], -90)];
  // Lea sits down to wait.
  s.sit('Lea', hers, 90, 0.3, 'sitting-idle');
  // The barista behind the counter.
  s.play('Ira', 'look-around', 1, { face: [-2.4, 1.4] });
  s.play('Ira', 'yawn', s.until('Ira'), { seconds: 5 });
  // Ben comes in, sees her and waves; she waves back.
  s.go('Ben', [3.6, 1.1], 8);
  s.play('Ben', 'waving', s.until('Ben'), { face: 'Lea' });
  s.play('Lea', 'sitting-talking', s.until('Ben') - 2.6, { seconds: 2.6 });
  s.sit('Ben', his, -90, s.until('Ben'), 'sitting-talking');
  // They talk; the barista works.
  const talk = s.until('Ben');
  s.play('Lea', 'sitting-talking', talk, { seconds: 26 });
  s.play('Ben', 'sitting-talking', talk + 0.5, { seconds: 26 });
  s.play('Ira', 'talking', 16, { seconds: 6, face: [2.8, -3.2] });
  s.go('Ira', [-0.6, -5.2], s.until('Ira'));
  s.play('Ira', 'lifting-object', s.until('Ira'), { seconds: 5, face: 0 });
  s.go('Ira', [2.2, -5.2], s.until('Ira'));
  s.play('Ira', 'look-around', s.until('Ira'), { seconds: 6, face: 0 });
  // Time to go: they get up, laugh, and say goodbye.
  const up = Math.max(s.until('Lea'), s.until('Ben')) + 0.5;
  s.rise('Lea', up, 'happy-idle', 'Ben');
  s.rise('Ben', up + 0.4, 'happy-idle', 'Lea');
  s.go('Lea', [-3.2, 2.8], s.until('Lea') + 0.2);
  s.go('Ben', [-2.0, 2.8], s.until('Ben') + 0.2);
  s.face('Lea', 'Ben', s.until('Lea'), 0.8);
  s.face('Ben', 'Lea', s.until('Ben'), 0.8);
  s.play('Ben', 'laughing', s.until('Ben'), { seconds: 4, face: 'Lea' });
  s.play('Lea', 'talking', s.until('Lea'), { seconds: 4, face: 'Ben' });
  s.play('Ben', 'waving', s.until('Ben'), { face: 'Lea' });
  s.go('Ben', [6.8, 1.1], s.until('Ben') + 0.2);
  s.play('Lea', 'waving', s.until('Lea') + 0.5, { face: [6, 1.1] });
  s.sit('Lea', hers, 90, s.until('Lea') + 0.5, 'sitting-idle');
  s.play('Ira', 'happy-idle', s.until('Ira'), { seconds: 3, face: 'Lea' });
  return s.done(3);
}

/**
 * A kung fu school in a courtyard at noon: the master's salute, the warm-up, drills on the bags,
 * sparring with blows that land, the acrobatics, the master's own demonstration, the bow.
 */
export function kungFuSchool(): Scene {
  const s = new Stage('Kung fu school', [
    { name: 'Master Wu', body: 'Man', at: [0, -1.8], facing: 0 },
    { name: 'Hua', body: 'Woman', at: [-2, 1.6], facing: 180 },
    { name: 'Jun', body: 'Tall man', at: [0, 1.6], facing: 180 },
    { name: 'Ling', body: 'Tall woman', at: [2, 1.6], facing: 180 },
  ], 'noon', 'courtyard');
  const students = ['Hua', 'Jun', 'Ling'];
  for (const w of students) s.idle(w, 'idle', 'Master Wu');
  s.idle('Master Wu', 'idle', 'Jun');
  // The salute, and the master's words.
  s.play('Master Wu', 'praying', 0.6);
  for (const [i, w] of students.entries()) s.play(w, 'praying', 1 + i * 0.2);
  s.play('Master Wu', 'talking', s.until('Master Wu') + 0.3, { seconds: 5, face: 'Jun' });
  // The warm-up: jumping jacks, skipping.
  for (const [i, w] of students.entries()) {
    s.play(w, 'jumping-jacks', 9.5 + i * 0.15, { seconds: 6 });
    s.play(w, 'jumping-rope', s.until(w) + 0.4, { seconds: 5 });
  }
  s.play('Master Wu', 'head-nod-yes', 12, { face: 'Jun' });
  // Drills on the standing bags.
  const bags: Spot[] = [[-4.4, 5.2], [4.4, 5.2]];
  for (const [i, at] of bags.entries()) s.prop('cylinder', [at[0], 0, at[1]], { scale: [0.36, 1.6, 0.36], name: `Bag ${i + 1}` });
  // (As far from the bag as the punches reach, and its radius: the fists on it.)
  const reach = (who: string, bag: Spot, from: Spot) => {
    const d = s.reach(who, 'punching-bag') + 0.2;
    const u = [from[0] - bag[0], from[1] - bag[1]];
    const n = Math.hypot(u[0], u[1]);
    return [bag[0] + (u[0] / n) * d, bag[1] + (u[1] / n) * d] as Spot;
  };
  const drill = 23;
  s.go('Hua', reach('Hua', bags[0], [-2.4, 3]), drill);
  s.play('Hua', 'punching-bag', s.until('Hua'), { seconds: 9.7, face: bags[0] });
  s.go('Ling', reach('Ling', bags[1], [2.4, 3]), drill + 0.2);
  s.play('Ling', 'punching-bag', s.until('Ling'), { seconds: 9.7, face: bags[1] });
  // Jun and the master spar: the master's kick blocked, Jun's blows into his guard, the master's jab lands.
  s.idle('Jun', 'fight-idle', 'Master Wu');
  s.idle('Master Wu', 'fight-idle', 'Jun');
  s.go('Master Wu', [0, 0.4], drill);
  let x = s.strike('Master Wu', 'roundhouse-kick', drill + 2, 'Jun');
  s.react('Jun', 'standing-block', x.lands, 0.45);
  x = s.strike('Jun', 'jab-cross', s.until('Jun') + 0.3, 'Master Wu');
  s.react('Master Wu', 'blocking', x.lands, 0.35);
  x = s.strike('Jun', 'hook-punch', s.until('Jun') + 0.2, 'Master Wu');
  s.react('Master Wu', 'standing-dodge-left', x.lands, 0.4);
  s.face('Master Wu', 'Jun', s.until('Master Wu'));
  x = s.strike('Master Wu', 'jab-cross', s.until('Master Wu') + 0.2, 'Jun');
  s.react('Jun', 'hit-reaction', x.lands, 0.15);
  // The acrobatics: Hua's flip back, Ling's capoeira, Jun's backflip; the master watches.
  const show = Math.max(...students.map((w) => s.until(w))) + 0.5;
  s.idle('Master Wu', 'idle', 'Jun');
  for (const w of students) s.idle(w, 'idle', 'Master Wu');
  s.go('Hua', [-2.2, 3.4], show);
  s.face('Hua', 180, s.until('Hua'));
  s.play('Hua', 'backflip', s.until('Hua') + 0.3);
  s.go('Ling', [3.6, 1.6], show + 0.4);
  s.face('Ling', -90, s.until('Ling'));
  s.play('Ling', 'capoeira', s.until('Ling') + 0.4);
  s.go('Jun', [0, 3.4], show + 0.2);
  s.face('Jun', 180, s.until('Jun'));
  s.play('Jun', 'backflip', Math.max(s.until('Jun'), s.until('Hua')) + 0.5);
  s.play('Master Wu', 'standing-thumbs-up', s.until('Jun') - 1, { face: 'Jun' });
  // The master's demonstration: his kick into Jun's block, then the bow.
  const demo = Math.max(...students.map((w) => s.until(w)), s.until('Master Wu')) + 0.5;
  s.idle('Jun', 'fight-idle', 'Master Wu');
  s.idle('Master Wu', 'fight-idle', 'Jun');
  x = s.strike('Master Wu', 'roundhouse-kick', demo, 'Jun');
  s.react('Jun', 'standing-block', x.lands, 0.45);
  x = s.strike('Master Wu', 'uppercut', s.until('Master Wu') + 0.4, 'Jun');
  s.react('Jun', 'blocking', x.lands, 0.35);
  // Lined up again, the salute.
  const bow = Math.max(...students.map((w) => s.until(w)), s.until('Master Wu')) + 0.5;
  for (const w of students) s.idle(w, 'idle', 'Master Wu');
  s.idle('Master Wu', 'idle', 'Jun');
  s.go('Master Wu', [0, -1.8], bow);
  for (const [i, w] of students.entries()) s.go(w, [-2 + i * 2, 1.6], bow + 0.2 * i);
  const line = Math.max(...students.map((w) => s.until(w)), s.until('Master Wu')) + 0.3;
  s.face('Master Wu', 0, line);
  for (const w of students) s.face(w, 180, line);
  for (const [i, w] of students.entries()) s.play(w, 'praying', s.until(w) + 0.4 + i * 0.15);
  s.play('Master Wu', 'praying', s.until('Master Wu') + 0.4);
  return s.done(1.5);
}

/**
 * A chase down a city street at night: a thief snatches a bag and runs, an officer after him;
 * over the bench, across the road between the cars, hiding behind one, found; a last sprint, the
 * officer's tackle-punch, the thief down and giving up.
 */
export function streetChase(): Scene {
  const s = new Stage('Street chase', [
    { name: 'Thief', body: 'Man', at: [-14, -1.2], facing: 90 },
    { name: 'Officer Park', body: 'Tall woman', at: [-17, 0.4], facing: 90, idle: 'look-around' },
    { name: 'Clara', body: 'Woman', at: [-11, -1], facing: -90, idle: 'talking-on-phone' },
  ], 'night', 'street');
  // Clara on the phone; the thief walks up, snatches her bag and bolts round her.
  s.play('Clara', 'talking-on-phone', 0, { seconds: 5, face: -90 });
  s.go('Thief', [-12.1, -0.5], 1);
  s.play('Thief', 'dismissing-gesture', s.until('Thief'), { seconds: 1.2, face: 'Clara' });
  s.face('Clara', 'Thief', Math.max(5, s.until('Thief') - 0.6));
  s.play('Clara', 'scared', s.until('Clara'), { seconds: 3, face: 'Thief' });
  s.go('Thief', [-10, 0.6], s.until('Thief'), 'run');
  s.go('Thief', [-5, -1.2], s.until('Thief'), 'run');
  s.play('Clara', 'pointing', s.until('Clara'), { face: 'Thief' });
  s.idle('Clara', 'crying', 'Thief');
  // The officer hears it and gives chase.
  s.play('Officer Park', 'surprised', 6, { face: 'Thief' });
  s.go('Officer Park', [-6.4, 0.6], s.until('Officer Park'), 'run');
  // Over the bench: the thief jumps it, the officer goes round.
  s.go('Thief', [-3, -0.9], s.until('Thief'), 'run');
  s.go('Thief', [0.5, -0.6], s.until('Thief'), 'run');
  s.go('Officer Park', [-1.2, 0.6], s.until('Officer Park'), 'run');
  // Across the road between the cars, and down behind the far one to hide.
  s.go('Thief', [2.4, 6.4], s.until('Thief'), 'run');
  s.go('Thief', [8, 5.6], s.until('Thief'), 'run');
  s.play('Thief', 'crouch-idle', s.until('Thief'), { seconds: 0.4, face: -90 });
  s.idle('Thief', 'crouch-idle', -90);
  const hid = s.until('Thief');
  // The officer stops, looks round, and walks along the cars.
  s.go('Officer Park', [2.2, 1.2], s.until('Officer Park'), 'run');
  s.play('Officer Park', 'look-around', s.until('Officer Park'), { seconds: 6.3, face: 90 });
  s.go('Officer Park', [4.4, 5.6], s.until('Officer Park'));
  s.play('Officer Park', 'look-around', s.until('Officer Park'), { seconds: 3, face: 90 });
  // Found: he bolts again, down the road.
  const bolt = Math.max(hid + 6, s.until('Officer Park'));
  s.play('Thief', 'crouch-to-stand', bolt, { face: 90 });
  s.go('Thief', [17, 6.2], s.until('Thief'), 'run');
  s.go('Thief', [15, 0.2], s.until('Thief'), 'run');
  s.go('Officer Park', [16.2, 5.2], s.until('Thief') - 3.2, 'run');
  s.face('Thief', 'Officer Park', s.until('Thief'));
  // Cornered, he swings at her; she ducks it and her punch puts him down.
  s.idle('Thief', 'fight-idle', 'Officer Park');
  s.idle('Officer Park', 'fight-idle', 'Thief');
  let x = s.strike('Thief', 'hook-punch', Math.max(s.until('Thief'), s.until('Officer Park')) + 0.4, 'Officer Park');
  s.react('Officer Park', 'standing-dodge-left', x.lands, 0.4);
  s.face('Officer Park', 'Thief', s.until('Officer Park'));
  x = s.strike('Officer Park', 'jab-cross', s.until('Officer Park') + 0.2, 'Thief');
  s.react('Thief', 'hit-reaction', x.lands, 0.15);
  // He gives up: down on his knees; she holds him there and calls it in.
  s.play('Thief', 'kneeling-idle', s.until('Thief'), { seconds: 2, face: 'Officer Park', blend: 0.8 });
  s.idle('Thief', 'kneeling-idle');
  s.play('Officer Park', 'pointing', s.until('Officer Park') + 0.5, { seconds: 4, face: 'Thief' });
  s.play('Officer Park', 'talking-on-phone', s.until('Officer Park'), { seconds: 8, face: 'Thief' });
  // Clara comes running up the street.
  s.go('Clara', [12.4, -0.4], 40, 'run');
  s.play('Clara', 'shake-fist', s.until('Clara'), { face: 'Thief' });
  s.play('Clara', 'happy-idle', s.until('Clara'), { seconds: 4, face: 'Officer Park' });
  return s.done(1);
}

/** The films, as scene templates (people, set, light, what they do), with how each is filmed. */
export const FILMS: { id: string; name: string; people: number; build(): Scene; coverage: string; cast?: number[] }[] = [
  { id: 'film-wuxia', name: 'Wuxia duel', people: 2, build: wuxiaDuel, coverage: 'fight' },
  // (The officer and the man holding the hostage.)
  { id: 'film-standoff', name: 'Stand-off', people: 4, build: standOff, coverage: 'dialogue', cast: [2, 0] },
  // (The shooter and the defender.)
  { id: 'film-basketball', name: 'Street basketball', people: 4, build: streetBasketball, coverage: 'sports', cast: [0, 2] },
  // (Hand-held on the one dancing alone: nobody in front of her, the party round her.)
  { id: 'film-party', name: 'House party', people: 6, build: houseParty, coverage: 'documentary', cast: [2] },
  { id: 'film-office', name: 'Office deadline', people: 4, build: officeDeadline, coverage: 'documentary', cast: [3] },
  { id: 'film-cafe', name: 'Café meeting', people: 3, build: cafeMeeting, coverage: 'dialogue', cast: [0, 1] },
  { id: 'film-kungfu', name: 'Kung fu school', people: 4, build: kungFuSchool, coverage: 'fight', cast: [0, 2] },
  { id: 'film-chase', name: 'Street chase', people: 3, build: streetChase, coverage: 'sports', cast: [0, 1] },
];
