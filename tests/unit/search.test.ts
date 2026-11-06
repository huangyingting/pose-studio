import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { matches } from '@/lib/search';

const names = (JSON.parse(readFileSync('public/motions/index.json', 'utf8')) as { name: string }[]).map((m) => m.name);
const found = (q: string) => names.filter((n) => matches(n, q));

describe('searching the Library in everyday words (#62)', () => {
  it('finds a motion by what its name says, and by the words people use for it', () => {
    expect(found('Wave')).toContain('Wave hello');
    expect(found('gun')).toEqual(expect.arrayContaining(['Aim a pistol', 'Fire a rifle']));
    expect(found('shoot')).toEqual(expect.arrayContaining(['Fire a pistol', 'Fire a rifle', 'Shot in the back']));
    expect(found('workout')).toEqual(expect.arrayContaining(['Push-ups', 'Sit-ups', 'Squats', 'Jumping jacks']));
    expect(found('goodbye')).toContain('Wave hello');
    expect(found('football')).toContain('Tackle');
    expect(found('dead')).toContain('Lie face down, still');
    expect(found('come here')).toContain('Beckon');
    expect(found('tired')).toContain('Walk, exhausted');
    expect(found('monster')).toEqual(expect.arrayContaining(['Zombie, walk', 'Zombie, attack']));
    expect(found('garden')).toEqual(expect.arrayContaining(['Water the plants', 'Plant seeds', 'Pull up plants']));
    expect(found('weapon')).toEqual(expect.arrayContaining(['Stab with a knife', 'Throw a grenade, kneeling', 'Great sword, slash']));
    // Every everyday word finds something the Library has.
    for (const q of ['gun', 'shoot', 'hello', 'bye', 'workout', 'fight', 'dead', 'injured', 'happy', 'sad', 'afraid', 'shout', 'vehicle', 'cigarette', 'football', 'hide', 'floor', 'love', 'party', 'stunt']) expect(found(q).length, q).toBeGreaterThan(0);
    expect(matches('Push-ups', '')).toBe(true);
    expect(matches('Push-ups', 'gun')).toBe(false);
  });
});
