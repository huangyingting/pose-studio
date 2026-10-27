import { afterEach, describe, expect, it, vi } from 'vitest';
import { liveCamera } from '@/lib/shot';
import { assistantTurn } from '@/lib/agent/turn';
import { TOOLS, runTool } from '@/lib/agent/tools';
import { Store } from '@/lib/store';
import { angle } from '../../lib/pose';
import { partKeys } from '@/lib/clip';
import { actionsOf } from '@/lib/evaluate';
import { facingOf } from '@/lib/pose';
import { keyTimesOf } from '@/lib/track';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

const run = (store: Store, name: string, input: Record<string, unknown> = {}) => {
  const r = runTool(store, name, input);
  if (!r.ok) throw new Error(r.text);
  return r.text;
};

/** Strict tool schemas: every object lists all its properties as required and allows no others. */
function strict(schema: Record<string, unknown>, path: string) {
  if (schema.type === 'object') {
    const props = Object.keys(schema.properties as object);
    expect(schema.required, path).toEqual(props);
    expect(schema.additionalProperties, path).toBe(false);
    for (const [k, v] of Object.entries(schema.properties as Record<string, Record<string, unknown>>)) strict(v, `${path}.${k}`);
  }
  if (schema.items) strict(schema.items as Record<string, unknown>, `${path}[]`);
}

