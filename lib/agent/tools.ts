import { BUILT_IN_CHARACTERS } from '../characters';
import { modelInfo } from '../model';
import {
  addScene, addFigures, applyMotion, frameShot, setLens, coverScene, editCamera, editRig, editShot, newShoot, placeTemplate, addCamera, editAsPath, setCameraMove, applyPose, applyCameraMove, applyUpperBody, arrange, deleteAction, deleteFigure, deleteProp, dribbleProp, holdHandle, holdOn, letGo, lieOn, sitOn, standUp, turnTo, strikeFigure, lookAtFigure,
  holdProp, moveAction, moveMark, propNow, reachFor, retime, setBlend, setClipOptions, setFigureColor, setFigureModel, addLight, applyLightingPreset, editLight, setEnvironment, setLook, subjectOf, setGaze, setTravel, throwProp, travelTo,
  carryProblem, setPlayRange, setActionLook, splitAt, editProjectSettings, offsetPerformance, setAnimationOptions, setDistance, setPlacement, startAnimation,
} from '../actions';
import { BODY_PRESETS } from '../body';
import { LIGHTING_PRESETS, MAX_LIGHTS, kelvinColor, keyLight, lightFrom, lightText, lightingName, lightingOf, towards, type Place } from '../lighting';
import { newFigure, newProp, newScene, nextName, withPosture } from '../doc';
import { projectSettingsOf } from '../project';
import { HAND_PRESETS, cloneHand } from '../hands';
import { actionsOf, figurePoseAt, marksOf, missedCatchesOf, overWarp } from '../evaluate';
import { actionLabel } from '../track';
import { clampRotation } from '../joints';
import { MOTIONS } from '../motions';
import { allPoses, builtInPoses } from '../poses';
import { COVERAGES, castCoverage } from '../coverage';
import { describeShot } from '../prompt';
import { checkMotion } from '../qa';
import { CONTACTS, facing, type Contact } from '../relations';
import { anglesOf, withAngles, type Angles } from '../pose';
import { CAMERA_MOVES, SHOT_SIZES, liveCamera, rigRule, type Placement, type ShotSize } from '../cameras';
import { shotSpans, spanAt } from '../shots';
import type { Store } from '../store';
import { SCENE_TEMPLATES, SHOOT_PRESETS, shootsOf, templatesOf } from '../templates';
import { type Action, FIGURE_COLORS, JOINTS, MOVE_KINDS, type MoveKind, POSTURES, PROP_KINDS, PROP_LABELS, STYLES, type Side, type Travel, type Figure, type JointName, type LightKind, type Posture, type PropKind, type PathCamera, type Style, type Vec3 } from '../types';

/*
 * What an AI assistant can do in the studio: read the scene and change it through the same
 * actions as the UI (so every change can be undone). One registry serves the assistant panel
 * (server edition: the model runs on the server, the tools here in the browser).
 */

type Schema = Record<string, unknown>;

export interface AgentTool {
  name: string;
  description: string;
  /** JSON Schema for the input: strict (every property required, nullable when optional). */
  schema: Schema;
  run(store: Store, input: Record<string, unknown>): string;
}

const obj = (properties: Record<string, Schema>): Schema => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
});
const num = (description: string): Schema => ({ type: 'number', description });
const opt = (s: Schema): Schema => ({ ...s, type: [s.type as string, 'null'] });
const str = (description: string, values?: readonly string[]): Schema => ({ type: 'string', description, ...(values ? { enum: [...values] } : {}) });
const bool = (description: string): Schema => ({ type: 'boolean', description });
const FIGURE = str('Figure id or name');

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

function findProp(store: Store, ref: unknown) {
  const props = store.scene.props;
  const p = props.find((x) => x.id === ref) ?? props.find((x) => x.name.toLowerCase() === String(ref).toLowerCase());
  if (!p) throw new Error(`No prop "${ref}". Props: ${props.map((x) => `${x.name} (${x.id})`).join(', ') || 'none'}`);
  return p;
}

function findFigure(store: Store, ref: unknown): Figure {
  const s = String(ref ?? '').trim().toLowerCase();
  const f = store.scene.figures.find((x) => x.id.toLowerCase() === s) ?? store.scene.figures.find((x) => x.name.toLowerCase() === s);
  if (!f) throw new Error(`No figure "${ref}". Figures: ${store.scene.figures.map((x) => `${x.name} (${x.id})`).join(', ') || 'none'}`);
  return f;
}

const sexOf = (f: Figure) => (f.body.height < 1.4 ? 'child' : f.body.sex < 0.5 ? 'male' : 'female');

function sceneSummary(store: Store) {
  const s = store.scene;
  const a = s.animation;
  return {
    pose: s.name,
    figures: s.figures.map((f) => ({
      id: f.id,
      name: f.name,
      kind: f.proxy ? `stand-in (${f.proxy})` : 'figure',
      body: `${sexOf(f)}, ${r2(f.body.height)} m`,
      position: { x: r2(f.position[0]), z: r2(f.position[2]) },
      facing: r1(facing(f)),
      grounded: f.grounded,
      ...(f.hidden ? { hidden: true } : {}),
      ...(f.model ? { drawn_as: modelInfo(f.model)?.name } : {}),
      joints: Object.fromEntries(Object.entries(anglesOf(f.bones)).map(([k, v]) => [k, v.map(r1)])),
    })),
    props: s.props.map((p) => ({ id: p.id, name: p.name, kind: p.kind, ...(p.hold ? { held_by: p.hold.figure, hand: p.hold.hand } : {}), position: { x: r2(p.position[0]), z: r2(p.position[2]) }, facing: r1(p.rotation[1]), scale: p.scale.map(r2) })),
    animation: a ? {
      duration: a.duration,
      loop: a.loop,
      playhead: r2(store.getState().time),
      // Each person's track: what they do, when, and where it leaves them (its mark).
      actions: a.actions.map((x) => ({
        id: x.id,
        what: actionLabel(x),
        kind: x.source.kind === 'keys' ? 'posed' : x.source.kind,
        ...(x.layer ? { layer: x.layer === 'upper' ? 'upper body' : 'correction' } : {}),
        figures: x.roles.map((r) => s.figures.find((f) => f.id === r.figure)?.name ?? r.figure),
        start: r2(x.start),
        end: r2(x.start + x.duration),
        ...(x.blendIn ? { blend_in: x.blendIn } : {}),
        ...(x.source.kind === 'clip' && (x.source.speed || x.source.mirror) ? { speed: x.source.speed ?? 1, mirrored: !!x.source.mirror } : {}),
        // (#22, #23: the part of its motion it plays, its repeats, how it plays.)
        ...(x.source.kind === 'clip' && (x.source.from !== undefined || x.source.to !== undefined) ? { plays: [r2(x.source.from ?? 0), x.source.to !== undefined ? r2(x.source.to) : 'end'] } : {}),
        ...(x.source.kind === 'clip' && x.source.repeat ? { repeat: x.source.repeat, ...(x.source.alternate ? { alternate_mirrored: true } : {}) } : {}),
        ...(x.source.kind === 'clip' && x.source.inPlace ? { in_place: true } : {}),
        ...(x.mask ? { plays_on: x.mask } : {}),
        ...(x.strength !== undefined ? { strength: x.strength } : {}),
        ...(x.reactsTo ? { reacts_to: x.reactsTo } : {}),
        ...(!x.layer && x.source.kind !== 'keys' ? { marks: x.roles.map((r) => { const m = marksOf(s, x, r.figure)?.end; return m && { x: r2(m.at[0]), z: r2(m.at[1]), facing: r1(m.facing) }; }) } : {}),
        ...(x.prop ? { prop: s.props.find((p) => p.id === x.prop)?.name } : {}),
      })),
      holds: (a.constraints ?? []).map((c) => ({ id: c.id, figure: s.figures.find((f) => f.id === c.figure)?.name, part: c.bone, start: r2(c.start), end: r2(c.end) })),
      // The shots cutting between the scene's cameras.
      shots: shotSpans(a).map((sp) => ({
        name: sp.shot.name, start: r2(sp.start), end: r2(sp.end),
        camera: s.cameras.find((c) => c.id === sp.shot.camera)?.name, ...(sp.shot.blend ? { blend: sp.shot.blend } : {}),
      })),
    } : null,
    // The scene's cameras (a still scene is filmed by the first): what each films, and its rig or its path's points (time, place, look point, lens in mm).
    cameras: s.cameras.map((c) => {
      const who = (id: string | undefined) => (id ? s.figures.find((f) => f.id === id)?.name : undefined);
      return {
        name: c.name, subject: who(c.subject) ?? 'everyone',
        ...(c.kind === 'rig' ? { rig: { ...c.rig, toward: who(c.rig.toward), clear: who(c.rig.clear) } } : {
          anchor: c.anchor, aim: c.aim,
          points: c.points.map((p) => ({ t: r2(p.t), position: p.position.map(r2), look: p.look.map(r2), lens: p.lens })),
        }),
        ...(c.shake ? { shake: c.shake } : {}),
      };
    }),
    settings: projectSettingsOf(store.getState().library),
    joint_limits: store.getState().settings.limits,
  };
}

