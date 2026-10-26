import { afterEach, describe, expect, it, vi } from 'vitest';
import { responsesTurn, azureTarget } from '@/lib/agent/openai';
import { TOOLS, runTool } from '@/lib/agent/tools';
import { Store } from '@/lib/store';

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
    expect(run(store, 'set_joints', { figure: scene.figures[0].name, joints: [{ joint: 'kneeL', x: -30, y: 0, z: 0 }, { joint: 'shoulderR', x: -90, y: 0, z: -10 }] }))
      .toMatch(/Clamped to natural limits: kneeL/);
    expect(store.figure!.joints.kneeL).toEqual([0, 0, 0]);
    expect(store.figure!.joints.shoulderR).toEqual([-90, 0, -10]);

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
        { joint: 'root', x: 30, y: 0, z: 0 }, { joint: 'spine', x: 15, y: 0, z: 0 }, { joint: 'hipR', x: -100, y: 0, z: 0 }, { joint: 'kneeR', x: 95, y: 0, z: 0 },
        { joint: 'hipL', x: -10, y: 0, z: 0 }, { joint: 'kneeL', x: 100, y: 0, z: 0 },
      ],
    });
    expect(run(store, 'reach', { figure: id, hand: 'right', other: id, target: 'kneeR' })).toMatch(/hand is on its own kneeR/);
    expect(run(store, 'reach', { figure: id, hand: 'left', other: id, target: 'hipL' })).toMatch(/hand is on its own hipL/);
  });

  it('animate with keys at the playhead, then check the motion', () => {
    const store = new Store(new MemoryStorage());
    const fig = store.figure!.id;
    run(store, 'animate', { duration: 2, loop: false });
    run(store, 'set_time', { seconds: 1 });
    run(store, 'set_joints', { figure: fig, joints: [{ joint: 'shoulderL', x: -120, y: 0, z: 10 }] });
    expect(store.scene.animation!.keys.map((k) => k.t)).toEqual([0, 1]);
    run(store, 'camera_move', { move: 'orbit90' });
    expect(store.scene.animation!.camera!.keys.length).toBeGreaterThan(1);
    expect(run(store, 'check_motion')).toBe('No problems found.');
    expect(run(store, 'describe_shot')).toMatch(/arcs/);

    // Staging moves the figure in every key; animate_move keys the new place at the playhead only.
    run(store, 'place_figure', { figure: fig, x: 1, z: null, facing: 90, animate_move: null });
    expect(store.scene.animation!.keys.map((k) => k.poses[fig].position[0])).toEqual([1, 1]);
    expect(store.scene.animation!.keys.map((k) => k.poses[fig].joints.root![1])).toEqual([90, 90]);
    run(store, 'place_figure', { figure: fig, x: 2, z: null, facing: null, animate_move: true });
    expect(store.scene.animation!.keys.map((k) => k.poses[fig].position[0])).toEqual([1, 2]);
  });

  it('opens templates and explains bad input', () => {
    const store = new Store(new MemoryStorage());
    expect(run(store, 'new_pose', { template: 'handshake', name: 'Deal' })).toMatch(/Opened "Deal"/);
    expect(store.scene.figures).toHaveLength(2);
    expect(runTool(store, 'set_joints', { figure: 'Nobody', joints: [] })).toEqual({ ok: false, text: expect.stringMatching(/No figure "Nobody". Figures: /) });
    expect(runTool(store, 'fly', {}).ok).toBe(false);
  });

  it('runs a Responses API turn: tool calls, results and the conversation chain', async () => {
    const store = new Store(new MemoryStorage());
    const bodies: Record<string, unknown>[] = [];
    const replies = [
      { id: 'r1', output: [{ type: 'function_call', name: 'set_style', arguments: '{"style":"ink"}', call_id: 'c1' }] },
      { id: 'r2', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Switched to ink.' }] }] },
    ];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(replies.shift()), { status: 200 });
    }));
    const texts: string[] = [];
    const tools: string[] = [];
    const last = await responsesTurn(azureTarget('k', 'https://x.openai.azure.com/', 'dep'), 'r0', 'Make it ink', store, {
      onText: (t) => texts.push(t),
      onTool: (n, _i, r) => tools.push(`${n}: ${r}`),
    }, new AbortController().signal);
    expect(last).toBe('r2');
    expect(store.getState().settings.style).toBe('ink');
    expect(tools).toEqual(['set_style: Style: ink.']);
    expect(texts).toEqual(['Switched to ink.']);
    expect(bodies[0]).toMatchObject({ model: 'dep', previous_response_id: 'r0', input: [{ role: 'user', content: 'Make it ink' }] });
    expect(bodies[1]).toMatchObject({ previous_response_id: 'r1', input: [{ type: 'function_call_output', call_id: 'c1', output: 'Style: ink.' }] });
  });
});
