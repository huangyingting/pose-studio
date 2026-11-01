import * as THREE from 'three';
import type { Sky } from './setassets';

/*
 * Skies painted for the drawn styles (#28): behind an outdoor set in Anime and Pixel a sky as an
 * anime background paints one (a gradient, clouds with a crisp edge, lit on top and shaded under,
 * stars at night); in Watercolour a wash (soft edges, the colour pooling, the paper showing). The
 * photographic sky is 3D's alone. Painted once each, on a canvas, round the whole view
 * (equirectangular: no seam, sampled by direction).
 */

export type SkyPaint = 'painted' | 'wash';

/** Each sky's colours: zenith, (mid,) horizon; the clouds lit and in shade; how much of it they cover (0–1). */
const PALETTES: Record<Sky, { stops: string[]; cloud: string; shade: string; cover: number; stars?: true }> = {
  day: { stops: ['#3a78d4', '#79b0ea', '#cfe9f8'], cloud: '#ffffff', shade: '#c5d2ef', cover: 0.42 },
  dusk: { stops: ['#34407e', '#d47a86', '#ffc58c'], cloud: '#ffd6b8', shade: '#9b6f9c', cover: 0.38 },
  night: { stops: ['#070d27', '#16244d', '#2f4675'], cloud: '#34466f', shade: '#1b2445', cover: 0.3, stars: true },
  overcast: { stops: ['#7f8b9c', '#a5afbc', '#cfd5dc'], cloud: '#e4e7eb', shade: '#a7b0bc', cover: 0.75 },
};

const W = 1024;
const H = 512;

// (Value noise in 3D, so the sky has no seam where its picture wraps round.)
const hash = (x: number, y: number, z: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
};
const ease = (t: number) => t * t * (3 - 2 * t);
function noise(x: number, y: number, z: number) {
  const [xi, yi, zi] = [Math.floor(x), Math.floor(y), Math.floor(z)];
  const [u, v, w] = [ease(x - xi), ease(y - yi), ease(z - zi)];
  const at = (a: number, b: number, c: number) => hash(xi + a, yi + b, zi + c);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  return lerp(
    lerp(lerp(at(0, 0, 0), at(1, 0, 0), u), lerp(at(0, 1, 0), at(1, 1, 0), u), v),
    lerp(lerp(at(0, 0, 1), at(1, 0, 1), u), lerp(at(0, 1, 1), at(1, 1, 1), u), v),
    w,
  );
}
function fbm(x: number, y: number, z: number) {
  let [sum, amp, f] = [0, 0.5, 1];
  for (let i = 0; i < 5; i++) {
    sum += amp * noise(x * f, y * f, z * f);
    amp *= 0.5;
    f *= 2.03;
  }
  return sum;
}
const step = (a: number, b: number, x: number) => ease(Math.min(1, Math.max(0, (x - a) / (b - a))));

const made = new Map<string, THREE.Texture>();
/** A sky painted in a style's way (null where nothing is drawn: in Node, the tests'). */
export function paintedSky(sky: Sky, paint: SkyPaint): THREE.Texture | null {
  const key = `${sky}:${paint}`;
  if (made.has(key) || typeof document === 'undefined') return made.get(key) ?? null;
  const p = PALETTES[sky];
  const stops = p.stops.map((c) => new THREE.Color(c));
  const [cloud, shade] = [new THREE.Color(p.cloud), new THREE.Color(p.shade)];
  const wash = paint === 'wash';
  // (Crisp in an anime's sky, soft in a wash.)
  const edge = wash ? 0.07 : 0.012;
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = [W, H];
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(W, H);
  const c = new THREE.Color();
  const density = (x: number, y: number, z: number) => fbm(x * 2.4 + 11, y * 6 + 3, z * 2.4 + 7);
  for (let j = 0; j < H; j++) {
    const lat = (0.5 - (j + 0.5) / H) * Math.PI;
    const up = Math.sin(lat);
    for (let i = 0; i < W; i++) {
      const lon = ((i + 0.5) / W) * 2 * Math.PI - Math.PI;
      const [x, z] = [Math.cos(lat) * Math.sin(lon), Math.cos(lat) * Math.cos(lon)];
      // The gradient: from the horizon up (below it, the horizon's haze).
      const h = Math.max(0, up) ** 0.55;
      if (h < 0.5) c.copy(stops[2]).lerp(stops[1], h * 2);
      else c.copy(stops[1]).lerp(stops[0], (h - 0.5) * 2);
      if (up < 0) c.multiplyScalar(0.92);
      // Clouds: thicker low in the sky, none overhead or under the horizon; flattened towards it.
      const band = step(0.0, 0.1, up) * (1 - step(0.55, 0.9, up));
      const d = density(x, up, z) - (1 - p.cover) * 0.55 - (1 - band) * 0.4;
      const cover = step(0.3 - edge, 0.3 + edge, d);
      if (cover > 0) {
        // Lit on top, shaded under: thinner just below, the cloud's underside.
        const below = density(x, up - 0.035, z) - (1 - p.cover) * 0.55 - (1 - band) * 0.4;
        const lit = step(0.33 - edge, 0.33 + edge, below);
        const tone = shade.clone().lerp(cloud, lit);
        c.lerp(tone, cover * (wash ? 0.75 : 1));
      }
      if (p.stars && up > 0.05 && hash(i, j, 3) > 0.9985) c.lerp(new THREE.Color('#fff8e0'), 0.9);
      if (wash) {
        // The paper and the pigment: the grain, the colour pooling, paler as a wash is.
        const grain = (noise(i * 0.6, j * 0.6, 1) - 0.5) * 0.06 + (fbm(i * 0.02, j * 0.02, 5) - 0.5) * 0.12;
        c.lerp(new THREE.Color('#ffffff'), 0.28).multiplyScalar(1 + grain);
      }
      const o = (j * W + i) * 4;
      c.convertLinearToSRGB();
      img.data[o] = Math.round(Math.min(1, c.r) * 255);
      img.data[o + 1] = Math.round(Math.min(1, c.g) * 255);
      img.data[o + 2] = Math.round(Math.min(1, c.b) * 255);
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(canvas);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  made.set(key, t);
  return t;
}
