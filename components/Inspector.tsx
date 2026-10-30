'use client';

import { Fragment, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { Selection } from '@/lib/types';
import { Header, INSPECTOR_SECTIONS } from './inspector/sections';
import { targetOf, type InspectorContext, type Target } from './inspector/target';
import OutlineSection from './side/OutlineSection';
import { useScene, useStore, useStudio } from './store-context';
import { PanelEdge, Section, type HeaderChrome } from './ui';

export type { InspectorContext } from './inspector/target';

/**
 * The right-hand panel, one level at a time: the scene (its outline: cast, set, cameras, lights,
 * shots), and below it what is selected: a figure (and below it one of its parts, or an action
 * on its track), a prop, a camera, a light, a shot or several things. Picking something (in the
 * outline or on the canvas) goes down to it; the crumbs above it go back up, the selection kept
 * (to Shift-click more in the outline); nothing selected (Esc, a click on the empty canvas) is the
 * scene. An item's sections are a list
 * (inspector/sections.ts). The panel folds away for more canvas (the top bar's button).
 */
export default function Inspector({ ctx, onPhoto }: { ctx: InspectorContext; onPhoto(): void }) {
  const store = useStore();
  // What the target is made of: the selection, the active figure, the scene, the library.
  const selection = useStudio((s) => s.selection);
  useStudio((s) => s.activeFigure);
  // Gone back up to the scene from this selection (a new one goes down to it).
  const [upFrom, setUpFrom] = useState<Selection | undefined>(undefined);
  useStudio((s) => s.library);
  useScene();
  const t = targetOf(store, ctx);
  const up = upFrom === selection ? null : above(t);
  const width = (
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
  );
  if (!up) {
    return (
      <aside className="panel" aria-label="Inspector">
        {width}
        <OutlineSection notify={ctx.notify} notifyUndo={ctx.notifyUndo} onPhoto={onPhoto} />
      </aside>
    );
  }
  const chrome: HeaderChrome = {};
  return (
    <aside className="panel" aria-label="Inspector">
      {width}
      <nav className="crumbs" aria-label="Up to">
        {up.map((c) => (
          <Fragment key={c.label}>
            <button type="button" className="crumb" onClick={() => (c.to ? store.select(c.to) : setUpFrom(selection))}>{c.label}</button>
            <ChevronRight size={12} aria-hidden />
          </Fragment>
        ))}
      </nav>
      <div className="panel-scroll">
        <Header t={t} chrome={chrome} />
        {INSPECTOR_SECTIONS.filter((s) => s.when(t)).map((s) => (
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
        ))}
      </div>
    </aside>
  );
}

/** The levels above what is shown, from the scene down (none: the scene itself is shown). */
function above(t: Target): { label: string; to: Selection }[] | null {
  const scene = { label: 'Scene', to: null };
  // A part of a figure, or an action on its track: under the figure.
  const owner = t.joint ? t.figure : t.action ? t.scene.figures.find((f) => f.id === t.actionFigure) : undefined;
  if (owner) return [scene, { label: owner.name, to: { kind: 'figure', figure: owner.id } }];
  return t.figure || t.prop || t.span || t.camera || t.action || t.light || t.ambient || t.many ? [scene] : null;
}
