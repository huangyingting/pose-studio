import type { BodyParams } from './types';

export const DEFAULT_BODY: BodyParams = { sex: 1, height: 1.7, build: 0.35, head: 1, legs: 1, bust: 0.5 };

export const BODY_PRESETS: { name: string; body: BodyParams }[] = [
  { name: 'Female', body: DEFAULT_BODY },
  { name: 'Male', body: { sex: 0, height: 1.8, build: 0.45, head: 1, legs: 1, bust: 0 } },
  { name: 'Athletic', body: { sex: 0.15, height: 1.85, build: 0.6, head: 0.95, legs: 1.04, bust: 0.1 } },
  { name: 'Heroic', body: { sex: 0, height: 1.95, build: 0.75, head: 0.88, legs: 1.08, bust: 0 } },
  { name: 'Slender', body: { sex: 0.8, height: 1.75, build: 0.1, head: 0.95, legs: 1.08, bust: 0.25 } },
  { name: 'Child', body: { sex: 0.5, height: 1.25, build: 0.3, head: 1.3, legs: 0.9, bust: 0 } },
];

export const BODY_FIELDS: { key: keyof BodyParams; label: string; min: number; max: number; step: number; format(v: number): string }[] = [
  { key: 'sex', label: 'Male ↔ Female', min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'height', label: 'Height', min: 1.1, max: 2.2, step: 0.01, format: (v) => `${v.toFixed(2)} m` },
  { key: 'build', label: 'Build', min: 0, max: 1, step: 0.01, format: (v) => (v < 0.33 ? 'Slim' : v < 0.66 ? 'Average' : 'Heavy') },
  { key: 'head', label: 'Head size', min: 0.75, max: 1.4, step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'legs', label: 'Leg length', min: 0.75, max: 1.15, step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'bust', label: 'Chest', min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
];

export function clampBody(b: Partial<BodyParams>): BodyParams {
  const out = { ...DEFAULT_BODY };
  for (const f of BODY_FIELDS) {
    const v = b[f.key];
    if (typeof v === 'number' && Number.isFinite(v)) out[f.key] = Math.min(f.max, Math.max(f.min, v));
  }
  return out;
}
