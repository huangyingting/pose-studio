import * as THREE from 'three';

/*
 * The Toon style's surface (#15): a material in the manner of MToon (the VRM toon material, an
 * open specification), in our own code. A lit colour and a shade colour, each with its texture,
 * split at a crisp edge whose place (`shift`) and softness (`toony`) are the material's; a rim
 * light; a glow; cut-out or blended edges; in the scene's key light. VRM characters bring theirs
 * (lib/vrm.ts); the mannequin and props are given one from their colours (flatLook).
 */

/** How a surface looks in the Toon style. */
export interface ToonLook {
  /** The lit colour and its texture (multiplied), with its opacity. */
  color: THREE.Color;
  opacity: number;
  map: THREE.Texture | null;
  /** The shade colour and its texture (multiplied): what is out of the light. */
  shade: THREE.Color;
  shadeMap: THREE.Texture | null;
  /** Where the edge between them falls (−1…1: + more lit) and how soft it is (0 soft … 1 crisp). */
  shift: number;
  toony: number;
  /** Rim light: its colour, how tight it is to the silhouette, and how far it reaches in. */
  rim: THREE.Color;
  rimPower: number;
  rimLift: number;
  /** A glow of its own (and its texture). */
  emissive: THREE.Color;
  emissiveMap: THREE.Texture | null;
  /** Opaque, cut out where the texture is clearer than `cutoff`, or blended. */
  alpha: 'opaque' | 'mask' | 'blend';
  cutoff: number;
  doubleSided: boolean;
  /** Its outline: a share of the style's width (0: none) and its colour (null: the style's). */
  outline: { width: number; color: THREE.Color | null };
}

/**
 * The looks a model's meshes bring of their own (a VRM avatar's: lib/vrm.ts), by its meshes as read
 * from its file. (Not in their userData: a copy of a model copies that as JSON, textures and all.)
 */
export const ownLooks = new WeakMap<THREE.Object3D, ToonLook>();

/** A look from two flat colours (the mannequin's, a prop's): a crisp edge, a soft rim. */
export function flatLook(base: string, shade: string): ToonLook {
  return {
    color: new THREE.Color(base), opacity: 1, map: null, shade: new THREE.Color(shade), shadeMap: null,
    shift: -0.05, toony: 0.9, rim: new THREE.Color('#ffffff').multiplyScalar(0.18), rimPower: 4, rimLift: 0,
    emissive: new THREE.Color(0, 0, 0), emissiveMap: null, alpha: 'opaque', cutoff: 0.5, doubleSided: false,
    outline: { width: 1, color: null },
  };
}

// (The skinning chunks do nothing for plain meshes; for a skinned one, an imported character,
// three.js defines USE_SKINNING and they pose the vertices.)
const VERT = /* glsl */ `
  #include <skinning_pars_vertex>
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying vec2 vUv;
  void main() {
    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    vec4 world = modelMatrix * vec4(transformed, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * objectNormal);
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 lightDir;
  uniform vec3 color;
  uniform float opacity;
  uniform sampler2D map;
  uniform bool useMap;
  uniform vec3 shade;
  uniform sampler2D shadeMap;
  uniform bool useShadeMap;
  uniform float shift;
  uniform float toony;
  uniform vec3 rim;
  uniform float rimPower;
  uniform float rimLift;
  uniform vec3 emissive;
  uniform sampler2D emissiveMap;
  uniform bool useEmissiveMap;
  uniform int alphaMode;
  uniform float cutoff;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying vec2 vUv;
  void main() {
    vec4 base = vec4(color, opacity);
    if (useMap) base *= texture2D(map, vUv);
    if (alphaMode == 1 && base.a < cutoff) discard;
    vec3 shaded = shade;
    if (useShadeMap) shaded *= texture2D(shadeMap, vUv).rgb;
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    vec3 v = normalize(cameraPosition - vWorld);
    // Lit or in shade, by the key light: the edge where the material puts it, as crisp as it says.
    float soft = max(1e-3, 1.0 - toony);
    float lit = clamp((dot(n, lightDir) + shift + soft) / (2.0 * soft), 0.0, 1.0);
    vec3 col = mix(shaded, base.rgb, lit);
    col += rim * pow(clamp(1.0 - max(dot(n, v), 0.0) + rimLift, 0.0, 1.0), max(rimPower, 1e-3));
    vec3 glow = emissive;
    if (useEmissiveMap) glow *= texture2D(emissiveMap, vUv).rgb;
    gl_FragColor = vec4(col + glow, alphaMode == 2 ? base.a : 1.0);
    #include <colorspace_fragment>
  }
`;

/** The material for a look, lit by the key light (`lightDir`: towards it, shared). */
export function toonMaterial(look: ToonLook, lightDir: { value: THREE.Vector3 }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      lightDir,
      color: { value: look.color },
      opacity: { value: look.opacity },
      map: { value: look.map },
      useMap: { value: !!look.map },
      shade: { value: look.shade },
      shadeMap: { value: look.shadeMap },
      useShadeMap: { value: !!look.shadeMap },
      shift: { value: look.shift },
      toony: { value: look.toony },
      rim: { value: look.rim },
      rimPower: { value: look.rimPower },
      rimLift: { value: look.rimLift },
      emissive: { value: look.emissive },
      emissiveMap: { value: look.emissiveMap },
      useEmissiveMap: { value: !!look.emissiveMap },
      alphaMode: { value: look.alpha === 'mask' ? 1 : look.alpha === 'blend' ? 2 : 0 },
      cutoff: { value: look.cutoff },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: look.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    transparent: look.alpha === 'blend',
    depthWrite: look.alpha !== 'blend',
  });
}
