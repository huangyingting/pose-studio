import * as THREE from 'three';
import type { SkyPaint } from './paintedsky';
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
  /** Toon-shaded, each character in its own colours and textures (as Anime). */
  toon?: true;
  /** Toon-shaded as watercolour washes are (#28): soft edges, pigment pooling at the edges, paler, the paper's grain. */
  wash?: true;
  /** Drawn in big pixels: so many screen pixels each, in a few colours (lib/pixel.ts). */
  pixel?: number;
  /** Behind an outdoor set: its sky as photographed (3D), or painted in the style's way (#28); none: the background. */
  sky?: 'photo' | SkyPaint;
  /** Its light mapped to the picture as film takes it (tone mapping: highlights roll off, no flat clipping), #28. */
  filmic?: true;
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
  watercolor: {
    id: 'watercolor',
    label: 'Watercolour',
    description: 'Watercolour: soft washes in each thing’s own colours, pooling at their edges, a light pencil line, the paper’s grain, a washed sky',
    background: '#f7f2e8',
    outline: { color: '#6e6052', scale: 0.55, jitter: 0.6, dry: 0.55 },
    interior: null,
    paper: true,
    toon: true,
    wash: true,
    sky: 'wash',
    shadows: true,
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
    toon: true,
    sky: 'painted',
    shadows: true,
    lit: true,
  },
  pixel: {
    id: 'pixel',
    label: 'Pixel',
    description: 'Pixel art: big square pixels in a few colours, toon-shaded with a dark outline, as in a retro game',
    background: '#dfe8f1',
    // (Its outline about a pixel wide, whatever the pixels' size.)
    outline: { color: '#1d1a26', scale: 2.2, jitter: 0 },
    interior: null,
    toon: true,
    pixel: 4,
    sky: 'painted',
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
    sky: 'photo',
    filmic: true,
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

/** How a filmic style maps its light to the picture (Khronos PBR Neutral: bright light rolls off instead of clipping, colours as they are). */
export const TONE_MAPPING = THREE.NeutralToneMapping;

export function styleDef(style: Style): StyleDef {
  return STYLE_DEFS[style] ?? STYLE_DEFS.line;
}
