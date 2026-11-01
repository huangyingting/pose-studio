import * as THREE from 'three';
import { EXTRA_GLSL, NOISE_GLSL, type SharedUniforms } from './shaders';

/*
 * The Anime style's surface (#15): a material in the manner of MToon (the VRM toon material, an
 * open specification), in our own code. A lit colour and a shade colour, each with its texture,
 * split at a crisp edge whose place (`shift`) and softness (`toony`) are the material's; a rim
 * light; a glow; cut-out or blended edges; in the scene's key light. VRM characters bring theirs
 * (lib/vrm.ts); other imported characters painted with textures one from their materials
 * (paintedLook); the mannequin and props one from their colours (flatLook).
 */

/** How a surface looks in the Anime style. */
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
 * The looks a model's meshes bring of their own (a VRM avatar's: lib/vrm.ts; a painted one's), by its meshes as read
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

/** A look from a painted material (an imported character's, not a VRM): its colour and texture, shaded a cool darker of them. */
export function paintedLook(m: THREE.MeshStandardMaterial): ToonLook {
  return {
    ...flatLook('#ffffff', '#ffffff'),
    color: m.color.clone(), opacity: m.opacity, map: m.map ?? null,
    shade: m.color.clone().multiply(new THREE.Color(0.55, 0.52, 0.62)), shadeMap: m.map ?? null,
    rim: new THREE.Color(0.08, 0.08, 0.08),
    emissive: m.emissive?.clone() ?? new THREE.Color(0, 0, 0), emissiveMap: m.emissiveMap ?? null,
    alpha: m.alphaTest > 0 ? 'mask' : m.transparent ? 'blend' : 'opaque', cutoff: m.alphaTest > 0 ? m.alphaTest : 0.5,
    doubleSided: m.side === THREE.DoubleSide,
  };
}

// (The skinning chunks do nothing for plain meshes; for a skinned one, an imported character,
// three.js defines USE_SKINNING and they pose the vertices.)
const VERT = /* glsl */ `
  #ifdef TOON_SHADOWS
    #include <common>
    #include <shadowmap_pars_vertex>
  #endif
  #include <morphtarget_pars_vertex>
  #include <skinning_pars_vertex>
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying vec2 vUv;
  void main() {
    #include <beginnormal_vertex>
    #include <morphnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    #include <morphtarget_vertex>
    #include <skinning_vertex>
    vec4 world = modelMatrix * vec4(transformed, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * objectNormal);
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * world;
    #ifdef TOON_SHADOWS
      // (Where it is in the key's shadow map, as three's own materials work it out.)
      vec3 transformedNormal = normalMatrix * objectNormal;
      vec4 worldPosition = world;
      vec4 mvPosition = viewMatrix * world;
      #include <shadowmap_vertex>
    #endif
  }
`;

