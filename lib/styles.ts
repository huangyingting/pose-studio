import { STYLES, type Style } from './types';

/**
 * Rendering styles. Each one is a complete look: surface material, outline, contour rings,
 * interior lines, background and whether the key light casts shadows. Materials are built
 * from this description in ink.ts / shaders.ts.
 */
export interface StyleDef {
  id: Style;
  label: string;
  description: string;
  /** Canvas / export background. */
  background: string;
  /** Silhouette outline (inverted hull). `jitter` varies the width like a brush (0–1). */
  outline: { color: string; scale: number; jitter: number } | null;
  /** Cross-contour rings on limbs and torso. */
  rings: string | null;
  /** Face feature lines (eyes, brows, mouth). */
  face: string | null;
  /** Lines where parts meet (line-art ID pass). */
  interior: { color: string; alpha: number } | null;
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
    rings: '#8f8f8f',
    face: '#4a4a4a',
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
    rings: '#a9a59d',
    face: '#55524d',
    interior: { color: '#2e2d2b', alpha: 0.75 },
    shadows: false,
    lit: true,
  },
  ink: {
    id: 'ink',
    label: 'Ink wash',
    description: 'Sumi-e brush lines and soft ink washes on rice paper',
    background: '#f1ebdd',
    outline: { color: '#141210', scale: 1.35, jitter: 0.75 },
    rings: null,
    face: '#2c2925',
    interior: { color: '#141210', alpha: 0.55 },
    shadows: false,
    lit: true,
  },
  anime: {
    id: 'anime',
    label: 'Anime',
    description: 'Cel shading with crisp shadow bands and rim light',
    background: '#f6f7fb',
    outline: { color: '#3b2b3a', scale: 1.15, jitter: 0 },
    rings: null,
    face: '#6b4f5f',
    interior: { color: '#3b2b3a', alpha: 0.9 },
    shadows: true,
    lit: true,
  },
  toon: {
    id: 'toon',
    label: 'Toon',
    description: 'Toon shading in each character’s own colours and textures (VRM avatars as made), with outlines',
    background: '#f4f6fb',
    outline: { color: '#2b2228', scale: 1, jitter: 0 },
    rings: null,
    face: '#5d4752',
    // (Outlines only: lines between parts would box a VRM's see-through cards, its lashes and hair.)
    interior: null,
    shadows: true,
    lit: true,
  },
  shaded: {
    id: 'shaded',
    label: 'Clay',
    description: 'Soft studio lighting with cast shadows, for value studies',
    background: '#ffffff',
    outline: { color: '#0b0b0b', scale: 1, jitter: 0 },
    rings: '#8f8f8f',
    face: '#4a4a4a',
    interior: { color: '#0b0b0b', alpha: 1 },
    shadows: true,
    lit: true,
  },
  minimal: {
    id: 'minimal',
    label: 'Minimal',
    description: 'Flat shapes and a hairline outline',
    background: '#eeece7',
    outline: { color: '#a29d93', scale: 0.7, jitter: 0 },
    rings: null,
    face: '#b9b4aa',
    interior: null,
    shadows: false,
    lit: false,
  },
  silhouette: {
    id: 'silhouette',
    label: 'Silhouette',
    description: 'Solid shapes, to check gesture and readability',
    background: '#ffffff',
    outline: { color: '#111111', scale: 1, jitter: 0 },
    rings: null,
    face: null,
    interior: null,
    shadows: false,
    lit: false,
  },
};

export const STYLE_LIST = STYLES.map((s) => STYLE_DEFS[s]);

export function styleDef(style: Style): StyleDef {
  return STYLE_DEFS[style] ?? STYLE_DEFS.line;
}
