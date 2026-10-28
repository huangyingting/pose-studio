import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { editRig } from '@/lib/actions';
import { SHOT_SIZES, cameraById } from '@/lib/cameras';
import type { Placement } from '@/lib/types';
import { command } from './commands';
import { setReadout } from './hints';
import { useScene, useStore, useStudio } from './store-context';

const PLACES: Record<Placement, string> = { left: 'on the left third', center: 'in the middle', right: 'on the right third' };

/**
 * Looking through a camera: the shot's frame over the canvas (with the framing guides), a banner
 * saying that moving the view moves the camera (Esc stops), the shot sizes as chips, and a rig
 * camera's subject as a marker to drag onto a third or the middle.
 */
export default function Letterbox({ aspect, guides, camera, project }: {
  aspect: number;
  guides: boolean;
  /** The camera looked through (none: the cut, whichever films then). */
  camera?: string;
  /** Screen (client) point of a figure's chest. */
  project(figure: string): { x: number; y: number } | null;
}) {
  const store = useStore();
  const scene = useScene();
  const time = useStudio((s) => s.time);
  const cam = camera ? cameraById(scene, camera) : undefined;
  const frame = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLButtonElement>(null);
  const [dragging, setDragging] = useState(false);
  const rig = cam?.kind === 'rig' ? cam : undefined;
  const subject = rig?.subject;

  // The marker follows its subject in the picture (unless it is being dragged).
  useEffect(() => {
    if (!subject || dragging) return;
    let raf = 0;
    const tick = () => {
      const el = marker.current;
      const box = frame.current?.getBoundingClientRect();
      const at = project(subject);
      if (el && box && at) el.style.transform = `translate(${at.x - box.left}px, ${at.y - box.top}px) translate(-50%, -50%)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [subject, dragging, project]);

  /** Drag the subject across the picture: let go on a third, or the middle, to frame it there. */
  const compose = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || !rig) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    setDragging(true);
    const box = frame.current!.getBoundingClientRect();
    const placeAt = (x: number): Placement => ((x - box.left) / box.width < 1 / 3 ? 'left' : (x - box.left) / box.width > 2 / 3 ? 'right' : 'center');
    const move = (ev: PointerEvent) => {
      el.style.transform = `translate(${ev.clientX - box.left}px, ${ev.clientY - box.top}px) translate(-50%, -50%)`;
      setReadout(`${scene.figures.find((f) => f.id === subject)?.name ?? 'The subject'} ${PLACES[placeAt(ev.clientX)]}`);
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      setReadout(null);
      setDragging(false);
      editRig(store, rig.id, { place: placeAt(ev.clientX) }, '');
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const sizes = cam ? command('camera.size').items!({ store, camera: cam.id }) : [];
  const who = subject ? scene.figures.find((f) => f.id === subject)?.name : undefined;
  return (
    <div className="letterbox">
      <div ref={frame} style={{ '--aspect': aspect } as CSSProperties}>
        <p className="letterbox-banner" role="status">
          {cam ? `Moving ${cam.name}${scene.animation ? ` at ${time.toFixed(2)} s` : ''}: drag to change it` : 'Looking through the cut'} · Esc to stop
        </p>
        {guides && (
          <>
            <i className="third v1" /><i className="third v2" /><i className="third h1" /><i className="third h2" />
            <i className="safe action" /><i className="safe title" />
          </>
        )}
        {subject && who && (
          <button
            ref={marker}
            type="button"
            className="letterbox-subject"
            aria-label={`${who}: drag onto a third or the middle to frame ${who} there`}
            data-tip={`Drag ${who} onto a third or the middle of the picture`}
            onPointerDown={compose}
          />
        )}
        {cam && (
          <div className="letterbox-sizes" role="group" aria-label="Shot size">
            {SHOT_SIZES.map((x, i) => (
              <button key={x.id} type="button" className={sizes[i]?.checked ? 'on' : undefined} aria-pressed={!!sizes[i]?.checked} data-tip={x.name} onClick={() => sizes[i]?.run()}>
                {x.short}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
