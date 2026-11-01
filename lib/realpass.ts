import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/*
 * The 3D style's look as a camera takes it (#29): drawn into a high-range picture, then shaded
 * where things meet (ambient occlusion: the dark in corners, under a sofa, where a foot meets the
 * floor), the brightest (a flame, a lamp, a window's glare) blooming a little, and mapped to the
 * picture as film takes light (the renderer's tone mapping). Used by the editor's canvas (what it
 * draws over the scene, its handles, stays sharp and unshaded) and by the exporter.
 */
export class RealPass {
  private composer: EffectComposer | null = null;
  private scenePass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
  private ao: GTAOPass | null = null;
  private bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.16, 0.4, 1.4);
  private output = new OutputPass();
  private size = new THREE.Vector2();

  /** The scene through the camera, as a camera takes it, into what is drawn to now (the screen). */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    renderer.getDrawingBufferSize(this.size);
    const [w, h] = [Math.max(1, this.size.x), Math.max(1, this.size.y)];
    if (!this.composer || this.composer.renderer !== renderer) {
      this.composer?.dispose();
      const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(renderer, target);
      this.ao = new GTAOPass(scene, camera, w, h);
      this.ao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.4, thickness: 1.2, scale: 1, samples: 12 });
      this.ao.blendIntensity = 0.85;
      this.composer.addPass(this.scenePass);
      this.composer.addPass(this.ao);
      this.composer.addPass(this.bloom);
      this.composer.addPass(this.output);
    }
    const composer = this.composer;
    const pr = renderer.getPixelRatio();
    if (composer.readBuffer.width !== w || composer.readBuffer.height !== h) {
      composer.setPixelRatio(pr);
      composer.setSize(w / pr, h / pr);
      // (The shading where things meet, at half the picture's size: soft as it is, and quicker.)
      this.ao!.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
    }
    this.scenePass.scene = scene;
    this.scenePass.camera = camera;
    this.ao!.scene = scene;
    this.ao!.camera = camera;
    composer.render();
  }

  dispose() {
    this.composer?.dispose();
    this.ao?.dispose();
    this.bloom.dispose();
    this.output.dispose();
  }
}
