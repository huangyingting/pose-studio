import * as THREE from 'three';
import { LINES_LAYER } from './ink';
import { styleDef } from './styles';

/*
 * The Watercolour style's look (lib/styles.ts): the scene painted, not shaded. Drawn without its
 * lines into a picture of its own, then, as Bousseau et al. (2006) and Montesdeoca's watercolour
 * (2017) do it:
 *  - abstracted: blurred along each surface but not across a step in depth, so textures and
 *    small detail melt into washes while the shapes keep their edges;
 *  - pigment's colours: brighter and purer than a render's (no greys), the shade a cool glaze;
 *  - the hand's tremor: what is read moved a little by a slow noise, so the washes' edges wander;
 *  - pigment density: turbulence (a wash's blotches), granulation (pigment settling in the paper's
 *    grain, more in the dark) and, where a wash changes, the pigment pooled at its edge as it dried;
 *    applied as Bousseau's pigment model (denser darker, thinner paler, as pigment does);
 *  - gaps: now and then, between two washes, the paper left bare;
 *  - the paper: its tooth over everything, lit from the top left.
 * Then the lines, a light pencil, drawn over the washes as drawn (not washed). Its noise is the
 * paper's (fixed to the picture, as paper is), at a size kept with the picture's height. Used by
 * the editor's canvas and by the exporter.
 */

const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** Blurred one way, along each surface: what is far nearer or further (another thing) left out. */
const BLUR_FRAG = /* glsl */ `
  #include <packing>
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform vec2 step;
  uniform float near;
  uniform float far;
  uniform bool ortho;
  varying vec2 vUv;
  float viewZ(vec2 uv) {
    float d = texture2D(tDepth, uv).x;
    return ortho ? -orthographicDepthToViewZ(d, near, far) : -perspectiveDepthToViewZ(d, near, far);
  }
  void main() {
    float z0 = viewZ(vUv);
    vec4 sum = vec4(0.0);
    float weights = 0.0;
    for (int i = -6; i <= 6; i++) {
      vec2 uv = vUv + step * float(i);
      float dz = (viewZ(uv) - z0) / (0.03 * z0 + 0.02);
      float w = exp(-float(i * i) / 18.0) * exp(-dz * dz);
      sum += texture2D(tColor, uv) * w;
      weights += w;
    }
    gl_FragColor = sum / weights;
  }`;

const PAINT_FRAG = /* glsl */ `
  uniform sampler2D tSharp;
  uniform sampler2D tSoft;
  uniform vec2 resolution;
  uniform float scale;
  uniform vec3 paper;  // (as seen: sRGB)
  varying vec2 vUv;
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
    return s;
  }
  // (In the picture's own (sRGB) values: pigment darkens and pales as the eye sees it.)
  vec3 seen(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
  void main() {
    // The paper's own measure: pixels of a picture 800 high, whatever this one's size.
    vec2 px = vUv * resolution / scale;
    // The hand's tremor: the washes read a little off where they are, by a slow noise.
    vec2 wob = vec2(fbm(px * 0.011), fbm(px * 0.011 + 31.0)) - 0.5;
    vec2 uv = vUv + wob * 7.0 * scale / resolution;
    vec3 soft = seen(texture2D(tSoft, uv).rgb);
    vec3 c = mix(soft, seen(texture2D(tSharp, uv).rgb), 0.12);
    // Pigment, not a photograph's greys: brighter and purer colours, the shade a cool glaze.
    float luma = dot(c, vec3(0.299, 0.587, 0.114));
    c = pow(c, vec3(0.8));
    c = clamp(mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 1.55), 0.0, 1.0);
    c *= mix(vec3(1.0), vec3(0.9, 0.95, 1.1), (1.0 - smoothstep(0.15, 0.6, luma)) * 0.7);
    // Where a wash changes (its edge, another wash beside it): the pigment pooled there as it dried.
    vec2 e = 3.0 * scale / resolution;
    vec3 gx = seen(texture2D(tSoft, uv + vec2(e.x, 0.0)).rgb) - seen(texture2D(tSoft, uv - vec2(e.x, 0.0)).rgb);
    vec3 gy = seen(texture2D(tSoft, uv + vec2(0.0, e.y)).rgb) - seen(texture2D(tSoft, uv - vec2(0.0, e.y)).rgb);
    float edge = clamp((length(gx) + length(gy)) * 1.6, 0.0, 1.0);
    // Pigment density: a wash's blotches, the grain's, the edge's; denser darker, thinner paler
    // (where there is pigment: the bare paper stays clean).
    float dark = 1.0 - dot(c, vec3(0.299, 0.587, 0.114));
    float pigment = clamp(length(paper - c) * 3.0, 0.0, 1.0);
    float turbulence = fbm(px * 0.006 + 7.0);
    float grain = 0.6 * noise(px * 0.55) + 0.4 * noise(px * 1.4 + 3.0);
    float density = 1.0 + pigment * ((turbulence - 0.5) * 0.7 + (grain - 0.5) * (0.25 + 0.6 * dark)) + edge * 0.9;
    c = c - (c - c * c) * (density - 1.0);
    // Now and then, between two washes, the paper left bare.
    float gap = smoothstep(0.45, 0.8, edge) * smoothstep(0.68, 0.76, noise(px * 0.045 + 19.0));
    c = mix(c, paper, gap * 0.55);
    // The paper's tooth over it all, lit from the top left.
    float h = fbm(px * 0.32);
    float relief = (h - fbm((px + vec2(1.5, -1.5)) * 0.32)) * 2.2;
    c *= 0.975 + 0.05 * h + relief * 0.05;
    // (Where nothing was drawn on a see-through picture, nothing painted either.)
    float a = texture2D(tSharp, uv).a;
    gl_FragColor = vec4(pow(clamp(c, 0.0, 1.0), vec3(2.2)) * a, a);
    #include <colorspace_fragment>
  }`;

