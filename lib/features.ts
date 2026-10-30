import * as THREE from 'three';

/*
 * A character's face in the styles that draw it in one flat colour (line art, minimal, ink…):
 * its eyes, pupils, brows, lashes and lips inked from its own textures. Where the texture is much
 * darker than around it (a lid, a brow, the lips' line, an iris's rim) or very dark (a pupil, a
 * lash), it is inked; only on the head (by how much each vertex goes with the head's bones), not
 * on the hair. Drawn over its body, a mesh of its own with the body's skeleton.
 */

/** The per-vertex attribute: how much it goes with the head (0–1). */
export const HEAD = 'headWeight';

/**
 * Give a mesh's geometry how much each vertex goes with the head: the sum of its skin weights on
 * `head` (the bones of the head, given by their skeleton indices). Whether any does.
 */
export function weighHead(geometry: THREE.BufferGeometry, head: Set<number>, whole = false): boolean {
  if (geometry.getAttribute(HEAD)) return true;
  const n = geometry.getAttribute('position').count;
  const w = new Float32Array(n);
  const index = geometry.getAttribute('skinIndex');
  const weight = geometry.getAttribute('skinWeight');
  let any = false;
  for (let i = 0; i < n; i++) {
    let sum = whole ? 1 : 0;
    if (!whole && index && weight) for (let k = 0; k < 4; k++) if (head.has(index.getComponent(i, k))) sum += weight.getComponent(i, k);
    w[i] = Math.min(1, sum);
    any ||= sum > 0.3;
  }
  if (any) geometry.setAttribute(HEAD, new THREE.BufferAttribute(w, 1));
  return any;
}

/**
 * The ink for a texture's features, in `color` (shared: the style's line colour). `eye`: an eye of
 * its own (a mesh), its iris filled (an eye with its pupil, as drawn), not only its rim.
 */
export function featureMaterial(map: THREE.Texture, color: { value: THREE.Color }, eye = false): THREE.ShaderMaterial {
  map.updateMatrix();
  return new THREE.ShaderMaterial({
    ...(eye ? { defines: { EYE: '' } } : {}),
    uniforms: { map: { value: map }, mapTransform: { value: map.matrix }, color },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    vertexShader: /* glsl */ `
      #include <skinning_pars_vertex>
      attribute float ${HEAD};
      uniform mat3 mapTransform;
      varying vec2 vUv;
      varying float vHead;
      void main() {
        vUv = (mapTransform * vec3(uv, 1.0)).xy;
        vHead = ${HEAD};
        #include <begin_vertex>
        #include <skinbase_vertex>
        #include <skinning_vertex>
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec3 color;
      varying vec2 vUv;
      varying float vHead;
      float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
      void main() {
        if (vHead < 0.3) discard;
        vec4 t = texture2D(map, vUv);
        float sharp = lum(t.rgb);
        // (Around it: the texture blurred, a few mip levels down.)
        float around = lum(texture2D(map, vUv, 3.5).rgb);
        // Lines: darker than around (lids, brows, the lips' line, an iris's rim).
        float line = smoothstep(0.07, 0.2, around - sharp);
        // Fills: very dark, and much darker than around (pupils, lashes).
        float fill = smoothstep(0.32, 0.12, sharp) * smoothstep(0.7, 0.45, sharp / max(around, 0.05));
        #ifdef EYE
          // (An iris: much darker than the white round it, not only at its rim.)
          fill = max(fill, smoothstep(0.75, 0.6, sharp / max(around, 0.05)) * smoothstep(0.7, 0.55, sharp));
        #endif
        float ink = max(line, fill) * t.a * smoothstep(0.3, 0.6, vHead);
        if (ink < 0.3) discard;
        gl_FragColor = vec4(color, ink);
        #include <colorspace_fragment>
      }`,
  });
}

/**
 * A part in one colour where its texture is, its clear parts cut away: hair in the style's line
 * colour, solid as hair is drawn in ink (no pale gaps at the hairline); an eye, a brow or a lash
 * white, their features inked over them (an eye's clear cornea not hiding its iris).
 */
export function cutoutMaterial(map: THREE.Texture, color: { value: THREE.Color }): THREE.ShaderMaterial {
  map.updateMatrix();
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, mapTransform: { value: map.matrix }, color },
    vertexShader: /* glsl */ `
      #include <skinning_pars_vertex>
      uniform mat3 mapTransform;
      varying vec2 vUv;
      void main() {
        vUv = (mapTransform * vec3(uv, 1.0)).xy;
        #include <begin_vertex>
        #include <skinbase_vertex>
        #include <skinning_vertex>
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec3 color;
      varying vec2 vUv;
      void main() {
        if (texture2D(map, vUv).a < ${CUTOFF.toFixed(2)}) discard;
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

/** Where a texture is clear enough to be cut away (as drawn, outlined and lined). */
export const CUTOFF = 0.5;
