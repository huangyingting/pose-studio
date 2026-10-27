import * as THREE from 'three';

/*
 * Surface shaders for the painterly styles. They share world-space lighting through the
 * `lightDir` uniform (towards the key light, set from LightRig) and use `resolution`
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
  uniform vec2 resolution;
  uniform vec3 base;
  uniform vec3 shade;
  varying vec3 vNormal;
  varying vec3 vWorld;
  ${NOISE_GLSL}
`;

/** Sumi-e: paper-coloured surface with soft, bleeding ink washes on the shadow side. */
const INK_FRAG = /* glsl */ `
  ${COMMON}
  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(cameraPosition - vWorld);
    float lambert = dot(n, lightDir) * 0.5 + 0.5;
    float grain = fbm3(vWorld * 14.0);
    float bleed = fbm3(vWorld * 3.5 + 7.0);
    // Two washes: a pale one over most of the shadow side, a darker one in the core shadow.
    float wash1 = smoothstep(0.82, 0.5, lambert + (bleed - 0.5) * 0.4);
    float wash2 = smoothstep(0.45, 0.2, lambert + (bleed - 0.5) * 0.3);
    // Ink pools along the turning edges.
    float rim = pow(1.0 - abs(dot(n, v)), 2.5);
    float ink = 0.26 * wash1 + 0.3 * wash2 + 0.3 * rim;
    ink *= 0.7 + 0.6 * grain;
    gl_FragColor = vec4(mix(base, shade, clamp(ink, 0.0, 0.9)), 1.0);
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
    gl_FragColor = vec4(mix(base * paper, shade, h * 0.8), 1.0);
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
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export type ShaderStyle = 'ink' | 'sketch' | 'anime';

const FRAGMENTS: Record<ShaderStyle, string> = { ink: INK_FRAG, sketch: SKETCH_FRAG, anime: ANIME_FRAG };

export interface SharedUniforms {
  lightDir: { value: THREE.Vector3 };
  resolution: { value: THREE.Vector2 };
}

export function styleMaterial(style: ShaderStyle, shared: SharedUniforms, base: string, shade: string) {
  return new THREE.ShaderMaterial({
    uniforms: {
      lightDir: shared.lightDir,
      resolution: shared.resolution,
      base: { value: new THREE.Color(base) },
      shade: { value: new THREE.Color(shade) },
    },
    vertexShader: VERT,
    fragmentShader: FRAGMENTS[style],
  });
}
