import { useEffect, useRef } from 'react';
import { cameraById, frameAspect, viewOf } from '@/lib/cameras';
import { sceneAt } from '@/lib/evaluate';
import { sharedRenderer } from '@/lib/thumbnails';
import type { Clock } from './clock';
import { command } from './commands';
import { usePlayhead } from './Timeline';
import { useFilm, useScene, useStore } from './store-context';

const WIDTH = 240;

/**
 * The selected camera's picture, live, in the canvas's bottom-right corner (above the timeline):
 * in the frame's aspect, with its name and lens. A click looks through it.
 */
export default function CameraPip({ camera, clock }: { camera: string; clock: Clock }) {
  const store = useStore();
  const scene = useScene();
  const style = useFilm().style;
  const time = usePlayhead(clock);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cam = cameraById(scene, camera);
  const aspect = frameAspect();
  const height = Math.round(WIDTH / aspect);
  const t = scene.animation ? time : 0;
  const view = cam ? viewOf(scene, cam, t, aspect) : null;

  // Drawn off-screen as the shot would be: when what it shows changes, at most a few times a second while playing.
  const want = useRef<{ draw(): void } | null>(null);
  useEffect(() => {
    want.current = cam ? {
      draw: () => {
        const ctx = canvas.current?.getContext('2d');
        if (!ctx) return;
        const doc = scene.animation ? sceneAt(scene, t) : scene;
        ctx.drawImage(sharedRenderer().renderShot(doc, WIDTH, height, 1.1, { camera: viewOf(scene, cam, t, aspect), style }), 0, 0, WIDTH, height);
      },
    } : null;
  }, [scene, t, cam, style, height, aspect]);
  useEffect(() => {
    let raf = 0;
    let last = -Infinity;
    const tick = (now: number) => {
      if (want.current && (!clock.playing || now - last > 150)) {
        want.current.draw();
        want.current = null;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [clock]);

  if (!cam || !view) return null;
  return (
    <button
      type="button"
      className="camera-pip"
      aria-label={`Look through ${cam.name}`}
      data-tip={`${cam.name}'s picture: click to look through it`}
      data-tip-side="left"
      onClick={() => command('camera.through').run!({ store, camera })}
    >
      <canvas ref={canvas} width={WIDTH} height={height} />
      <span className="camera-pip-name">{cam.name} · {Math.round(view.lens)} mm</span>
    </button>
  );
}