/** A template by id or (the user's) by name. */
function findTemplate(store: Store, q: string) {
  const all = templatesOf(store.getState().library);
  const t = all.find((x) => x.id === q) ?? all.find((x) => x.name.toLowerCase() === q.trim().toLowerCase());
  if (!t) throw new Error(`No template "${q}". Templates: ${all.map((x) => x.id === x.name ? x.name : `${x.id} (${x.name})`).join(', ')}`);
  return t;
}

const RELATIONS = ['turn_to', 'face_each_other', 'look_at', 'beside_left', 'beside_right', 'back_to_back', 'in_front', 'distance'] as const;

export const TOOLS: AgentTool[] = [
  {
    name: 'get_scene',
    description: 'The open scene: figures (id, name, body, floor position, facing, non-zero joint angles), props, and when animated each person\'s actions (id, what, start and end, where it leaves them: its mark), holds, cameras (their paths or rigs) and the shots cutting between them; and the render style. Call this first and after big changes.',
    schema: obj({}),
    run: (store) => JSON.stringify(sceneSummary(store)),
  },
  {
    name: 'set_joints',
    description: 'Rotate joints of a figure (degrees, absolute). Unlisted joints keep their angles. While an animation is open, this keys the pose at the playhead on the figure\'s track (over a motion or a walk: a correction to it).',
    schema: obj({
      figure: FIGURE,
      joints: {
        type: 'array',
        items: obj({ joint: str('Joint', JOINTS), x: num('X rotation (degrees)'), y: num('Y rotation (degrees)'), z: num('Z rotation (degrees)') }),
      },
    }),
    run: (store, i) => {
      const f = findFigure(store, i.figure);
      const limits = store.getState().settings.limits;
      const clamped: string[] = [];
      const joints: Angles = {};
      for (const j of i.joints as { joint: JointName; x: number; y: number; z: number }[]) {
        if (!JOINTS.includes(j.joint)) throw new Error(`Unknown joint "${j.joint}"`);
        const v: Vec3 = [j.x, j.y, j.z].map(r1) as Vec3;
        const c = limits && j.joint !== 'hips' ? clampRotation(j.joint, v) : v;
        if (c.some((x, k) => x !== v[k])) clamped.push(`${j.joint} → [${c.join(', ')}]`);
        joints[j.joint] = c;
      }
      store.updateFigure(f.id, (x) => ({ ...x, bones: withAngles(x.bones, joints) }));
      return `Set ${(i.joints as unknown[]).length} joints on ${f.name}.${clamped.length ? ` Clamped to natural limits: ${clamped.join('; ')}.` : ''}`;
    },
  },
  {
    name: 'set_hands',
    description: 'Shape a figure\'s hands with a preset.',
    schema: obj({ figure: FIGURE, side: str('Which hand', ['left', 'right', 'both']), preset: str('Hand shape', HAND_PRESETS.map((p) => p.name)) }),
    run: (store, i) => {
      const f = findFigure(store, i.figure);
      const p = HAND_PRESETS.find((h) => h.name === i.preset);
      if (!p) throw new Error(`Unknown hand preset "${i.preset}"`);
      const sides = i.side === 'both' ? (['L', 'R'] as const) : i.side === 'left' ? (['L'] as const) : (['R'] as const);
      store.updateFigure(f.id, (x) => ({ ...x, hands: { ...x.hands, ...Object.fromEntries(sides.map((s) => [s, cloneHand(p.hand)])) } }));
      return `${f.name}: ${i.side} hand ${p.name.toLowerCase()}.`;
    },
  },
  {
    name: 'move_to',
    description: 'Walk, run or jump a figure from where it is at the playhead to a floor point, as part of the animation (it is animated if needed). The steps are generated (no sliding), the time is set from the distance, what the figure does after moves on, and the playhead goes to the arrival, so calls chain into a route. Walking and running face the way they go unless keep_facing (side steps, backing up). A jump keeps the facing; give its height (m) and turns in the air: spin (turns about the vertical, e.g. 1) and flip (1 front flip, -1 back flip). Jumps can land on top of props.',
    schema: obj({
      figure: FIGURE,
      x: num('Floor X (metres)'),
      z: num('Floor Z (metres)'),
      how: str('How it gets there', ['walk', 'run', 'jump']),
      keep_facing: opt(bool('Keep its facing (side step or back up) instead of facing the way it goes')),
      height: opt(num('Jump height in metres (default 0.45)')),
      spin: opt(num('Jump: turns about the vertical (0.5, 1, 2)')),
      flip: opt(num('Jump: 1 front flip, -1 back flip')),
    }),
    run: (store, i) => {
      const f = findFigure(store, i.figure);
      const how = i.how as Travel;
      const span = travelTo(store, f.id, [Number(i.x), Number(i.z)], how, {
        strafe: i.keep_facing === true,
        height: typeof i.height === 'number' ? Math.min(1.6, Math.max(0.1, i.height)) : undefined,
      });
      if (!span) throw new Error(`No figure "${i.figure}"`);
      if (how === 'jump' && (i.spin || i.flip)) setTravel(store, f.id, span.to, 'jump', { spin: Number(i.spin) || 0, flip: Number(i.flip) || 0 });
      return `${f.name} ${how === 'walk' ? 'walks' : how === 'run' ? 'runs' : 'jumps'} to (${r2(Number(i.x))}, ${r2(Number(i.z))}) from ${r2(span.from)} s to ${r2(span.to)} s.`;
    },
  },
  {
    name: 'turn_to',
    description: 'Turn a figure from the playhead to face another figure, a prop, or a floor point, stepping round where it stands (no sliding); the playhead goes to where it has turned.',
    schema: obj({
      figure: FIGURE,
      toward: opt(str('The figure or prop to face (by name)')),
      x: opt(num('Or a floor X to face (metres)')),
      z: opt(num('Floor Z (metres)')),
    }),
    run: (store, i) => {
      const f = findFigure(store, i.figure);
      let at: [number, number];
      if (i.toward) {
        const t = store.getState().time;
        const other = store.scene.figures.find((x) => x.name.toLowerCase() === String(i.toward).toLowerCase());
        const where = other ? figurePoseAt(store.scene, other.id, t)?.position : propNow(store, findProp(store, i.toward).id)?.position;
        if (!where) throw new Error(`No "${i.toward}" to face`);
        at = [where[0], where[2]];
      } else at = [Number(i.x), Number(i.z)];
      if (!turnTo(store, f.id, at)) return `${f.name} already faces that way.`;
      return `${f.name} turns to face ${i.toward ?? `(${r2(at[0])}, ${r2(at[1])})`}; the playhead is at ${r2(store.getState().time)} s.`;
    },
  },
  {
    name: 'strike',
    description: 'One figure strikes another from the playhead, as a fight is staged: it steps (or runs) in to where the blow reaches, turned so that it lands, and the one struck reacts as it lands. The playhead goes to the moment it lands; chain strikes and answers from there.',
    schema: obj({
      figure: FIGURE,
      target: str('The figure struck (by name)'),
      blow: str('The strike', ['jab_cross', 'hook_punch', 'uppercut', 'roundhouse_kick']),
    }),
    run: (store, i) => {
      const f = findFigure(store, i.figure);
      const them = findFigure(store, i.target);
      const id = `library:${String(i.blow).replace('_', '-')}`;
      const lands = strikeFigure(store, f.id, them.id, id);
      if (lands === null) throw new Error(`${f.name} cannot strike ${them.name} with ${i.blow} (not at hand, or the same person)`);
      return `${f.name}'s ${String(i.blow).replace('_', ' ')} lands on ${them.name} at ${r2(lands)} s; they react.`;
    },
  },
  {
    name: 'place_figure',
    description: 'Move a figure on the floor and/or turn it. Null keeps the current value. In an animation this moves everything the figure does (its poses and marks: staging); set animate_move to true to key the new place at the playhead only, so the figure travels there.',
    schema: obj({ figure: FIGURE, x: opt(num('Floor X (metres)')), z: opt(num('Floor Z (metres)')), facing: opt(num('Facing (degrees)')), animate_move: { type: ['boolean', 'null'] } }),
    run: (store, i) => {
      const f = findFigure(store, i.figure);
      const p = { x: (i.x as number | null) ?? undefined, z: (i.z as number | null) ?? undefined, yaw: (i.facing as number | null) ?? undefined };
      const a = store.scene.animation;
      if (a && !i.animate_move && actionsOf(a, f.id).length) {
        // Shift the whole track: every key and mark moves and turns by the same amount.
        const dyaw = p.yaw === undefined ? 0 : p.yaw - facing(f);
        store.group(() => {
          offsetPerformance(store, [f.id], { turn: dyaw });
          const g = findFigure(store, f.id);
          offsetPerformance(store, [f.id], { dx: p.x === undefined ? 0 : p.x - g.position[0], dz: p.z === undefined ? 0 : p.z - g.position[2] });
        });
      } else {
        setPlacement(store, f.id, p);
      }
      const g = findFigure(store, f.id);
      return `${g.name} at x ${r2(g.position[0])}, z ${r2(g.position[2])}, facing ${r1(facing(g))}°${a ? (i.animate_move ? ' (keyed at the playhead)' : ' (in every key)') : ''}.`;
    },
  },
  {
    name: 'relate',
    description: 'Arrange one figure relative to another: turn_to, face_each_other (turns both), look_at (head and chest), beside_left/beside_right (stand at the other\'s left/right), back_to_back, in_front, or distance (metres, moves `figure`).',
    schema: obj({ figure: FIGURE, other: str('The other figure (id or name)'), action: str('Relation', RELATIONS), distance: opt(num('Metres, for "distance"')) }),
    run: (store, i) => {
      const a = findFigure(store, i.figure);
      const b = findFigure(store, i.other);
      const how = i.action as (typeof RELATIONS)[number];
      if (how === 'look_at') lookAtFigure(store, a.id, b.id);
      else if (how === 'distance') setDistance(store, a.id, b.id, Math.max(0.2, Number(i.distance ?? 1)));
      else arrange(store, a.id, b.id, ({ turn_to: 'face', face_each_other: 'faceEachOther', beside_left: 'besideL', beside_right: 'besideR', back_to_back: 'backToBack', in_front: 'inFront' } as const)[how]);
      return `${a.name} ${how.replace(/_/g, ' ')} ${b.name}.`;
    },
  },
  {
    name: 'reach',
    description: 'Put a figure\'s hand on a part of another figure, or of itself (other = the same figure: hands on hips, on knees, on the chest…). The arm is solved with IK, so use this rather than guessing arm angles for contacts.',
    schema: obj({ figure: FIGURE, hand: str('Which hand', ['left', 'right']), other: str('The other figure (id or name)'), target: str('Where', CONTACTS) }),
    run: (store, i) => {
      const a = findFigure(store, i.figure);
      const b = findFigure(store, i.other);
      const ok = reachFor(store, a.id, i.hand === 'left' ? 'L' : 'R', b.id, i.target as Contact);
      if (ok) return `${a.name}'s ${i.hand} hand is on ${a.id === b.id ? 'its own' : `${b.name}'s`} ${i.target}.`;
      return a.id === b.id
        ? `${a.name} cannot reach its own ${i.target} in this pose; the arm stretches towards it. Lean or bend the body towards it (root, spine, chest), then reach again.`
        : `${a.name} cannot reach ${b.name}'s ${i.target} from there; the arm stretches towards it. Move them closer.`;
    },
  },
  {
    name: 'add_figure',
    description: 'Add a posable figure, or a capsule stand-in (for blocking extras: stand, sit or lie). Returns its id.',
    schema: obj({
      kind: str('Figure or stand-in', ['figure', 'stand_in']),
      name: opt(str('Name')),
      body: opt(str('Body type', BODY_PRESETS.map((p) => p.name))),
      posture: opt(str('Stand-in posture', POSTURES)),
      x: opt(num('Floor X (metres)')),
      z: opt(num('Floor Z (metres)')),
    }),
    run: (store, i) => {
      const standIn = i.kind === 'stand_in';
      const body = BODY_PRESETS.find((p) => p.name === i.body)?.body;
      const xs = store.scene.figures.map((f) => f.position[0]);
      const n = store.scene.figures.filter((f) => !!f.proxy === standIn).length + 1;
      // One commit, so one undo removes it.
      let f = newFigure({
        name: i.name ? String(i.name).slice(0, 40) : `${standIn ? 'Stand-in' : 'Figure'} ${n}`,
        position: [(i.x as number | null) ?? (xs.length ? Math.max(...xs) + 0.8 : 0), 0, (i.z as number | null) ?? 0],
        ...(body ? { body: { ...body } } : {}),
      });
      if (standIn) f = withPosture(f, (i.posture as Posture | null) ?? 'stand');
      addFigures(store, [f]);
      return `Added ${f.name} (${f.id}) at x ${r2(f.position[0])}, z ${r2(f.position[2])}.`;
    },
  },
  {
    name: 'remove_figure',
    description: 'Delete a figure (a pose keeps at least one).',
    schema: obj({ figure: FIGURE }),
    run: (store, i) => {
      const f = findFigure(store, i.figure);
      if (!deleteFigure(store, f.id)) throw new Error('A pose needs at least one figure');
      return `Removed ${f.name}.`;
    },
  },
  {
    name: 'add_prop',
    description: 'Add a prop, optionally named (e.g. "Desk"): on the floor (box, ball, cylinder, chair, stool, step, wall), or in a figure\'s hand (stick, phone, cup, book, ball, box: give held_by and hand; it follows the hand). Returns its id.',
    schema: obj({
      kind: str('Prop', PROP_KINDS),
      x: num('Floor X (metres; ignored when held)'),
      z: num('Floor Z (metres; ignored when held)'),
      facing: opt(num('Facing (degrees)')),
      name: opt(str('Name shown in the scene outline')),
      held_by: opt(str('Figure id or name whose hand holds it')),
      hand: opt(str('Which hand holds it', ['L', 'R'])),
    }),
    run: (store, i) => {
      const kind = i.kind as PropKind;
      const name = nextName(typeof i.name === 'string' && i.name.trim() ? i.name.trim().slice(0, 60) : PROP_LABELS[kind], store.scene.props.map((p) => p.name));
      const prop = { ...newProp(kind, [Number(i.x), 0, Number(i.z)], name), rotation: [0, Number(i.facing ?? 0), 0] as Vec3 };
      const holder = i.held_by ? findFigure(store, i.held_by) : null;
      store.updateScene((s) => ({ ...s, props: [...s.props, prop] }));
      if (!holder) return `Added ${prop.name} (${prop.id}).`;
      const hand = i.hand === 'L' ? 'L' : 'R';
      holdProp(store, prop.id, { figure: holder.id, hand });
      return `Added ${prop.name} (${prop.id}) in ${holder.name}'s ${hand === 'L' ? 'left' : 'right'} hand.`;
    },
  },
  {
    name: 'edit_shot',
    description: 'A shot (the one playing at a time): its name and caption, which camera films it (one of the scene\'s cameras by name, or "new": a new camera from where the view is now), and how long it blends in from the shot before (s; 0 cuts). Cut shots first (cut_shot). Null leaves a setting as it is.',
    schema: obj({
      time: num('A time inside the shot (s)'),
      name: opt(str('Name')),
      caption: opt(str('What happens in it')),
      camera: opt(str('The camera filming it: a camera\'s name, or "new"')),
      blend: opt(num('Seconds it blends in from the shot before (0: a cut)')),
    }),
    run: (store, i) => {
      const a = store.scene.animation;
      if (!a) throw new Error('The scene is not animated');
      store.setTime(Math.max(0, Math.min(a.duration, Number(i.time))));
      const span = spanAt(a, store.getState().time);
      if (typeof i.camera === 'string') {
        const named = store.scene.cameras.find((c) => c.name.toLowerCase() === String(i.camera).toLowerCase());
        if (i.camera === 'new') addCamera(store);
        else if (named) editShot(store, span.shot.id, { camera: named.id });
        else throw new Error(`No camera called ${i.camera}. Cameras: ${store.scene.cameras.map((c) => c.name).join(', ')}`);
      }
      editShot(store, span.shot.id, {
        ...(typeof i.name === 'string' ? { name: i.name.slice(0, 80) } : {}),
        ...(typeof i.caption === 'string' ? { caption: i.caption.slice(0, 500) } : {}),
        ...(typeof i.blend === 'number' ? { blend: i.blend } : {}),
      });
      const now = shotSpans(store.scene.animation!).find((x) => x.shot.id === span.shot.id)!;
      return `${now.shot.name}: ${now.start.toFixed(2)}–${now.end.toFixed(2)} s, filmed by ${store.scene.cameras.find((c) => c.id === now.shot.camera)?.name}${now.shot.blend ? `, blending in over ${now.shot.blend} s` : ', cut in'}.`;
    },
  },
  {
    name: 'edit_camera',
    description: `A camera of the scene: by name, or the one filming at a time (a still scene: its first). Whom it films (a figure, or null for everyone). Its shot size (${SHOT_SIZES.map((x) => `${x.id} = ${x.name}`).join(', ')}), where the subject sits (centre, left or right third) and lens (mm, full frame: 14 wide … 50 normal … 200 telephoto). A camera frames its subject every frame (its angle: degrees from the subject's front, + from its left; its height: degrees above; turning with it if turn) and moves over each shot it films: move none (holds the framing), push (to move_size), arc (move_amount degrees round), crane (degrees up, − down), truck (metres sideways), pan (to move_to, a figure, or move_amount degrees), tilt (degrees up), zoom or dolly (the lens it ends at, mm; a dolly keeps the size: a dolly zoom), roll (degrees); any move may also end at move_size; pace smooth, even or snap (holds, then fast). Or path: a custom path of keyed points (one way; size and lens then key a point at the time, which must be in a shot it films; anchor world or subject, aim subject, point or path). Hand-held shake (0–1). It changes every shot it films. Null leaves a setting as it is.`,
    schema: obj({
      camera: opt(str('The camera\'s name (null: the one filming at time)')),
      time: num('A time (s): which camera, if none is named; and where a path camera is keyed (a still scene: 0)'),
      subject: opt(FIGURE),
      everyone: opt(bool('ProjectSettings everyone (no subject)')),
      size: opt(str('Shot size', SHOT_SIZES.map((x) => x.id))),
      place: opt(str('Where the subject sits in the frame', ['center', 'left', 'right'])),
      lens: opt(num('Focal length (mm)')),
      move: opt(str('How it moves over a shot', ['none', ...MOVE_KINDS, 'path'])),
      move_amount: opt(num('The move: degrees (arc, crane, pan, tilt, roll), metres (truck), the end lens in mm (zoom, dolly)')),
      move_size: opt(str('The size the move ends at', SHOT_SIZES.map((x) => x.id))),
      move_to: opt(FIGURE),
      pace: opt(str('How the move goes', ['smooth', 'even', 'snap'])),
      angle: opt(num('Degrees around from the subject\'s front, + from its left')),
      height: opt(num('Degrees above the subject')),
      turn: opt(bool('Turn as the subject turns')),
      anchor: opt(str('Path: where it is', ['world', 'subject'])),
      aim: opt(str('Path: what it looks at', ['subject', 'point', 'path'])),
      shake: opt(num('Hand-held shake, 0–1')),
    }),
    run: (store, i) => {
      const a = store.scene.animation;
      if (a) store.setTime(Math.max(0, Math.min(a.duration, Number(i.time))));
      const t = a ? store.getState().time : 0;
      const named = typeof i.camera === 'string' ? store.scene.cameras.find((c) => c.name.toLowerCase() === String(i.camera).toLowerCase()) : null;
      if (typeof i.camera === 'string' && !named) throw new Error(`No camera called ${i.camera}. Cameras: ${store.scene.cameras.map((c) => c.name).join(', ')}`);
      const id = named?.id ?? liveCamera(store.scene, t).id;
      const cam = () => store.scene.cameras.find((c) => c.id === id)!;
      if (i.subject || i.everyone) editCamera(store, id, { subject: i.everyone ? '' : findFigure(store, i.subject).id });
      if (i.move === 'path') editAsPath(store, id);
      else if (i.move === 'none') setCameraMove(store, id, null);
      else if (i.move) {
        setCameraMove(store, id, {
          kind: i.move as MoveKind,
          ...(typeof i.move_amount === 'number' ? { by: i.move_amount } : {}),
          ...(i.move_size ? { size: i.move_size as ShotSize } : {}),
          ...(i.move_to ? { to: findFigure(store, i.move_to).id } : {}),
          ...(i.pace === 'even' || i.pace === 'snap' ? { pace: i.pace } : {}),
        });
      }
      if (i.anchor || i.aim || typeof i.shake === 'number') {
        editCamera(store, id, { ...(i.anchor ? { anchor: i.anchor as PathCamera['anchor'] } : {}), ...(i.aim ? { aim: i.aim as PathCamera['aim'] } : {}), ...(typeof i.shake === 'number' ? { shake: Math.min(1, Math.max(0, i.shake)) } : {}) });
      }
      const lens = typeof i.lens === 'number' ? Math.min(400, Math.max(8, i.lens)) : undefined;
      const place = (i.place as Placement | null) ?? undefined;
      const c = cam();
      if (c.kind === 'rig') {
        if (typeof i.angle === 'number' || typeof i.height === 'number' || typeof i.turn === 'boolean' || i.size || place || lens) {
          editRig(store, id, {
            ...(typeof i.angle === 'number' ? { yaw: i.angle } : {}), ...(typeof i.height === 'number' ? { pitch: i.height } : {}), ...(typeof i.turn === 'boolean' ? { turn: i.turn } : {}),
            ...(i.size ? { size: i.size as ShotSize } : {}), ...(place ? { place } : {}), ...(lens ? { lens } : {}),
          });
        }
      } else {
        if (typeof i.angle === 'number' || typeof i.height === 'number' || typeof i.turn === 'boolean') throw new Error('Angles are for a camera that frames its subject (move: none or a move, not path)');
        if (i.size || lens) {
          if (liveCamera(store.scene, t)?.id !== id) throw new Error(`${cam().name} does not film at ${r2(t)} s: give a time in a shot it films`);
          if (i.size) frameShot(store, i.size as ShotSize, { lens, place });
          else if (lens) setLens(store, lens, 'size');
        }
      }
      const now = cam();
      const how = now.kind === 'rig'
        ? rigRule(store.scene, now)
        : `a path of ${now.points.length} point${now.points.length === 1 ? '' : 's'}`;
      return `${now.name}: ${how}.`;
    },
  },
  {
    name: 'set_lighting',
    description: `Light the open scene (saved with it, used by its exports; shows in the lit styles): a lighting scheme (${LIGHTING_PRESETS.map((p) => p.id).join(', ')}); the look as a whole (contrast: key to fill, e.g. 2 soft … 8 dramatic; rim: the rim light's strength, 0 none); where it is lit (indoors or not; time of day in hours and the weather, which set the sun and the sky outdoors); and/or one light added or changed. Lights have roles: the key (the only one with shadows, fixed in the scene), a fill and a rim (placed for each shot's camera: their direction is degrees from the camera), practicals (a set's lamps and windows), follow lights. A light is a sun (a direction), a lamp (a place in the scene, reaching so far; a spot aimed at the people) or a window. \`light\` names the one to change (as listed, e.g. "Key light", "Fill light"; none: the key), or with \`add\` the kind to add (sun, lamp, window) or a light put as a fill or a rim (fill, rim). Then direction (degrees round, 0 = from the front) and height (degrees up), brightness (1 normal) and colour temperature (kelvin, 1800 candle … 6500 white … 10000 blue sky).`,
    schema: obj({
      preset: opt(str('Lighting scheme', LIGHTING_PRESETS.map((p) => p.id))),
      add: opt(str('Add a light', ['sun', 'lamp', 'window', 'fill', 'rim'])),
      light: opt(str('The light to change, by its name')),
      direction: opt(num('Degrees round the people, 0 = from the front')),
      height: opt(num('Degrees above the floor')),
      brightness: opt(num('1 is normal')),
      kelvin: opt(num('Colour temperature, 1800 … 10000')),
      contrast: opt(num('Key to fill, e.g. 2 … 8')),
      rim: opt(num('The rim light\'s strength, 0 none')),
      indoors: opt(bool('Lit indoors (no sun; the set casts none of the key\'s shadows)')),
      time: opt(num('Time of day in hours, 0 … 24 (outdoors)')),
      weather: opt(str('Weather (outdoors)', ['clear', 'overcast'])),
    }),
    run: (store, i) => {
      if (typeof i.preset === 'string') applyLightingPreset(store, i.preset);
      const env = { ...(typeof i.indoors === 'boolean' ? { indoors: i.indoors } : {}), ...(typeof i.time === 'number' ? { time: i.time } : {}), ...(typeof i.weather === 'string' ? { weather: i.weather } : {}) };
      if (Object.keys(env).length) setEnvironment(store, env);
      if (typeof i.contrast === 'number' || typeof i.rim === 'number') {
        setLook(store, { ...(typeof i.contrast === 'number' ? { contrast: Math.min(16, Math.max(1, i.contrast)) } : {}), ...(typeof i.rim === 'number' ? { rim: Math.min(3, Math.max(0, i.rim)) } : {}) });
      }
      let id: string | null = null;
      if (typeof i.add === 'string') {
        id = addLight(store, i.add as LightKind | Place);
        if (!id) throw new Error(`The scene has ${MAX_LIGHTS} lights already: none can be added`);
      } else if (typeof i.light === 'string') {
        const want = i.light.toLowerCase();
        id = lightingOf(store.scene).lights.find((l) => l.name.toLowerCase() === want || l.id === i.light)?.id ?? null;
        if (!id) throw new Error(`No light called ${i.light}: ${lightingOf(store.scene).lights.map((l) => l.name).join(', ')}`);
      } else id = keyLight(lightingOf(store.scene))?.id ?? null;
      const n = (v: unknown) => (typeof v === 'number' ? v : undefined);
      const l = lightingOf(store.scene).lights.find((x) => x.id === id);
      if (l) {
        let next = { ...l };
        // (A fill's or a rim's for the shot: degrees from the camera.)
        if (l.relative) next = { ...next, ...(n(i.direction) !== undefined ? { azimuth: Math.abs(n(i.direction)!) } : {}), ...(n(i.height) !== undefined ? { elevation: n(i.height)! } : {}) };
        else if (n(i.direction) !== undefined || n(i.height) !== undefined) {
          next = lightFrom(next, towards(n(i.direction) ?? next.azimuth, n(i.height) ?? next.elevation), subjectOf(store.scene));
        }
        if (n(i.brightness) !== undefined) next.intensity = n(i.brightness)!;
        if (n(i.kelvin) !== undefined) Object.assign(next, { kelvin: n(i.kelvin), color: kelvinColor(n(i.kelvin)!) });
        editLight(store, l.id, next);
      }
      const now = lightingOf(store.scene);
      const e = now.environment ?? {};
      const where = e.indoors ? 'indoors' : `outdoors${e.time !== undefined ? ` at ${r2(e.time)} h` : ''}${e.weather ? `, ${e.weather}` : ''}`;
      return `Lighting: ${lightingName(now)}, ${where}; ${now.lights.map((x) => `${x.name} (${x.kind}${x.role ? `, ${x.role}` : ''}) ${x.relative ? `${Math.round(x.azimuth)}° from the shot's camera` : lightText(x).toLowerCase()}, brightness ${r2(x.intensity)}${x.kelvin ? `, ${x.kelvin} K` : `, ${x.color}`}`).join('; ')}.`;
    },
  },
  {
    name: 'keep_eyes_on',
    description: 'Make a figure keep its eyes on another figure or a prop all the time (its head and neck turn to follow it, even as things move), or with target null free its head again.',
    schema: obj({ figure: FIGURE, target: opt(str('Figure or prop (id or name) to look at')) }),
    run: (store, i) => {
      const f = findFigure(store, i.figure);
      if (!i.target) {
        setGaze(store, f.id, null);
        return `${f.name} looks where posed.`;
      }
      const ref = String(i.target).toLowerCase();
      const other = store.scene.figures.find((x) => x.id === i.target || x.name.toLowerCase() === ref);
      if (other) {
        setGaze(store, f.id, { figure: other.id });
        return `${f.name} keeps its eyes on ${other.name}.`;
      }
      const p = findProp(store, i.target);
      setGaze(store, f.id, { prop: p.id });
      return `${f.name} keeps its eyes on ${p.name}.`;
    },
  },
  {
    name: 'set_figure_color',
    description: `Tint a figure to tell it apart (teams, sides): one of ${FIGURE_COLORS.join(', ')}, or null for none.`,
    schema: obj({ figure: FIGURE, color: opt(str('Colour', FIGURE_COLORS)) }),
    run: (store, i) => {
      const f = findFigure(store, i.figure);
      setFigureColor(store, f.id, typeof i.color === 'string' ? i.color : null);
      return `${f.name} ${i.color ? `tinted ${i.color}` : 'untinted'}.`;
    },
  },
  {
    name: 'throw_prop',
    description: 'Throw, pass, shoot or dribble a prop from the hand holding it at the playhead (animated; the arms do it from the waist up): into another figure\'s hand (to_figure and hand: a pass, caught if the hand can reach it then), into the thrower\'s own hand (tossed up and caught), at a basketball hoop (hoop: through it, or off the rim with miss), to a floor point (x, z), or bounced (dribble: bounces times). It flies with physics; the playhead goes to the arrival. Put it in a hand first with add_prop held_by or hold_prop.',
    schema: obj({
      prop: str('Prop id or name'),
      to_figure: opt(FIGURE),
      hand: opt(str('Catching hand', ['L', 'R'])),
      hoop: opt(str('Basketball hoop prop (id or name)')),
      miss: opt(bool('At a hoop: off the rim')),
      dribble: opt(num('Bounces, to dribble')),
      x: opt(num('Floor X')),
      z: opt(num('Floor Z')),
    }),
    run: (store, i) => {
      const p = findProp(store, i.prop);
      const holder = propNow(store, p.id)?.hold;
      if (!holder) throw new Error(`${p.name} is not in anyone's hand at ${r2(store.getState().time)} s`);
      if (typeof i.dribble === 'number') {
        const d = dribbleProp(store, p.id, Math.max(1, Math.round(i.dribble)));
        if (!d) throw new Error(`Could not dribble ${p.name}`);
        return `${p.name} dribbled ${Math.round(i.dribble)} times, to ${r2(d.to)} s.`;
      }
      const target = i.hoop
        ? { hoop: findProp(store, i.hoop).id, ...(i.miss ? { miss: true } : {}) }
        : i.to_figure ? { figure: findFigure(store, i.to_figure).id, hand: (i.hand === 'L' ? 'L' : 'R') as Side } : { at: [Number(i.x ?? 0), Number(i.z ?? 0)] as [number, number] };
      const span = throwProp(store, p.id, target);
      if (!span) throw new Error(`Could not throw ${p.name}`);
      const missed = missedCatchesOf(store.scene).some((m) => m.prop === p.id && m.t > span.from);
      return `${p.name} let go at ${r2(span.from)} s, arriving at ${r2(span.to)} s${missed ? ' (out of reach of the catch: move them closer or the time)' : ''}.`;
    },
  },
  {
    name: 'hold_prop',
    description: 'Put a prop in a figure\'s hand (it grips it; animated: from the playhead on), or with figure null let it go (animated: it falls from the hand).',
    schema: obj({ prop: str('Prop id or name'), figure: opt(FIGURE), hand: opt(str('Hand', ['L', 'R'])) }),
    run: (store, i) => {
      const p = findProp(store, i.prop);
      if (!i.figure) {
        holdProp(store, p.id, null);
        return `${p.name} let go.`;
      }
      const f = findFigure(store, i.figure);
      holdProp(store, p.id, { figure: f.id, hand: i.hand === 'L' ? 'L' : 'R' });
      return `${p.name} in ${f.name}'s ${i.hand === 'L' ? 'left' : 'right'} hand.`;
    },
  },
  {
    name: 'remove_prop',
    description: 'Delete a prop by id.',
    schema: obj({ prop: str('Prop id') }),
    run: (store, i) => {
      if (!store.scene.props.some((p) => p.id === i.prop)) throw new Error(`No prop "${i.prop}"`);
      deleteProp(store, String(i.prop));
      return 'Removed the prop.';
    },
  },
  {
    name: 'new_scene',
    description: `Start a new scene in the project and open it: blank, or from a scene template (a cast, a set and what they do, no cameras): ${SCENE_TEMPLATES.map((t) => `${t.id} = ${t.name}`).join(', ')}; or one of the user's saved templates by name; or a shoot preset, a template already filmed with a coverage (cameras and cuts): ${SHOOT_PRESETS.map((p) => `${p.id} = ${p.name}`).join(', ')}, or one of the user's own shoot presets by name.`,
    schema: obj({ template: str('"blank", a template or shoot preset id, or a saved template\'s or shoot preset\'s name'), name: opt(str('Name for the scene')) }),
    run: (store, i) => {
      const id = String(i.template);
      const shoots = shootsOf(store.getState().library);
      const preset = shoots.find((p) => p.id === id) ?? shoots.find((p) => p.name.toLowerCase() === id.trim().toLowerCase());
      if (preset) {
        newShoot(store, preset.id);
        if (i.name) store.updateScene((s) => ({ ...s, name: String(i.name).slice(0, 80) }));
        return `Opened "${store.scene.name}", filmed in ${shotSpans(store.scene.animation!).length} shots. ${JSON.stringify(sceneSummary(store))}`;
      }
      const scene = id === 'blank' ? newScene() : findTemplate(store, id).build();
      addScene(store, i.name ? { ...scene, name: String(i.name).slice(0, 80) } : scene);
      return `Opened "${store.scene.name}". ${JSON.stringify(sceneSummary(store))}`;
    },
  },
  {
    name: 'use_template',
    description: 'Put a scene template into the open scene at the playhead: its first role taken by the figure given (where it stands, facing its way), the others by the figures nearest it, new figures for the rest; its props and actions come too. Templates as for new_scene.',
    schema: obj({ template: str('A template id, or a saved template\'s name'), figure: opt(FIGURE) }),
    run: (store, i) => {
      const t = findTemplate(store, String(i.template));
      const lead = i.figure ? findFigure(store, i.figure).id : undefined;
      const cast = placeTemplate(store, t.id, lead)!;
      return `${t.name}: ${cast.map((id) => store.scene.figures.find((f) => f.id === id)?.name).join(', ')}. ${JSON.stringify(sceneSummary(store))}`;
    },
  },
  {
    name: 'apply_pose',
    description: `Put a pose from the library on a figure (it keeps its place and facing; keyed at the playhead when animated). A quick start before refining with set_joints and reach. Built-in poses: ${builtInPoses().map((p) => p.name).join('; ')}; plus the user's saved poses by name.`,
    schema: obj({ figure: FIGURE, pose: str('Pose name') }),
    run: (store, i) => {
      const f = findFigure(store, i.figure);
      const q = String(i.pose).trim().toLowerCase();
      const pose = allPoses(store.getState().library).find((p) => p.name.toLowerCase() === q) ?? allPoses(store.getState().library).find((p) => p.name.toLowerCase().includes(q));
      if (!pose) throw new Error(`No pose "${i.pose}"`);
      applyPose(store, f.id, pose.id);
      return `${f.name}: ${pose.name}.`;
    },
  },
  {
    name: 'apply_motion',
    description: `Give a figure a motion from the library, on its track from the playhead (the scene is animated if needed), starting where it stands and facing its way: ${MOTIONS.map((m) => `${m.id} = ${m.name}`).join(', ')}; plus the user's imported motions by name. A motion is one person's: for people together, give each their own (and place them with arrange or set_distance).`,
    schema: obj({ figure: FIGURE, motion: str('Motion id, or the name of an imported motion') }),
    run: (store, i) => {
      const f = findFigure(store, i.figure);
      const q = String(i.motion).trim().toLowerCase();
      const mine = store.getState().library.clips ?? [];
      const motion = MOTIONS.find((m) => m.id === q) ?? mine.find((m) => m.name.toLowerCase() === q) ?? mine.find((m) => m.name.toLowerCase().includes(q));
      if (!motion) throw new Error(`No motion "${i.motion}"`);
      const from = store.scene.animation ? store.getState().time : 0;
      if (!applyMotion(store, f.id, motion.id)) throw new Error(`${motion.name} is for several people: give each their own motion`);
      const a = store.scene.animation!;
      return `${f.name}: ${motion.name} from ${r2(from)} s (animation ${a.duration} s).`;
    },
  },
  {
    name: 'edit_action',
    description: 'Change one action (by id, from get_scene): when it starts (what that person does after moves along), how long it takes (a motion plays faster or slower, a walk takes longer), the part of its motion it plays (plays_from / plays_to, seconds of the motion: trimmed), how long it blends in from what came before, a motion\'s speed or mirroring (left for right), whether it plays in place (its travel taken out), every other repeat mirrored, what a motion over another plays on and how strongly; split it in two at a time; or remove it.',
    schema: obj({
      action: str('Action id'),
      start: opt(num('Start (s)')),
      duration: opt(num('Length (s)')),
      plays_from: opt(num('The part of its motion it plays: from (seconds of the motion)')),
      plays_to: opt(num('The part of its motion it plays: to (seconds of the motion)')),
      blend_in: opt(num('Blend in (s)')),
      speed: opt(num('A motion\'s speed (1 as made)')),
      mirrored: opt(bool('A motion mirrored left for right')),
      in_place: opt(bool('A motion\'s travel taken out: it stays where it starts')),
      alternate_mirrored: opt(bool('A repeated motion: every other repeat mirrored')),
      plays_on: opt(str('A motion over another: "upper body", "arms", "head" or "legs"')),
      strength: opt(num('A motion over another, or a correction: how much of it shows (0–1)')),
      split_at: opt(num('Split it in two at this time (s)')),
      remove: opt(bool('Remove the action')),
    }),
    run: (store, i) => {
      const act = store.scene.animation?.actions.find((x) => x.id === i.action);
      if (!act) throw new Error(`No action "${i.action}": get_scene lists them`);
      const label = actionLabel(act);
      if (i.remove) {
        deleteAction(store, act.id);
        return `Removed ${label}.`;
      }
      if (typeof i.start === 'number') moveAction(store, act.id, i.start);
      if (typeof i.duration === 'number') retime(store, act.id, i.duration);
      if (typeof i.blend_in === 'number') setBlend(store, act.id, i.blend_in);
      if (typeof i.speed === 'number' || typeof i.mirrored === 'boolean') setClipOptions(store, act.id, { ...(typeof i.speed === 'number' ? { speed: i.speed } : {}), ...(typeof i.mirrored === 'boolean' ? { mirror: i.mirrored } : {}) });
      if ((typeof i.plays_from === 'number' || typeof i.plays_to === 'number') && act.source.kind === 'clip') {
        const now = store.scene.animation!.actions.find((x) => x.id === act.id)!.source as Extract<Action['source'], { kind: 'clip' }>;
        setPlayRange(store, act.id, typeof i.plays_from === 'number' ? i.plays_from : now.from ?? 0, typeof i.plays_to === 'number' ? i.plays_to : now.to ?? 1e6);
      }
      if (typeof i.in_place === 'boolean' || typeof i.alternate_mirrored === 'boolean') setClipOptions(store, act.id, { ...(typeof i.in_place === 'boolean' ? { inPlace: i.in_place } : {}), ...(typeof i.alternate_mirrored === 'boolean' ? { alternate: i.alternate_mirrored } : {}) });
      if (typeof i.plays_on === 'string' || typeof i.strength === 'number') {
        const mask = i.plays_on === 'arms' || i.plays_on === 'head' || i.plays_on === 'legs' ? i.plays_on : typeof i.plays_on === 'string' ? null : undefined;
        setActionLook(store, act.id, { ...(mask !== undefined ? { mask } : {}), ...(typeof i.strength === 'number' ? { strength: i.strength } : {}) });
      }
      if (typeof i.split_at === 'number') {
        store.setTime(i.split_at);
        const why = splitAt(store, act.id);
        if (why) throw new Error(why);
      }
      const now = store.scene.animation!.actions.find((x) => x.id === act.id)!;
      return `${label}: ${r2(now.start)}–${r2(now.start + now.duration)} s.`;
    },
  },
  {
    name: 'move_mark',
    description: 'Move where an action leaves a figure (its mark: the end of a walk, run or jump, or of a motion) to a floor point. A motion stretches up to ±25% and turns up to ±30° to get there (further, and the answer says so: then walk the rest with move_to).',
    schema: obj({ action: str('Action id'), figure: FIGURE, x: num('Floor X (metres)'), z: num('Floor Z (metres)') }),
    run: (store, i) => {
      const act = store.scene.animation?.actions.find((x) => x.id === i.action);
      if (!act) throw new Error(`No action "${i.action}"`);
      const f = findFigure(store, i.figure);
      if (!act.roles.some((r) => r.figure === f.id)) throw new Error(`${f.name} is not in ${actionLabel(act)}`);
      moveMark(store, f.id, act.start + act.duration, [Number(i.x), Number(i.z)]);
      const now = store.scene.animation!.actions.find((x) => x.id === act.id)!;
      return `${actionLabel(now)} now ends at (${r2(Number(i.x))}, ${r2(Number(i.z))})${overWarp(store.scene, now, f.id) ? ': further than the motion can stretch' : ''}.`;
    },
  },
  {
    name: 'upper_body',
    description: `Play a motion from the waist up over what a figure does at the playhead (waving while walking): ${MOTIONS.filter((m) => !m.travel).map((m) => m.id).join(', ')}. A motion that loops lasts as long as what is under it.`,
    schema: obj({ figure: FIGURE, motion: str('Motion id') }),
    run: (store, i) => {
      const f = findFigure(store, i.figure);
      if (!applyUpperBody(store, f.id, String(i.motion))) throw new Error(`${i.motion} is not a motion for the upper body`);
      return `${f.name}: ${i.motion} from the waist up from ${r2(store.getState().time)} s.`;
    },
  },
  {
    name: 'hold',
    description: 'Contacts held over time, from the playhead (animated): a figure\'s hand on part of another figure (hold_on: it stays on as they move), taking the other end of a long prop someone carries (other_end: a stretcher, a bench), lying on a prop (lie_on: carried with it), sitting on a chair or stool (sit_on: walks to it, turns and sits down), getting up from where it sits (get_up), or letting go of a hold (let_go, by its id from get_scene).',
    schema: obj({
      kind: str('What', ['hold_on', 'other_end', 'lie_on', 'sit_on', 'get_up', 'let_go']),
      figure: opt(FIGURE),
      hand: opt(str('Which hand', ['left', 'right'])),
      other: opt(str('hold_on: the other figure')),
      target: opt(str('hold_on: where', CONTACTS)),
      prop: opt(str('other_end, lie_on, sit_on: the prop')),
      hold: opt(str('let_go: the hold id')),
    }),
    run: (store, i) => {
      if (i.kind === 'let_go') {
        letGo(store, String(i.hold));
        return 'Let go.';
      }
      const f = findFigure(store, i.figure);
      const side: Side = i.hand === 'left' ? 'L' : 'R';
      if (i.kind === 'hold_on') {
        const b = findFigure(store, i.other);
        if (!holdOn(store, f.id, side, b.id, i.target as Contact)) throw new Error(`${f.name} cannot reach ${b.name}'s ${i.target}`);
        return `${f.name}'s ${i.hand} hand holds on to ${b.name}'s ${i.target}.`;
      }
      if (i.kind === 'get_up') {
        if (!standUp(store, f.id)) throw new Error(`${f.name} is not sitting at ${r2(store.getState().time)} s`);
        return `${f.name} gets up; the playhead is at ${r2(store.getState().time)} s.`;
      }
      const p = findProp(store, i.prop);
      if (i.kind === 'sit_on') {
        if (!sitOn(store, f.id, p.id)) throw new Error(`${p.name} is not a chair or a stool to sit on`);
        return `${f.name} walks to ${p.name} and sits down; the playhead is at ${r2(store.getState().time)} s, sitting.`;
      }
      if (i.kind === 'other_end') {
        const why = carryProblem(store, f.id, p.id);
        if (why) throw new Error(why);
        if (!holdHandle(store, f.id, p.id, side)) throw new Error(`${p.name} has no ends to carry it by (a long box does)`);
        return `${f.name} takes the other end of ${p.name}.`;
      }
      lieOn(store, f.id, p.id);
      return `${f.name} lies on ${p.name}.`;
    },
  },
  {
    name: 'draw_as',
    description: `Draw a figure as a character (by name): built in, ${BUILT_IN_CHARACTERS.map((c) => c.name).join('; ')}; or one of the user's imported ones; or with model null as the mannequin. It moves the same either way.`,
    schema: obj({ figure: FIGURE, model: opt(str('Character name')) }),
    run: (store, i) => {
      const f = findFigure(store, i.figure);
      if (!i.model) {
        setFigureModel(store, f.id, null);
        return `${f.name} is drawn as the mannequin.`;
      }
      const models = [...BUILT_IN_CHARACTERS, ...(store.getState().library.models ?? [])];
      const m = models.find((x) => x.name.toLowerCase() === String(i.model).toLowerCase());
      if (!m) throw new Error(`No character "${i.model}". There are: ${models.map((x) => x.name).join('; ')}`);
      setFigureModel(store, f.id, m.id);
      return `${f.name} is drawn as ${m.name}.`;
    },
  },
  {
    name: 'set_style',
    description: 'Render style of the project (the canvas, the storyboard and exports).',
    schema: obj({ style: str('Style', STYLES) }),
    run: (store, i) => {
      editProjectSettings(store, { style: i.style as Style });
      return `Style: ${i.style}.`;
    },
  },
  {
    name: 'animate',
    description: 'Turn the open scene into an animation (if it is not one yet) and/or change its length and looping. Each figure holds its current pose from 0 s.',
    schema: obj({ duration: opt(num('Seconds')), loop: { type: ['boolean', 'null'] } }),
    run: (store, i) => {
      if (!store.scene.animation) startAnimation(store, Number(i.duration ?? 2));
      setAnimationOptions(store, { ...(i.duration != null ? { duration: Number(i.duration) } : {}), ...(i.loop != null ? { loop: Boolean(i.loop) } : {}) });
      const a = store.scene.animation!;
      return `Animation: ${a.duration} s${a.loop ? ', looping' : ''}. Give figures actions (move_to, apply_motion), or move the playhead with set_time and pose: a pose is keyed there on that figure's track (over a motion or a walk, as a correction to it).`;
    },
  },
  {
    name: 'set_time',
    description: 'Move the playhead (seconds). Actions added and poses set afterwards start or are keyed at this time.',
    schema: obj({ seconds: num('Time') }),
    run: (store, i) => {
      if (!store.scene.animation) throw new Error('This pose is not animated: call animate first');
      store.setTime(Math.max(0, Math.min(store.scene.animation.duration, Number(i.seconds))));
      return `Playhead at ${r2(store.getState().time)} s.`;
    },
  },
  {
    name: 'camera_move',
    description: `Give the current shot a ready-made camera move: ${CAMERA_MOVES.map((m) => `${m.id} (${m.description.toLowerCase()})`).join('; ')}.`,
    schema: obj({ move: str('Move', CAMERA_MOVES.map((m) => m.id)) }),
    run: (store, i) => {
      if (!store.scene.animation) startAnimation(store);
      applyCameraMove(store, String(i.move));
      return `Camera: ${CAMERA_MOVES.find((m) => m.id === i.move)?.name}.`;
    },
  },
  {
    name: 'film_coverage',
    description: `ProjectSettings the whole animation with a coverage: cameras on the people in its roles (A, and B for two-person ones), all on one side of the line between them, cut on what they do (setting off, a motion, a prop let go) or on a beat: ${COVERAGES.map((c) => `${c.id} (${c.description.toLowerCase()}; roles ${c.roles.join(', ')})`).join('; ')}. Applied again it recuts, keeping cameras edited since. Do the blocking and acting first.`,
    schema: obj({ coverage: str('Coverage', COVERAGES.map((c) => c.id)), a: opt(FIGURE), b: opt(FIGURE) }),
    run: (store, i) => {
      const c = COVERAGES.find((x) => x.id === i.coverage)!;
      const fa = i.a ? findFigure(store, i.a) : null;
      const fb = i.b ? findFigure(store, i.b) : null;
      const given = fa && (c.roles.length < 2 || fb) ? { A: fa.id, ...(fb ? { B: fb.id } : {}) } : undefined;
      const cast = coverScene(store, c.id, given ?? (fa ? castCoverage(store.scene, c, fa.id) ?? undefined : undefined));
      if (!cast) throw new Error(`${c.name} needs ${c.roles.length} people`);
      const a = store.scene.animation!;
      const name = (id: string) => store.scene.figures.find((f) => f.id === id)?.name;
      return `${c.name} (${c.roles.map((r) => `${r}: ${name(cast[r])}`).join(', ')}): ${shotSpans(a).map((s) => `${r2(s.start)} s ${store.scene.cameras.find((x) => x.id === s.shot.camera)?.name}`).join(', ')}.`;
    },
  },
  {
    name: 'check_motion',
    description: 'Check the animation for foot sliding, bodies below the floor, interpenetration, joints past their range and pops.',
    schema: obj({}),
    run: (store) => {
      if (!store.scene.animation) return 'Not animated.';
      const issues = checkMotion(store.scene);
      return issues.length ? issues.map((x) => `${x.start.toFixed(2)}–${x.end.toFixed(2)} s: ${x.message}`).join('\n') : 'No problems found.';
    },
  },
  {
    name: 'describe_shot',
    description: 'A plain-language description of the shot (framing, angle, lens, camera move, cast, action) for AI video tools.',
    schema: obj({}),
    run: (store) => describeShot(store.scene),
  },
  {
    name: 'undo',
    description: 'Undo the last change.',
    schema: obj({}),
    run: (store) => {
      store.undo();
      return 'Undone.';
    },
  },
];

