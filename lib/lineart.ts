import * as THREE from 'three';
import type { SceneView } from './sceneview';
import { styleDef } from './styles';
import type { Style } from './types';

/**
 * Draws ink lines where one body part meets another (joints, waist, limbs crossing).
 * Silhouettes come from the mannequin's outline hulls; this pass adds the interior lines.
 *
 * 1. Render every figure/prop part with a flat colour into an off-screen ID buffer.
 * 2. After the normal render, overlay a full-screen quad that inks pixels whose
 *    neighbours belong to a different part.
 */
export class LineArtPass {
  private target = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    // (Its depth too: folds of one part, a breast over the chest, an arm over its own side.)
    depthTexture: new THREE.DepthTexture(1, 1),
  });
  private quadScene = new THREE.Scene();
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: THREE.ShaderMaterial;
  private size = new THREE.Vector2();
  private clearColor = new THREE.Color();
  private enabled = true;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tId: { value: this.target.texture },
        tDepth: { value: this.target.depthTexture },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 100 },
        ortho: { value: false },
        texel: { value: new THREE.Vector2() },
        radius: { value: 1 },
        color: { value: new THREE.Color('#0b0b0b') },
        opacity: { value: 1 },
        dry: { value: 0 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        #include <packing>
        uniform sampler2D tId;
        uniform sampler2D tDepth;
        uniform float cameraNear;
        uniform float cameraFar;
        uniform bool ortho;
        uniform vec2 texel;
        uniform float radius;
        uniform vec3 color;
        uniform float opacity;
        uniform float dry;
        varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        float differs(vec3 c, vec2 offset) {
          vec3 s = texture2D(tId, vUv + offset * texel * radius).rgb;
          // Background (black) is handled by the silhouette hulls.
          if (s.r + s.g + s.b < 0.001) return 0.0;
          return step(0.02, distance(s, c));
        }
        float depthAt(vec2 uv) {
          float d = texture2D(tDepth, uv).x;
          return -(ortho ? orthographicDepthToViewZ(d, cameraNear, cameraFar) : perspectiveDepthToViewZ(d, cameraNear, cameraFar));
        }
        // A fold of the same part: this side nearer than its neighbours across it, by more than a
        // slope would make it (their mean against it), so ramps and curves seen at a slant are not lines.
        float folds(vec3 c, float z, vec2 dir) {
          vec2 a = vUv + dir * texel * radius, b = vUv - dir * texel * radius;
          vec3 ca = texture2D(tId, a).rgb, cb = texture2D(tId, b).rgb;
          if (distance(ca, c) >= 0.02 || distance(cb, c) >= 0.02) return 0.0;
          float bend = depthAt(a) + depthAt(b) - 2.0 * z;
          return smoothstep(0.012, 0.03, bend / max(z, 0.5));
        }
        void main() {
          vec3 c = texture2D(tId, vUv).rgb;
          if (c.r + c.g + c.b < 0.001) discard;
          float d = differs(c, vec2(1.0, 0.0)) + differs(c, vec2(-1.0, 0.0))
                  + differs(c, vec2(0.0, 1.0)) + differs(c, vec2(0.0, -1.0))
                  + 0.5 * (differs(c, vec2(0.7, 0.7)) + differs(c, vec2(-0.7, 0.7))
                         + differs(c, vec2(0.7, -0.7)) + differs(c, vec2(-0.7, -0.7)));
          float z = depthAt(vUv);
          d += 2.0 * max(max(folds(c, z, vec2(1.0, 0.0)), folds(c, z, vec2(0.0, 1.0))), max(folds(c, z, vec2(0.7, 0.7)), folds(c, z, vec2(0.7, -0.7))));
          float a = clamp(d / 2.0, 0.0, 1.0);
          // (A dry brush: broken and uneven, as the outline is.)
          if (dry > 0.0) a *= mix(1.0, smoothstep(0.3, 0.6, noise(gl_FragCoord.xy / (6.0 * radius))), dry);
          if (a <= 0.0) discard;
          gl_FragColor = vec4(color, a * opacity);
          #include <colorspace_fragment>
        }`,
    });
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
  }

  /** Line colour and opacity for a style; styles without interior lines skip the pass. */
  setStyle(style: Style) {
    const lines = styleDef(style).interior;
    this.enabled = lines !== null;
    if (lines) {
      this.material.uniforms.color.value.set(lines.color);
      this.material.uniforms.opacity.value = lines.alpha;
      this.material.uniforms.dry.value = lines.dry ?? 0;
    }
  }

  /** Render the ID buffer. Call before the main scene render. */
  prepare(renderer: THREE.WebGLRenderer, view: SceneView, camera: THREE.Camera, lineWidthPx: number) {
    if (!this.enabled) return;
    renderer.getDrawingBufferSize(this.size);
    this.target.setSize(this.size.x, this.size.y);
    this.material.uniforms.texel.value.set(1 / this.size.x, 1 / this.size.y);
    this.material.uniforms.radius.value = Math.max(0.5, (lineWidthPx * renderer.getPixelRatio()) / 2);
    const cam = camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
    this.material.uniforms.cameraNear.value = cam.near;
    this.material.uniforms.cameraFar.value = cam.far;
    this.material.uniforms.ortho.value = (cam as THREE.OrthographicCamera).isOrthographicCamera === true;

    const prevTarget = renderer.getRenderTarget();
    const prevAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clearColor);
    renderer.setClearColor(0x000000, 1);
    renderer.setRenderTarget(this.target);
    renderer.clear();
    view.setIdMode(true);
    // (The parts alone: their lines, on a layer of their own, left out.)
    const layers = camera.layers.mask;
    camera.layers.set(0);
    renderer.render(view.root, camera);
    camera.layers.mask = layers;
    view.setIdMode(false);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(this.clearColor, prevAlpha);
  }

  /** Overlay the interior lines. Call after the main scene render. */
  overlay(renderer: THREE.WebGLRenderer) {
    if (!this.enabled) return;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.quadScene, this.quadCamera);
    renderer.autoClear = autoClear;
  }
}
