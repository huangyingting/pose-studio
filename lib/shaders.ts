import * as THREE from 'three';

/*
 * Surface shaders for the painterly styles. They share world-space lighting through the
 * `lightDir` and `lightColor` uniforms (towards the key light, and its colour: set from LightRig) and use `resolution`
 * (output size in pixels) so screen-space patterns scale with the image.
 * All of them end with colorspace_fragment, so colour uniforms are ordinary sRGB colours.
 */

export const NOISE_GLSL = /* glsl */ `
  float hash13(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise3(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm3(vec3 p) {
    return 0.5 * noise3(p) + 0.25 * noise3(p * 2.03) + 0.125 * noise3(p * 4.01) + 0.0625 * noise3(p * 8.02);
  }
`;

// (The skinning chunks do nothing for plain meshes; for a skinned one, an imported character,
// three.js defines USE_SKINNING and they pose the vertices.)
const VERT = /* glsl */ `
  #include <skinning_pars_vertex>
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    vec4 world = modelMatrix * vec4(transformed, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * objectNormal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const COMMON = /* glsl */ `
  uniform vec3 lightDir;
  uniform vec3 lightColor;
  uniform vec2 resolution;
  uniform vec3 base;
  uniform vec3 shade;
  varying vec3 vNormal;
  varying vec3 vWorld;
  ${NOISE_GLSL}
`;

/**
 * Chinese ink painting (shui-mo): bare paper where the light falls (liu bai, the white left
 * empty), and on the shadow side washes in the five tones of ink, pale to dark, laid wet: their
 * edges bleed into the paper and dry darker where the ink pools, the darkest only in the deepest
 * shade; the paper's fibres show through as granulation, and ink gathers along turning edges.
 */
const INK_FRAG = /* glsl */ `
  ${COMMON}
  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(cameraPosition - vWorld);
    float lambert = dot(n, lightDir) * 0.5 + 0.5;
    // Screen-space, so the paper's grain keeps its size whatever the distance.
    vec3 px = vec3(gl_FragCoord.xy / max(1.0, resolution.y) * 700.0, 0.0);
    float bleed = fbm3(vWorld * 2.2 + 7.0);
    float bloom = fbm3(vWorld * 5.5 + 1.7);
    float fibre = fbm3(px * vec3(0.35, 1.4, 1.0)) * 0.5 + fbm3(px * vec3(1.4, 0.35, 1.0) + 3.0) * 0.5;
    // A broad stroke of the brush across the form, not only its shading.
    float sweep = fbm3(vWorld * vec3(1.2, 3.5, 1.2) + 11.0);
    float t = lambert + (bleed - 0.5) * 0.6 + (sweep - 0.5) * 0.35;
    // Pale (dan), middle (zhong) and dark (nong) washes; the burnt black (jiao) in the core.
    float pale = smoothstep(0.92, 0.62, t);
    float mid = smoothstep(0.68, 0.46, t + (bloom - 0.5) * 0.3);
    float dark = smoothstep(0.46, 0.26, t + (bloom - 0.5) * 0.2);
    float core = smoothstep(0.26, 0.1, t);
    // Wet edges: where a wash dried, its rim darker.
    float edge = pale * (1.0 - pale) * 4.0;
    float edge2 = mid * (1.0 - mid) * 4.0;
    float rim = pow(1.0 - abs(dot(n, v)), 3.0) * smoothstep(0.9, 0.45, lambert);
    float ink = 0.2 * pale + 0.24 * mid + 0.32 * dark + 0.22 * core + 0.16 * edge + 0.12 * edge2 + 0.5 * rim;
    // Granulation: the ink settles into the paper's fibres.
    ink *= 0.7 + 0.6 * fibre;
    vec3 paper = base * (0.965 + 0.05 * fibre);
    gl_FragColor = vec4(mix(paper, shade, clamp(ink, 0.0, 0.9)) * lightColor, 1.0);
    #include <colorspace_fragment>
  }
`;

/** Pencil: paper with graphite cross-hatching in up to three layers, darker where it turns away. */
const SKETCH_FRAG = /* glsl */ `
  ${COMMON}
  float hatch(vec2 p, float angle, float width) {
    float c = cos(angle), s = sin(angle);
    float d = abs(fract(p.x * c + p.y * s) - 0.5);
    return 1.0 - smoothstep(width, width + 0.12, d);
  }
  void main() {
    vec3 n = normalize(vNormal);
    float light = clamp(dot(n, lightDir), 0.0, 1.0) * 0.75 + 0.25;
    float spacing = max(3.0, resolution.y / 150.0);
    // A little wobble so the strokes look hand-drawn.
    vec2 p = gl_FragCoord.xy / spacing + (fbm3(vWorld * 18.0) - 0.5) * 0.8;
    float h = 0.0;
    h = max(h, hatch(p, 0.785, 0.1) * (1.0 - smoothstep(0.62, 0.72, light)));
    h = max(h, hatch(p * 1.07, -0.785, 0.1) * (1.0 - smoothstep(0.42, 0.52, light)));
    h = max(h, hatch(p * 0.93, 0.0, 0.12) * (1.0 - smoothstep(0.26, 0.34, light)));
    float paper = 0.96 + 0.04 * fbm3(vWorld * 40.0);
    gl_FragColor = vec4(mix(base * paper, shade, h * 0.8) * lightColor, 1.0);
    #include <colorspace_fragment>
  }