describe('assistant tools', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('have strict, unique schemas', () => {
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
    for (const t of TOOLS) {
      expect(t.name).toMatch(/^[a-z_]{1,64}$/);
      strict(t.schema, t.name);
    }
  });

  it('pose, place and relate figures through the store (undoable)', () => {
    const store = new Store(new MemoryStorage());
    const scene = JSON.parse(run(store, 'get_scene'));
    const id = scene.figures[0].id;
    expect(run(store, 'set_joints', { figure: scene.figures[0].name, joints: [{ joint: 'leftLowerLeg', x: -30, y: 0, z: 0 }, { joint: 'rightUpperArm', x: -90, y: 0, z: -10 }] }))
      .toMatch(/Clamped to natural limits: leftLowerLeg/);
    expect(angle(store.figure!.bones, 'leftLowerLeg')).toEqual([0, 0, 0]);
    expect(angle(store.figure!.bones, 'rightUpperArm')).toEqual([-90, 0, -10]);

    run(store, 'add_figure', { kind: 'figure', name: 'Ben', body: 'Male', posture: null, x: 1.5, z: null });
    run(store, 'relate', { figure: 'Ben', other: id, action: 'face_each_other', distance: null });
    const after = JSON.parse(run(store, 'get_scene'));
    const ben = after.figures.find((f: { name: string }) => f.name === 'Ben');
    expect(ben.body).toBe('male, 1.8 m');
    expect(Math.abs(ben.facing)).toBeCloseTo(90, 0);

    run(store, 'add_figure', { kind: 'stand_in', name: null, body: null, posture: 'sit', x: -1, z: 0.5 });
    expect(store.figure!.proxy).toBe('sit');
    expect(store.figure!.position[0]).toBeCloseTo(-1);
    run(store, 'add_prop', { kind: 'chair', x: 0, z: -1, facing: 180 });
    expect(store.scene.props[0]).toMatchObject({ kind: 'chair', position: [0, 0, -1], rotation: [0, 180, 0] });

    run(store, 'undo');
    expect(store.scene.props).toHaveLength(0);
  });

  it('reach the figure\'s own knees and hips', () => {
    const store = new Store(new MemoryStorage());
    const id = store.figure!.id;
    // Kneeling on the left knee, the right knee raised in front, leaning in.
    run(store, 'set_joints', {
      figure: id,
      joints: [
        { joint: 'hips', x: 30, y: 0, z: 0 }, { joint: 'spine', x: 15, y: 0, z: 0 }, { joint: 'rightUpperLeg', x: -100, y: 0, z: 0 }, { joint: 'rightLowerLeg', x: 95, y: 0, z: 0 },
        { joint: 'leftUpperLeg', x: -10, y: 0, z: 0 }, { joint: 'leftLowerLeg', x: 100, y: 0, z: 0 },
      ],
    });
    expect(run(store, 'reach', { figure: id, hand: 'right', other: id, target: 'rightLowerLeg' })).toMatch(/hand is on its own rightLowerLeg/);
    expect(run(store, 'reach', { figure: id, hand: 'left', other: id, target: 'leftUpperLeg' })).toMatch(/hand is on its own leftUpperLeg/);
  });

  it('animate with keys at the playhead, then check the motion', () => {
    const store = new Store(new MemoryStorage());
    const fig = store.figure!.id;
    run(store, 'animate', { duration: 2, loop: false });
    run(store, 'set_time', { seconds: 1 });
    run(store, 'set_joints', { figure: fig, joints: [{ joint: 'leftUpperArm', x: -120, y: 0, z: 10 }] });
    expect(keyTimesOf(store.scene.animation!, fig)).toEqual([0, 1]);
    run(store, 'camera_move', { move: 'orbit90' });
    expect(liveCamera(store.scene, 0)!.points.length).toBeGreaterThan(1);
    expect(run(store, 'check_motion')).toBe('No problems found.');
    expect(run(store, 'describe_shot')).toMatch(/arcs/);

    // Staging moves the figure in every key; animate_move keys the new place at the playhead only.
    const keys = () => actionsOf(store.scene.animation!, fig).flatMap((x) => (x.source.kind === 'keys' ? partKeys(x.source.clip.parts[0]).map((k) => k.pose) : []));
    run(store, 'place_figure', { figure: fig, x: 1, z: null, facing: 90, animate_move: null });
    expect(keys().map((p) => p.position[0])).toEqual([1, 1]);
    expect(keys().map((p) => Math.round(facingOf(p.bones)))).toEqual([90, 90]);
    run(store, 'place_figure', { figure: fig, x: 2, z: null, facing: null, animate_move: true });
    expect(keys().map((p) => p.position[0])).toEqual([1, 2]);
  });

  it('applies library poses and motions to a figure', () => {
    const store = new Store(new MemoryStorage());
    const id = store.figure!.id;
    expect(run(store, 'apply_pose', { figure: id, pose: 'hand on head' })).toBe('Figure: Hand on head.');
    expect(run(store, 'apply_motion', { figure: id, motion: 'walk' })).toMatch(/Walk ahead from 0 s/);
    // From where it stands to a mark 3 m ahead, walking (the steps generated).
    const walk = actionsOf(store.scene.animation!, id).find((x) => x.source.kind === 'travel')!;
    expect(walk.source).toMatchObject({ mode: 'walk' });
    expect(walk.roles[0].end!.at[1]).toBeCloseTo(3, 2);
    expect(runTool(store, 'apply_pose', { figure: id, pose: 'moonwalk' }).ok).toBe(false);
  });

  it('edits actions as blocks: retimed, moved, their marks moved; waves over a walk; a shot at the hoop', () => {
    const store = new Store(new MemoryStorage());
    const id = store.figure!.id;
    run(store, 'move_to', { figure: id, x: 0, z: 3, how: 'walk', keep_facing: null, height: null, spin: null, flip: null });
    const scene = JSON.parse(run(store, 'get_scene')) as { animation: { actions: { id: string; what: string; start: number; end: number; marks?: { z: number }[] }[] } };
    const walk = scene.animation.actions.find((x) => x.what === 'Walk')!;
    expect(walk.marks![0].z).toBeCloseTo(3, 1);
    const edit = (patch: Record<string, unknown>) => run(store, 'edit_action', { action: walk.id, start: null, duration: null, blend_in: null, speed: null, mirrored: null, remove: null, ...patch });
    expect(edit({ duration: walk.end - walk.start + 1 })).toMatch(/^Walk: /);
    expect(actionsOf(store.scene.animation!, id).find((x) => x.id === walk.id)!.duration).toBeCloseTo(walk.end - walk.start + 1, 1);
    run(store, 'move_mark', { action: walk.id, figure: id, x: 1, z: 4 });
    expect(actionsOf(store.scene.animation!, id).find((x) => x.id === walk.id)!.roles[0].end!.at).toEqual([1, 4]);
    run(store, 'set_time', { seconds: 0.5 });
    expect(run(store, 'upper_body', { figure: id, motion: 'wave' })).toMatch(/wave from the waist up/);
    expect(actionsOf(store.scene.animation!, id, 'upper')).toHaveLength(1);
    // A ball shot at a hoop from the hand.
    run(store, 'add_prop', { kind: 'sphere', x: 0, z: 0, facing: null, name: 'Ball', held_by: id, hand: 'R' });
    run(store, 'add_prop', { kind: 'hoop', x: 1, z: 7, facing: null, name: 'Hoop', held_by: null, hand: null });
    store.setTime(store.scene.animation!.duration);
    expect(run(store, 'throw_prop', { prop: 'Ball', to_figure: null, hand: null, hoop: 'Hoop', miss: null, dribble: null, x: null, z: null })).toMatch(/let go at .* arriving at/);
    expect(edit({ remove: true })).toBe('Removed Walk.');
  }, 60_000);

  it('opens templates and explains bad input', () => {
    const store = new Store(new MemoryStorage());
    expect(run(store, 'new_scene', { template: 'handshake', name: 'Deal' })).toMatch(/Opened "Deal"/);
    expect(store.scene.figures).toHaveLength(2);
    expect(runTool(store, 'set_joints', { figure: 'Nobody', joints: [] })).toEqual({ ok: false, text: expect.stringMatching(/No figure "Nobody". Figures: /) });
    expect(runTool(store, 'fly', {}).ok).toBe(false);
  });

  it('runs a turn through the server: tool calls run here, results go back, the conversation chains', async () => {
    const store = new Store(new MemoryStorage());
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const replies = [
      { id: 'r1', output: [{ type: 'function_call', name: 'set_style', arguments: '{"style":"ink"}', call_id: 'c1' }] },
      { id: 'r2', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Switched to ink.' }] }] },
    ];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(replies.shift()), { status: 200 });
    }));
    const texts: string[] = [];
    const tools: string[] = [];
    const last = await assistantTurn('r0', 'Make it ink', store, {
      onText: (t) => texts.push(t),
      onTool: (n, _i, r) => tools.push(`${n}: ${r}`),
    }, new AbortController().signal);
    expect(last).toBe('r2');
    expect(store.getState().settings.style).toBe('ink');
    expect(tools).toEqual(['set_style: Style: ink.']);
    expect(texts).toEqual(['Switched to ink.']);
    expect(calls.map((c) => c.url)).toEqual(['/api/ai', '/api/ai']);
    // Only the conversation goes to the server: it adds the instructions, tools and model itself.
    expect(calls[0].body).toEqual({ previous_response_id: 'r0', input: [{ role: 'user', content: 'Make it ink' }] });
    expect(calls[1].body).toEqual({ previous_response_id: 'r1', input: [{ type: 'function_call_output', call_id: 'c1', output: 'Style: ink.' }] });
  });

  it('reports server errors (limits, not signed in) as they are', async () => {
    const store = new Store(new MemoryStorage());
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Daily assistant limit reached' }), { status: 429 })));
    await expect(assistantTurn(null, 'Hi', store, { onText: () => {}, onTool: () => {} }, new AbortController().signal)).rejects.toThrow('Daily assistant limit reached');
  });

});
