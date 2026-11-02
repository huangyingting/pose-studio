import * as THREE from 'three';

/*
 * The Pixel style's look (lib/styles.ts): the scene drawn small, into a target a few times
 * smaller than the picture, and blown up with square pixels, its colours brought down to a few
 * flat levels each, as pixel art is: each pixel first evened with its like neighbours, so a
 * texture's fine grain does not speckle across the levels (an edge, unlike, kept). Used by the editor's canvas
 * (what it draws over the scene, its handles, stays sharp) and by the exporter.
 */
export class PixelPass {
  private target = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
  private quadScene = new THREE.Scene();
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: THREE.ShaderMaterial;
  private size = new THREE.Vector2();
  private before: THREE.WebGLRenderTarget | null = null;

  constructor() {
    this.target.texture.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: this.target.texture }, texel: { value: new THREE.Vector2() }, levels: { value: 8 } },
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene;
        uniform vec2 texel;
        uniform float levels;
        varying vec2 vUv;
        vec3 seen(vec4 c) { return pow(max(c.rgb, 0.0), vec3(1.0 / 2.2)); }
        void main() {
          vec4 c = texture2D(tScene, vUv);
          // In the picture's own (sRGB) values: evened with the neighbours like it, then so many
          // levels each, flat between (no dither: clean shapes).
          vec3 s0 = seen(c);
          vec3 sum = vec3(0.0);
          float weights = 0.0;
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec3 n = seen(texture2D(tScene, vUv + vec2(x, y) * texel));
            vec3 d = n - s0;
            float w = exp(-dot(d, d) * 60.0);
            sum += n * w;
            weights += w;
          }
          vec3 s = sum / weights;
          s = floor(s * (levels - 1.0) + 0.5) / (levels - 1.0);
          gl_FragColor = vec4(pow(clamp(s, 0.0, 1.0), vec3(2.2)), c.a);
          #include <colorspace_fragment>
        }`,
    });
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
  }

  /** Start drawing small: pixels `pixel` screen pixels each (until `end`). */
  begin(renderer: THREE.WebGLRenderer, pixel: number) {
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.round(this.size.x / (pixel * renderer.getPixelRatio())));
    const h = Math.max(1, Math.round(this.size.y / (pixel * renderer.getPixelRatio())));
    this.target.setSize(w, h);
    this.material.uniforms.texel.value.set(1 / w, 1 / h);
    this.before = renderer.getRenderTarget() as THREE.WebGLRenderTarget | null;
    renderer.setRenderTarget(this.target);
    renderer.clear();
  }

  /** What was drawn small, blown up into the picture. */
  end(renderer: THREE.WebGLRenderer) {
    renderer.setRenderTarget(this.before);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.quadScene, this.quadCamera);
    renderer.autoClear = autoClear;
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
  }
}