const FRAG = /* glsl */ `
  #ifdef TOON_SHADOWS
    #include <common>
    #include <packing>
    #include <lights_pars_begin>
    #include <shadowmap_pars_fragment>
  #endif
  uniform vec3 lightDir;
  uniform vec3 lightColor;
  ${EXTRA_GLSL}
  ${NOISE_GLSL}
  uniform vec3 color;
  uniform float opacity;
  uniform sampler2D map;
  uniform bool useMap;
  uniform mat3 mapTransform;
  uniform vec3 shade;
  uniform sampler2D shadeMap;
  uniform bool useShadeMap;
  uniform mat3 shadeMapTransform;
  uniform float shift;
  uniform float toony;
  uniform vec3 rim;
  uniform float rimPower;
  uniform float rimLift;
  uniform vec3 emissive;
  uniform sampler2D emissiveMap;
  uniform bool useEmissiveMap;
  uniform mat3 emissiveMapTransform;
  uniform int alphaMode;
  uniform float cutoff;
  // (A face: shaded by where the head faces more than by its every curve, as anime faces are: a
  // clean shadow across it, not blots round the nose and the eyes.)
  uniform vec3 faceFront;
  uniform float faceSmooth;
  uniform float wash;
  uniform vec2 resolution;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying vec2 vUv;
  // (A texture's own placement on the model: its offset, repeat and turn, as glTF's texture transform has them.)
  vec2 placed(mat3 t) { return (t * vec3(vUv, 1.0)).xy; }
  void main() {
    vec4 base = vec4(color, opacity);
    if (useMap) base *= texture2D(map, placed(mapTransform));
    if (alphaMode == 1 && base.a < cutoff) discard;
    vec3 shaded = shade;
    if (useShadeMap) shaded *= texture2D(shadeMap, placed(shadeMapTransform)).rgb;
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    if (faceSmooth > 0.0) n = normalize(mix(n, faceFront, faceSmooth));
    vec3 v = normalize(cameraPosition - vWorld);
    // Lit or in shade, by the key light: the edge where the material puts it, as crisp as it says.
    float soft = max(1e-3, 1.0 - toony);
    // (In watercolour the edge between them a soft wash's.)
    if (wash > 0.5) soft = max(soft, 0.45);
    float lit = clamp((dot(n, lightDir) + shift + soft) / (2.0 * soft), 0.0, 1.0);
    #if defined(TOON_SHADOWS) && defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
      // In the key's shadow (another thing's, cast on it): in shade, as a cel shadow is.
      DirectionalLightShadow keyShadow = directionalLightShadows[0];
      if (receiveShadow) lit = min(lit, getShadow(directionalShadowMap[0], keyShadow.shadowMapSize, keyShadow.shadowIntensity, keyShadow.shadowBias, keyShadow.shadowRadius, vDirectionalShadowCoord[0]));
    #endif
    vec3 col = mix(shaded, base.rgb, lit);
    col += rim * pow(clamp(1.0 - max(dot(n, v), 0.0) + rimLift, 0.0, 1.0), max(rimPower, 1e-3));
    // The other lights: a fill's colour on its side, a light from behind as a rim along the edge.
    col += extraLight(n, v, 4.0, vWorld) * mix(base.rgb, vec3(1.0), 0.5);
    if (wash > 0.5) {
      // Watercolour: paler and uneven, as a wash lies; the pigment pooled where it dried (the edge
      // between light and shade) and along the edges of the form; the paper's tooth through it all.
      vec3 px = vec3(gl_FragCoord.xy / max(1.0, resolution.y) * 600.0, 0.0);
      float tooth = fbm3(px * 0.5);
      float bloom = fbm3(vWorld * 3.0 + 5.0);
      float dried = lit * (1.0 - lit) * 4.0;
      float rimmed = smoothstep(0.55, 0.95, 1.0 - abs(dot(n, v)));
      col = mix(col, vec3(1.0, 0.985, 0.95), clamp(0.22 + (bloom - 0.5) * 0.3, 0.0, 1.0));
      col *= (1.0 - 0.12 * dried - 0.16 * rimmed) * (0.94 + 0.12 * tooth);
    }
    vec3 glow = emissive;
    if (useEmissiveMap) glow *= texture2D(emissiveMap, placed(emissiveMapTransform)).rgb;
    gl_FragColor = vec4(col * lightColor + glow, alphaMode == 2 ? base.a : 1.0);
    #include <colorspace_fragment>
  }
`;

/**
 * The material for a look, lit by the key light (`lightDir`: towards it, and `lightColor`) and the
 * others (`extra…`); shared. `shadows`: the key's shadows cast on it are its shade (a set's
 * surfaces: what the people's shadows fall on).
 */
export function toonMaterial(look: ToonLook, { lightDir, lightColor, extraDirs, extraColors, extraPlaces, extraSpots, extraCount, resolution, wash }: Pick<SharedUniforms, 'lightDir' | 'lightColor' | 'extraDirs' | 'extraColors' | 'extraPlaces' | 'extraSpots' | 'extraCount' | 'resolution' | 'wash'>, shadows = false): THREE.ShaderMaterial {
  const placing = (t: THREE.Texture | null) => {
    t?.updateMatrix();
    return { value: t ? t.matrix : new THREE.Matrix3() };
  };
  return new THREE.ShaderMaterial({
    // (Taking shadows, it is given the scene's lights as three's own materials are: their shadow maps.)
    ...(shadows ? { lights: true, defines: { TOON_SHADOWS: '' } } : {}),
    uniforms: {
      ...(shadows ? THREE.UniformsUtils.clone(THREE.UniformsLib.lights) : {}),
      lightDir,
      lightColor,
      extraDirs,
      extraColors,
      extraPlaces,
      extraSpots,
      extraCount,
      resolution,
      wash,
      color: { value: look.color },
      opacity: { value: look.opacity },
      map: { value: look.map },
      useMap: { value: !!look.map },
      mapTransform: placing(look.map),
      shade: { value: look.shade },
      shadeMap: { value: look.shadeMap },
      useShadeMap: { value: !!look.shadeMap },
      shadeMapTransform: placing(look.shadeMap),
      shift: { value: look.shift },
      toony: { value: look.toony },
      rim: { value: look.rim },
      rimPower: { value: look.rimPower },
      rimLift: { value: look.rimLift },
      emissive: { value: look.emissive },
      emissiveMap: { value: look.emissiveMap },
      useEmissiveMap: { value: !!look.emissiveMap },
      emissiveMapTransform: placing(look.emissiveMap),
      alphaMode: { value: look.alpha === 'mask' ? 1 : look.alpha === 'blend' ? 2 : 0 },
      cutoff: { value: look.cutoff },
      faceFront: { value: new THREE.Vector3(0, 0, 1) },
      faceSmooth: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: look.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    transparent: look.alpha === 'blend',
    depthWrite: look.alpha !== 'blend',
  });
}