`;

/** Anime cel shading: two flat tones with a crisp terminator, a small highlight and rim light. */
const ANIME_FRAG = /* glsl */ `
  ${COMMON}
  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(cameraPosition - vWorld);
    float d = dot(n, lightDir);
    float lit = smoothstep(0.0, 0.03, d);
    vec3 col = mix(shade, base, lit);
    float spec = smoothstep(0.955, 0.97, dot(n, normalize(lightDir + v)));
    col = mix(col, vec3(1.0), spec * 0.55);
    float rim = smoothstep(0.66, 0.7, 1.0 - max(dot(n, v), 0.0)) * lit;
    col = mix(col, vec3(1.0), rim * 0.35);
    gl_FragColor = vec4(col * lightColor, 1.0);
    #include <colorspace_fragment>
  }
`;

/**
 * Flat, with a line where the surface turns away from the eye inside the figure too (under a
 * breast, the jaw, a knee bent towards the camera), not only round its outside: line art, minimal.
 */
const CONTOUR_FRAG = /* glsl */ `
  ${COMMON}
  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(cameraPosition - vWorld);
    float line = smoothstep(0.2, 0.08, abs(dot(n, v)));
    // And in the creases, where the surface folds inwards (its normals turning towards each other
    // across a pixel more than a limb's roundness turns them): under a breast, at the armpit.
    vec3 px = dFdx(vWorld), py = dFdy(vWorld);
    float concave = -(dot(dFdx(n), px) / max(dot(px, px), 1e-10) + dot(dFdy(n), py) / max(dot(py, py), 1e-10));
    line = max(line, smoothstep(16.0, 40.0, concave) * 0.8);
    gl_FragColor = vec4(mix(base, shade, line * 0.9), 1.0);
    #include <colorspace_fragment>
  }
`;

export type ShaderStyle = 'ink' | 'sketch' | 'anime' | 'contour';

const FRAGMENTS: Record<ShaderStyle, string> = { ink: INK_FRAG, sketch: SKETCH_FRAG, anime: ANIME_FRAG, contour: CONTOUR_FRAG };

export interface SharedUniforms {
  lightDir: { value: THREE.Vector3 };
  lightColor: { value: THREE.Color };
  resolution: { value: THREE.Vector2 };
}

export function styleMaterial(style: ShaderStyle, shared: SharedUniforms, base: string, shade: string) {
  return new THREE.ShaderMaterial({
    uniforms: {
      lightDir: shared.lightDir,
      lightColor: shared.lightColor,
      resolution: shared.resolution,
      base: { value: new THREE.Color(base) },
      shade: { value: new THREE.Color(shade) },
    },
    vertexShader: VERT,
    fragmentShader: FRAGMENTS[style],
  });
}

let paper: THREE.Texture | null | undefined;
/**
 * Rice paper (xuan): warm, a little mottled, with its fibres, drawn once (null where there is
 * no canvas to draw it on, as in tests): the ink style's background.
 */
export function paperTexture(): THREE.Texture | null {
  if (paper !== undefined) return paper;
  if (typeof document === 'undefined') return (paper = null);
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) return (paper = null);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  g.fillStyle = '#efe8d8';
  g.fillRect(0, 0, size, size);
  // Mottling: soft clouds a shade lighter or darker.
  for (let i = 0; i < 60; i++) {
    const [x, y, r] = [rand() * size, rand() * size, 60 + rand() * 220];
    const c = g.createRadialGradient(x, y, 0, x, y, r);
    c.addColorStop(0, rand() < 0.5 ? 'rgba(255,252,244,0.16)' : 'rgba(205,192,168,0.05)');
    c.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = c;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  // Fibres: short fine strands every way, some darker, some lighter.
  for (let i = 0; i < 1800; i++) {
    const [x, y, a, l] = [rand() * size, rand() * size, rand() * Math.PI, 4 + rand() * 22];
    g.strokeStyle = rand() < 0.6 ? `rgba(150,135,110,${0.04 + rand() * 0.06})` : `rgba(255,255,250,${0.2 + rand() * 0.25})`;
    g.lineWidth = 0.4 + rand() * 0.8;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (rand() - 0.5) * 4, y + Math.sin(a) * l * 0.5 + (rand() - 0.5) * 4, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return (paper = t);
}
