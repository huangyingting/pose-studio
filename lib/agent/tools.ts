import {
  addScene, addFigures, applyMotion, applyPose, applyCameraMove, arrange, deleteFigure, deleteProp, lookAtFigure,
  editShot, holdProp, nextName, reachFor, setFigureColor, setSceneLight, setGaze, setTravel, throwProp, travelTo, setAnimationOptions, setDistance, setPlacement, setSceneView, startAnimation,
} from '../actions';
import { BODY_PRESETS } from '../body';
import { DEFAULT_LIGHT, LIGHT_PRESETS, clampLight } from '../lighting';
import { newFigure, newProp, newScene, withPosture } from '../doc';
import { HAND_PRESETS, cloneHand } from '../hands';
import { mapPoses } from '../animation';
import { clampRotation } from '../joints';
import { MOTIONS, buildMotion } from '../motions';
import { allPoses, builtInPoses } from '../poses';
import { describeShot } from '../prompt';
import { checkMotion } from '../qa';
import { CONTACTS, facing, type Contact } from '../relations';
import { CAMERA_MOVES } from '../shot';
import { shotSpans, spanAt } from '../shots';
import type { Store } from '../store';
import { TEMPLATES, buildTemplate } from '../templates';
import { FIGURE_COLORS, JOINTS, POSTURES, PROP_KINDS, PROP_LABELS, STYLES, type Side, type Travel, type Figure, type JointName, type Posture, type PropKind, type Style, type Vec3 } from '../types';

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
      joints: Object.fromEntries(Object.entries(f.joints).filter(([, v]) => v.some((x) => x !== 0)).map(([k, v]) => [k, v.map(r1)])),
    })),
    props: s.props.map((p) => ({ id: p.id, name: p.name, kind: p.kind, ...(p.hold ? { held_by: p.hold.figure, hand: p.hold.hand } : {}), position: { x: r2(p.position[0]), z: r2(p.position[2]) }, facing: r1(p.rotation[1]), scale: p.scale.map(r2) })),
    animation: a ? {
      duration: a.duration,
      loop: a.loop,
      playhead: r2(store.getState().time),
      pose_keys: a.keys.map((k) => r2(k.t)),
      camera_keys: (a.camera?.keys ?? []).map((k) => ({ t: r2(k.t), yaw: r1(k.yaw), pitch: r1(k.pitch), fov: r1(k.fov), zoom: r2(k.zoom) })),
      shots: shotSpans(a).map((sp) => ({ name: sp.shot.name, start: r2(sp.start), end: r2(sp.end) })),
    } : null,
    still_camera: s.animation ? undefined : s.view,
    style: store.getState().settings.style,
    joint_limits: store.getState().settings.limits,
  };
}

const RELATIONS = ['turn_to', 'face_each_other', 'look_at', 'beside_left', 'beside_right', 'back_to_back', 'in_front', 'distance'] as const;

