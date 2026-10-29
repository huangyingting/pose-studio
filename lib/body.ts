import type { BodyParams } from './types';

export const DEFAULT_BODY: BodyParams = { sex: 1, height: 1.7 };

/** A man or a woman (the mannequin: Mixamo's Y Bot or X Bot) at a few heights. */
export const BODY_PRESETS: { name: string; body: BodyParams }[] = [
  { name: 'Woman', body: DEFAULT_BODY },
  { name: 'Man', body: { sex: 0, height: 1.8 } },
  { name: 'Tall man', body: { sex: 0, height: 1.88 } },
  { name: 'Big man', body: { sex: 0, height: 1.97 } },
  { name: 'Tall woman', body: { sex: 1, height: 1.79 } },
  { name: 'Child', body: { sex: 0, height: 1.25 } },
];

export const HEIGHT = { min: 1.1, max: 2.2, step: 0.01, format: (v: number) => `${v.toFixed(2)} m` };

export function clampBody(b: Partial<BodyParams>): BodyParams {
  const sex = typeof b.sex === 'number' && Number.isFinite(b.sex) ? (b.sex >= 0.5 ? 1 : 0) : DEFAULT_BODY.sex;
  const height = typeof b.height === 'number' && Number.isFinite(b.height) ? Math.min(HEIGHT.max, Math.max(HEIGHT.min, b.height)) : DEFAULT_BODY.height;
  return { sex, height };
}
