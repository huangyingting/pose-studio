import { STYLES, type Style } from './types';

/**
 * Rendering styles. Each one is a complete look: surface material, outline, interior
 * lines, background and whether the key light casts shadows. Materials are built
 * from this description in ink.ts / shaders.ts.
 */
export interface StyleDef {
  id: Style;
  label: string;
  description: string;
  /** Canvas / export background. */
  background: string;
  /**
   * Silhouette outline (inverted hull). `jitter` varies the width like a brush (0–1); `dry`
   * breaks it and pales it in places, as a dry brush does (0–1).
   */
  outline: { color: string; scale: number; jitter: number; dry?: number } | null;
  /** Lines where parts meet (line-art ID pass), broken as a dry brush leaves them (`dry`, 0–1). */
  interior: { color: string; alpha: number; dry?: number } | null;
  /** Drawn on rice paper: a paper texture behind (and on) everything. */
  paper?: true;
  /** The key light casts shadows onto the floor. */
  shadows: boolean;
  /** The light direction controls affect this style. */
  lit: boolean;
}

export const STYLE_DEFS: Record<Style, StyleDef> = {
  line: {
    id: 'line',
    label: 'Line art',
    description: 'Clean ink outlines, as in the reference sheet',
    background: '#ffffff',
    outline: { color: '#0b0b0b', scale: 1, jitter: 0 },
    interior: { color: '#0b0b0b', alpha: 1 },
    shadows: false,
    lit: false,
  },
  sketch: {
    id: 'sketch',
    label: 'Pencil',
    description: 'Graphite outlines with cross-hatched shading',
    background: '#fbfaf6',
    outline: { color: '#2e2d2b', scale: 0.85, jitter: 0.45 },
    interior: { color: '#2e2d2b', alpha: 0.75 },
    shadows: false,
    lit: true,
  },
  ink: {
    id: 'ink',
    label: 'Ink wash',
    description: 'Chinese ink painting: dry-brush outlines, washes in five tones of ink that bleed and pool, and bare rice paper',
    background: '#efe8d8',
    outline: { color: '#16130f', scale: 1.6, jitter: 0.9, dry: 0.7 },
    interior: { color: '#2a2520', alpha: 0.4, dry: 0.6 },
    paper: true,
    shadows: false,
    lit: true,
  },
  anime: {
    id: 'anime',
    label: 'Anime',
    description: 'Anime toon shading in each character’s own colours and textures (VRM avatars as made), with outlines',
    background: '#f4f6fb',
    outline: { color: '#2b2228', scale: 1, jitter: 0 },
    // (Outlines only: lines between parts would box a VRM's see-through cards, its lashes and hair.)
    interior: null,
    shadows: true,
    lit: true,
  },
  render: {
    id: 'render',
    label: '3D',
    description: 'A 3D render: each character in its own colours and textures, in the scene’s lights and shadows, no lines',
    background: '#eef0f3',
    outline: null,
    interior: null,
    shadows: true,
    lit: true,
  },
  shaded: {
    id: 'shaded',
    label: 'Clay',
    description: 'Soft studio lighting with cast shadows, for value studies: form from light and shade alone, no lines',
    background: '#ffffff',
    outline: null,
    interior: null,
    shadows: true,
    lit: true,
  },
  minimal: {
    id: 'minimal',
    label: 'Minimal',
    description: 'Flat shapes and a hairline outline',
    background: '#eeece7',
    outline: { color: '#a29d93', scale: 0.7, jitter: 0 },
    interior: null,
    shadows: false,
    lit: false,
  },
};

export const STYLE_LIST = STYLES.map((s) => STYLE_DEFS[s]);

export function styleDef(style: Style): StyleDef {
  return STYLE_DEFS[style] ?? STYLE_DEFS.line;
}
