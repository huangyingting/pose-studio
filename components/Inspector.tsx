'use client';

import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { Header, INSPECTOR_SECTIONS } from './inspector/sections';
import { targetOf, type InspectorContext } from './inspector/target';
import OutlineSection from './side/OutlineSection';
import { useScene, useStore, useStudio } from './store-context';
import { PanelEdge, Section, type HeaderChrome } from './ui';

export type { InspectorContext } from './inspector/target';

/** How short the outline and the inspector under it can be dragged (px). */
const MIN_HEIGHT = 120;

/**
 * The right-hand panel: the open scene's outline (its cast, set, cameras, lights and shots) over
 * the inspector of what is selected, as a design tool's layers over its properties. The
 * inspector's sections are a list (inspector/sections.ts). Dragging the line between them shares
 * the height; the panel folds away for more canvas (the top bar's button).
 */
export default function Inspector({ ctx, onPhoto }: { ctx: InspectorContext; onPhoto(): void }) {
  const store = useStore();
  // What the target is made of: the selection, the active figure, the scene, the library.
  useStudio((s) => s.selection);
  useStudio((s) => s.activeFigure);
  useStudio((s) => s.library);
  const outlineHeight = useStudio((s) => s.settings.outlineHeight);
  useScene();
  const t = targetOf(store, ctx);
  const chrome: HeaderChrome = {};
  const sections = INSPECTOR_SECTIONS.filter((s) => s.when(t));
  // (Dragged up or down from where it was; a double-click: its own height again.)
  const drag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const outline = (e.currentTarget.previousElementSibling as HTMLElement).getBoundingClientRect().height;
    const panel = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect().height;
    const y0 = e.clientY;
    const move = (ev: PointerEvent) => store.setSettings({ outlineHeight: Math.round(Math.min(panel - MIN_HEIGHT, Math.max(MIN_HEIGHT, outline + ev.clientY - y0))) });
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.classList.remove('resizing'); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    document.body.classList.add('resizing');
  };
  return (
    <aside className="panel" aria-label="Inspector" style={outlineHeight ? ({ '--outline-h': `${outlineHeight}px` } as CSSProperties) : undefined}>
      <PanelEdge
        label="Resize the panel"
        side="left"
        width={() => document.querySelector('.panel')?.getBoundingClientRect().width ?? 288}
        onWidth={(w) => {
          const next = { ...store.getState().settings.widths };
          if (w === null) delete next.inspector;
          else next.inspector = w;
          store.setSettings({ widths: next });
        }}
      />
      <div className="panel-outline">
        <OutlineSection notify={ctx.notify} notifyUndo={ctx.notifyUndo} onPhoto={onPhoto} />
      </div>
      <div
        className="panel-split"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the outline"
        data-tip="Drag: more outline or more inspector (double-click: as it was)"
        onPointerDown={drag}
        onDoubleClick={() => store.setSettings({ outlineHeight: 0 })}
      />
      <div className="panel-scroll">
        <Header t={t} chrome={chrome} />
        {sections.length ? sections.map((s) => (
          <Section
            key={s.id}
            id={s.id}
            title={typeof s.title === 'function' ? s.title(t) : s.title}
            defaultOpen={s.defaultOpen}
            summary={s.summary?.(t)}
            info={s.info?.(t)}
            actions={s.Actions && <s.Actions t={t} />}
          >
            <s.Panel t={t} />
          </Section>
        )) : <p className="panel-empty">Pick something in the scene, or on the canvas, to change it here.</p>}
      </div>
    </aside>
  );
}