/** Run a tool by name; errors come back as text for the model to correct itself. */
export function runTool(store: Store, name: string, input: unknown): { ok: boolean; text: string } {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, text: `Unknown tool "${name}"` };
  try {
    return { ok: true, text: tool.run(store, (input && typeof input === 'object' ? input : {}) as Record<string, unknown>) };
  } catch (err) {
    return { ok: false, text: `Error: ${(err as Error).message}` };
  }
}

export const SYSTEM_PROMPT = `You are the assistant inside Pose Studio, a web app with posable 3D art mannequins for drawing reference, storyboards and animation previs. You change the open pose with tools; every change shows live and can be undone.

Space: metres, +Y up, the floor is y = 0. A figure at facing 0 faces +Z (towards the default camera); its left side is +X. Facing 90 turns it to its own left (it then faces +X).
Joint angles are degrees, Euler X/Y/Z:
- root (pelvis): X+ pitch forward, Y = facing (use place_figure), Z+ lean to its own right
- spine, chest, neck, head: X+ bend forward, Y+ twist to its left, Z+ tilt to its right
- leftUpperArm/R, leftUpperLeg/R: X− swings the limb forward/up, X+ back; Z spreads it out sideways (+ for L, − for R); Y twists. shoulder X −90 = arm straight forward, −180 = straight up; leftUpperArm Z +90 = arm out to the side.
- leftLowerArm/R: X− bends (to −150). leftLowerLeg/R: X+ bends (to 160). leftFoot/R: X+ points the toes. wrists: X flex, Z sideways.
Grounded figures stand on the floor automatically (a bent knee lowers the body).

Animation is made of actions on each person's track: a walk, run or jump to a mark (move_to), a motion from the library (apply_motion: one person's; people together each get their own), poses keyed by hand (set_time, then set_joints), an upper-body motion over another (upper_body), a prop thrown, passed, shot or dribbled (throw_prop), contacts held over time (hold). get_scene lists the actions with their ids; edit_action moves, retimes, blends, speeds up or removes one, move_mark changes where it ends. Changing one action moves only what that person does after it.
Follow the workflow: set up the scene (cast: add_figure; set: add_prop; place with place_figure and relate), act (move figures from mark to mark with move_to, apply_pose or apply_motion for actions on the spot, then refine), then shoot (film_coverage for the whole scene, or cut_shot and camera_move shot by shot; then check_motion).
Work like an artist: read the scene with get_scene, make natural, readable poses with clear weight and gesture. Set the body and legs with set_joints, then place hands with reach (on another figure, or on the figure's own hips, knees, chest or head) instead of guessing arm angles. To put a figure beside, in front of or facing another, use relate rather than working out coordinates. For animation: chain actions at the playhead, fix timing with edit_action, add a camera_move, and run check_motion. Keep replies short: say what you did.`;
