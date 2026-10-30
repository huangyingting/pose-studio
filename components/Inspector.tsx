'use client';

import { Fragment } from 'react';
import { ChevronRight } from 'lucide-react';
import type { Selection } from '@/lib/types';
import { SceneHeader, SceneOverview } from './inspector/scene';
import { Header, INSPECTOR_SECTIONS } from './inspector/sections';
import { targetOf, type InspectorContext, type Target } from './inspector/target';
import { useScene, useStore, useStudio } from './store-context';
import { PanelEdge, Section, type HeaderChrome } from './ui';

export type { InspectorContext } from './inspector/target';

/**
 * The right-hand panel: what is selected, as a design tool's inspector shows it (what is in the
 * scene, and what can go in it, are on the left). One line says where it is, the levels above it
 * clickable: Scene › Figure › Left thigh. Its sections are a list (inspector/sections.ts). With
 * nothing selected, the scene at a glance, each line leading to where it is changed. It folds
 * away for more canvas.
 */
export default function Inspector({ ctx }: { ctx: InspectorContext }) {
  const store = useStore();
  // What the target is made of: the selection, the active figure, the scene, the library.
  useStudio((s) => s.selection);
  useStudio((s) => s.activeFigure);
  useStudio((s) => s.library);
  useScene();
  const t = targetOf(store, ctx);
  const up = above(t);
  const chrome: HeaderChrome = {
    before: up && (
      <nav className="crumbs" aria-label="Up to">
        {up.map((c) => (
          <Fragment key={c.label}>
            <button type="button" className="crumb" onClick={() => store.select(c.to)}>{c.label}</button>
            <ChevronRight size={12} aria-hidden />
          </Fragment>
        ))}
      </nav>
    ),
  };
  return (
    <aside className="panel" aria-label="Inspector">
      <PanelEdge
        label="Resize the inspector"
        side="left"
        width={() => document.querySelector('.panel')?.getBoundingClientRect().width ?? 288}
        onWidth={(w) => {
          const next = { ...store.getState().settings.widths };
          if (w === null) delete next.inspector;
          else next.inspector = w;
          store.setSettings({ widths: next });
        }}
      />
      <div className="panel-scroll">
        {up ? (
          <>
            <Header t={t} chrome={chrome} />
            {INSPECTOR_SECTIONS.filter((s) => s.when(t)).map((s) => (
              <Section
                key={s.id}
                id={s.id}
                title={typeof s.title === 'function' ? s.title(t) : s.title}
                defaultOpen={typeof s.defaultOpen === 'function' ? s.defaultOpen(t) : s.defaultOpen}
                summary={s.summary?.(t)}
                info={s.info?.(t)}
                actions={s.Actions && <s.Actions t={t} />}
              >
                <s.Panel t={t} />
              </Section>
            ))}
          </>
        ) : (
          <>
            <SceneHeader t={t} chrome={{}} />
            <SceneOverview t={t} />
          </>
        )}
      </div>
    </aside>
  );
}

/** The levels above what is shown, from the scene down (none: nothing is selected). */
function above(t: Target): { label: string; to: Selection }[] | null {
  const scene = { label: 'Scene', to: null };
  // A part of a figure, or an action on its track: under the figure.
  const owner = t.joint ? t.figure : t.action ? t.scene.figures.find((f) => f.id === t.actionFigure) : undefined;
  if (owner) return [scene, { label: owner.name, to: { kind: 'figure', figure: owner.id } }];
  // A light: under the scene's lighting.
  if (t.light) return [scene, { label: 'Lighting', to: { kind: 'lighting' } }];
  return t.figure || t.prop || t.span || t.camera || t.action || t.lighting || t.many ? [scene] : null;
}