export class WatercolourPass {
  /** The scene as drawn (its depth too), then blurred one way and the other, at half the size. */
  private sharp = new THREE.WebGLRenderTarget(1, 1, { depthTexture: new THREE.DepthTexture(1, 1) });
  private across = new THREE.WebGLRenderTarget(1, 1);
  private soft = new THREE.WebGLRenderTarget(1, 1);
  private quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  private quadScene = new THREE.Scene().add(this.quad);
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private blur = new THREE.ShaderMaterial({
    uniforms: { tColor: { value: null }, tDepth: { value: null }, step: { value: new THREE.Vector2() }, near: { value: 0.1 }, far: { value: 100 }, ortho: { value: false } },
    vertexShader: QUAD_VERT,
    fragmentShader: BLUR_FRAG,
    depthTest: false,
    depthWrite: false,
  });
  private paint = new THREE.ShaderMaterial({
    uniforms: { tSharp: { value: this.sharp.texture }, tSoft: { value: this.soft.texture }, resolution: { value: new THREE.Vector2() }, scale: { value: 1 }, paper: { value: new THREE.Color(styleDef('watercolor').background).convertLinearToSRGB() } },
    vertexShader: QUAD_VERT,
    fragmentShader: PAINT_FRAG,
    depthTest: false,
    depthWrite: false,
  });
  private depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
  private size = new THREE.Vector2();

  constructor() {
    for (const t of [this.sharp, this.across, this.soft]) t.texture.colorSpace = THREE.SRGBColorSpace;
  }

  /**
   * The scene through the camera, painted, into what is drawn to now (the screen, or the exporter's
   * picture); its lines over it, and the scene's depth left behind for what is drawn over it next.
   * `scale`: the picture's height over 800 (the paper's measure).
   */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, scale: number) {
    renderer.getDrawingBufferSize(this.size);
    const [w, h] = [Math.max(1, this.size.x), Math.max(1, this.size.y)];
    const pr = renderer.getPixelRatio();
    if (this.sharp.width !== w || this.sharp.height !== h) {
      this.sharp.setSize(w, h);
      this.across.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
      this.soft.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
    }
    const before = renderer.getRenderTarget();
    const mask = camera.layers.mask;
    const autoClear = renderer.autoClear;
    // The washes: the scene without its lines.
    camera.layers.disable(LINES_LAYER);
    renderer.setRenderTarget(this.sharp);
    renderer.autoClear = true;
    renderer.render(scene, camera);
    camera.layers.mask = mask;
    // Blurred along its surfaces, one way then the other (as wide on any picture: by its scale).
    const lens = camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
    this.blur.uniforms.near.value = lens.near;
    this.blur.uniforms.far.value = lens.far;
    this.blur.uniforms.ortho.value = (lens as THREE.OrthographicCamera).isOrthographicCamera === true;
    this.blur.uniforms.tDepth.value = this.sharp.depthTexture;
    const reach = 2.2 * scale * pr;
    this.quad.material = this.blur;
    this.blur.uniforms.tColor.value = this.sharp.texture;
    this.blur.uniforms.step.value.set(reach / w, 0);
    renderer.setRenderTarget(this.across);
    renderer.render(this.quadScene, this.quadCamera);
    this.blur.uniforms.tColor.value = this.across.texture;
    this.blur.uniforms.step.value.set(0, reach / h);
    renderer.setRenderTarget(this.soft);
    renderer.render(this.quadScene, this.quadCamera);
    // Painted into the picture.
    this.quad.material = this.paint;
    this.paint.uniforms.resolution.value.set(w, h);
    this.paint.uniforms.scale.value = scale * pr;
    renderer.setRenderTarget(before);
    renderer.render(this.quadScene, this.quadCamera);
    // Its lines over the washes, hidden behind what is in front of them: the scene's depth first.
    const background = scene.background;
    const shadows = renderer.shadowMap.autoUpdate;
    scene.background = null;
    renderer.shadowMap.autoUpdate = false;
    renderer.autoClear = false;
    renderer.clearDepth();
    camera.layers.disable(LINES_LAYER);
    scene.overrideMaterial = this.depthOnly;
    renderer.render(scene, camera);
    scene.overrideMaterial = null;
    camera.layers.set(LINES_LAYER);
    renderer.render(scene, camera);
    camera.layers.mask = mask;
    scene.background = background;
    renderer.shadowMap.autoUpdate = shadows;
    renderer.autoClear = autoClear;
  }

  dispose() {
    for (const t of [this.sharp, this.across, this.soft]) t.dispose();
    this.sharp.depthTexture?.dispose();
    this.quad.geometry.dispose();
    this.blur.dispose();
    this.paint.dispose();
    this.depthOnly.dispose();
  }
}