export const TOOLS: AgentTool[] = [
  {
    name: 'get_scene',
    description: 'The open pose: figures (id, name, body, floor position, facing, non-zero joint angles), props, animation (keys, camera keys, shots) and render style. Call this first and after big changes.',
    schema: obj({}),
    run: (store) => JSON.stringify(sceneSummary(store)),
  },
  {
    name: 'set_joints',
    description: 'Rotate joints of a figure (degrees, absolute). Unlisted joints keep their angles. While an animation is open, this also keys the pose at the playhead.',
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
      const joints = { ...f.joints };
      for (const j of i.joints as { joint: JointName; x: number; y: number; z: number }[]) {
        if (!JOINTS.includes(j.joint)) throw new Error(`Unknown joint "${j.joint}"`);
        const v: Vec3 = [j.x, j.y, j.z].map(r1) as Vec3;
        const c = limits && j.joint !== 'root' ? clampRotation(j.joint, v) : v;
        if (c.some((x, k) => x !== v[k])) clamped.push(`${j.joint} → [${c.join(', ')}]`);
        joints[j.joint] = c;
      }
      store.updateFigure(f.id, (x) => ({ ...x, joints }));
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
    description: 'Walk, run or jump a figure from where it is at the playhead to a floor point, as part of the animation (it is animated if needed). The steps are generated (no sliding), the time is set from the distance, the figure\'s later keys move on, and the playhead goes to the arrival, so calls chain into a route. Walking and running face the way they go unless keep_facing (side steps, backing up). A jump keeps the facing; give its height (m) and turns in the air: spin (turns about the vertical, e.g. 1) and flip (1 front flip, -1 back flip). Jumps can land on top of props.',
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
    name: 'place_figure',
    description: 'Move a figure on the floor and/or turn it. Null keeps the current value. In an animation this moves the figure in every key (staging); set animate_move to true to key the new place at the playhead only, so the figure travels there.',
    schema: obj({ figure: FIGURE, x: opt(num('Floor X (metres)')), z: opt(num('Floor Z (metres)')), facing: opt(num('Facing (degrees)')), animate_move: { type: ['boolean', 'null'] } }),
    run: (store, i) => {
      const f = findFigure(store, i.figure);
      const p = { x: (i.x as number | null) ?? undefined, z: (i.z as number | null) ?? undefined, yaw: (i.facing as number | null) ?? undefined };
      const a = store.scene.animation;
      if (a && !i.animate_move && a.keys.some((k) => k.poses[f.id])) {
        // Shift the whole track: every key moves and turns by the same amount.
        const dx = p.x === undefined ? 0 : p.x - f.position[0];
        const dz = p.z === undefined ? 0 : p.z - f.position[2];
        const dyaw = p.yaw === undefined ? 0 : p.yaw - facing(f);
        store.updateScene((s) => ({
          ...s,
          animation: mapPoses(s.animation!, (pose, id) => {
            if (id !== f.id) return pose;
            const r = pose.joints.root ?? [0, 0, 0];
            return { ...pose, position: [pose.position[0] + dx, pose.position[1], pose.position[2] + dz], joints: { ...pose.joints, root: [r[0], r[1] + dyaw, r[2]] } };
          }),
        }));
        store.setTime(store.getState().time);
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
    name: 'shot_subject',
    description: 'Make the shot playing at a time about one figure: the camera frames just them (and with the camera\'s follow on, tracks them), or with figure null everyone again. Cut shots first (cut_shot) to give each its subject.',
    schema: obj({ time: num('A time inside the shot (s)'), figure: opt(FIGURE) }),
    run: (store, i) => {
      const a = store.scene.animation;
      if (!a) throw new Error('The scene is not animated');
      const span = spanAt(a, Number(i.time));
      const f = i.figure ? findFigure(store, i.figure) : null;
      editShot(store, span.shot.id, { subject: f?.id });
      return `${span.shot.name} frames ${f ? f.name : 'everyone'}.`;
    },
  },
  {
    name: 'set_lighting',
    description: `Light the open scene (saved with it, used by its exports; shows in the shaded style): a preset (${LIGHT_PRESETS.map((p) => p.id).join(', ')}) and/or direction (degrees around, 0 = from the front), height (degrees up), brightness (1 normal) and warmth (-1 cool … 1 warm).`,
    schema: obj({
      preset: opt(str('Preset', LIGHT_PRESETS.map((p) => p.id))),
      direction: opt(num('Degrees around the scene, 0 = from the front')),
      height: opt(num('Degrees above the floor')),
      brightness: opt(num('1 is normal')),
      warmth: opt(num('-1 cool … 1 warm')),
    }),
    run: (store, i) => {
      const base = (typeof i.preset === 'string' ? LIGHT_PRESETS.find((p) => p.id === i.preset)?.light : undefined) ?? store.scene.light ?? DEFAULT_LIGHT;
      const n = (v: unknown) => (typeof v === 'number' ? v : undefined);
      const light = clampLight({
        ...base,
        ...(n(i.direction) !== undefined ? { azimuth: n(i.direction) } : {}),
        ...(n(i.height) !== undefined ? { elevation: n(i.height) } : {}),
        ...(n(i.brightness) !== undefined ? { intensity: n(i.brightness) } : {}),
        ...(n(i.warmth) !== undefined ? { warmth: n(i.warmth) } : {}),
      });
      setSceneLight(store, light);
      return `Light: from ${r1(light.azimuth)}°, ${r1(light.elevation)}° up, brightness ${r2(light.intensity)}, warmth ${r2(light.warmth)}.`;
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
    description: 'Throw a prop out of the hand holding it at the playhead (animated): into another figure\'s hand (to_figure and hand: caught there), or to a floor point (x, z). It flies under gravity from where the hand is; the playhead goes to the arrival. Put it in a hand first with add_prop held_by or hold_prop.',
    schema: obj({ prop: str('Prop id or name'), to_figure: opt(FIGURE), hand: opt(str('Catching hand', ['L', 'R'])), x: opt(num('Floor X')), z: opt(num('Floor Z')) }),
    run: (store, i) => {
      const p = findProp(store, i.prop);
      if (!p.hold) throw new Error(`${p.name} is not in anyone's hand at ${r2(store.getState().time)} s`);
      const target = i.to_figure ? { figure: findFigure(store, i.to_figure).id, hand: (i.hand === 'L' ? 'L' : 'R') as Side } : { at: [Number(i.x ?? 0), Number(i.z ?? 0)] as [number, number] };
      const span = throwProp(store, p.id, target);
      if (!span) throw new Error(`Could not throw ${p.name}`);
      return `${p.name} thrown at ${r2(span.from)} s, arriving at ${r2(span.to)} s.`;
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
    description: `Start a new scene in the project and open it: blank, or a set-up with people (${TEMPLATES.map((t) => `${t.id} = ${t.name}`).join(', ')}) or an animated set-up for several people (${MOTIONS.filter((m) => m.people > 1).map((m) => `${m.id} = ${m.name}`).join(', ')}).`,
    schema: obj({ template: str('Template', ['blank', ...TEMPLATES.map((t) => t.id), ...MOTIONS.filter((m) => m.people > 1).map((m) => m.id)]), name: opt(str('Name for the scene')) }),
    run: (store, i) => {
      const id = String(i.template);
      const scene = id === 'blank' ? newScene() : buildTemplate(id) ?? buildMotion(id);
      if (!scene) throw new Error(`Unknown template "${id}"`);
      addScene(store, i.name ? { ...scene, name: String(i.name).slice(0, 80) } : scene);
      return `Opened "${store.scene.name}". ${JSON.stringify(sceneSummary(store))}`;
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
    description: `Give a figure a one-person motion from the library, on its own track from the playhead (the scene is animated if needed), starting where it stands and facing its way: ${MOTIONS.filter((m) => m.people === 1).map((m) => `${m.id} = ${m.name}`).join(', ')}; plus the user's imported motions by name.`,
    schema: obj({ figure: FIGURE, motion: str('Motion id, or the name of an imported motion') }),
    run: (store, i) => {
      const f = findFigure(store, i.figure);
      const q = String(i.motion).trim().toLowerCase();
      const mine = store.getState().library.motions ?? [];
      const motion = MOTIONS.find((m) => m.people === 1 && m.id === q) ?? mine.find((m) => m.name.toLowerCase() === q) ?? mine.find((m) => m.name.toLowerCase().includes(q));
      if (!motion) throw new Error(`No one-person motion "${i.motion}"`);
      const from = store.scene.animation ? store.getState().time : 0;
      applyMotion(store, f.id, motion.id);
      const a = store.scene.animation!;
      return `${f.name}: ${motion.name} from ${r2(from)} s (animation ${a.duration} s).`;
    },
  },
  {
    name: 'set_style',
    description: 'Render style of the viewport and exports.',
    schema: obj({ style: str('Style', STYLES) }),
    run: (store, i) => {
      store.setSettings({ style: i.style as Style });
      return `Style: ${i.style}.`;
    },
  },
  {
    name: 'set_still_camera',
    description: 'Camera for a still pose\'s thumbnail and export: yaw (0 = front, 90 = from the figure\'s left), pitch (positive looks down), lens fov in degrees.',
    schema: obj({ yaw: num('Degrees'), pitch: num('Degrees, -30 to 85'), fov: num('Degrees, 10 to 60') }),
    run: (store, i) => {
      setSceneView(store, { yaw: Number(i.yaw), pitch: Math.max(-30, Math.min(85, Number(i.pitch))), fov: Math.max(10, Math.min(60, Number(i.fov))) });
      return 'Camera set.';
    },
  },
  {
    name: 'animate',
    description: 'Turn the open pose into an animation (if it is not one yet) and/or change its length and looping. Its current pose becomes the key at 0 s.',
    schema: obj({ duration: opt(num('Seconds')), loop: { type: ['boolean', 'null'] } }),
    run: (store, i) => {
      if (!store.scene.animation) startAnimation(store, Number(i.duration ?? 2));
      setAnimationOptions(store, { ...(i.duration != null ? { duration: Number(i.duration) } : {}), ...(i.loop != null ? { loop: Boolean(i.loop) } : {}) });
      const a = store.scene.animation!;
      return `Animation: ${a.duration} s${a.loop ? ', looping' : ''}. Move the playhead with set_time, then pose: each change is keyed there.`;
    },
  },
  {
    name: 'set_time',
    description: 'Move the playhead (seconds). Poses set afterwards are keyed at this time.',
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
- shoulderL/R, hipL/R: X− swings the limb forward/up, X+ back; Z spreads it out sideways (+ for L, − for R); Y twists. shoulder X −90 = arm straight forward, −180 = straight up; shoulderL Z +90 = arm out to the side.
- elbowL/R: X− bends (to −150). kneeL/R: X+ bends (to 160). ankleL/R: X+ points the toes. wrists: X flex, Z sideways.
Grounded figures stand on the floor automatically (a bent knee lowers the body).

Follow the workflow: set up the scene (cast: add_figure; set: add_prop; place with place_figure and relate), act (move figures around with move_to: walk, run or jump from mark to mark; apply_pose or apply_motion from the library for actions on the spot; then refine), then shoot (camera_move, check_motion).
Work like an artist: read the scene with get_scene, make natural, readable poses with clear weight and gesture. Set the body and legs with set_joints, then place hands with reach (on another figure, or on the figure's own hips, knees, chest or head) instead of guessing arm angles. To put a figure beside, in front of or facing another, use relate rather than working out coordinates. For animation: animate, then set_time and set_joints for each key (a few keys, then let interpolation do the rest), add a camera_move, and run check_motion. Keep replies short: say what you did.`;
