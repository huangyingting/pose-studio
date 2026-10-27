import { SceneRenderer } from './render';
import type { Scene } from './types';

let renderer: SceneRenderer | null = null;

/** One off-screen WebGL renderer shared by thumbnails and exports. */
export function sharedRenderer() {
  return (renderer ??= new SceneRenderer());
}

const cache = new Map<string, string>();
const MAX = 400;

/** PNG data URL for a scene as its first camera films it; cached by content so unchanged scenes are not re-rendered. */
export function thumbnail(scene: Scene): string {
  const key = JSON.stringify([scene.figures, scene.props, scene.cameras, scene.animation?.actions, scene.animation?.shots]);
  let url = cache.get(key);
  if (!url) {
    url = sharedRenderer().thumbnail(scene);
    if (cache.size >= MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, url);
  }
  return url;
}
