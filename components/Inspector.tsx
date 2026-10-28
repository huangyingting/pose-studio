'use client';

import { ChevronRight, PanelRightClose } from 'lucide-react';
import { shortcutOf } from './commands';
import { Header, INSPECTOR_SECTIONS } from './inspector/sections';
import { targetOf, type InspectorContext } from './inspector/target';
import { useScene, useStore, useStudio } from './store-context';
import { IconButton, PanelEdge, Section, type HeaderChrome } from './ui';

export type { InspectorContext } from './inspector/target';

/**
 * Right-hand properties panel. It shows what is selected, as a design tool's inspector does: a
 * figure, a prop, a shot, a camera, an action, or the scene itself (the "Scene" crumb in the
 * header). Its sections are a list (inspector/sections.ts). It folds away for more canvas.
 */
export default function Inspector({ ctx, onHide }: { ctx: InspectorContext; onHide(): void }) {
  const store = useStore();
  // What the target is made of: the selection, the active figure, the scene, the library.
  useStudio((s) => s.selection);
  useStudio((s) => s.activeFigure);
  useStudio((s) => s.library);
  useScene();
  const t = targetOf(store, ctx);
  const hide = <IconButton icon={PanelRightClose} label="Hide the inspector" shortcut={shortcutOf('app.inspector')} className="panel-hide hide-mobile" size={15} onClick={onHide} />;
  const scene = !t.figure && !t.prop && !t.span && !t.camera && !t.action;
  const chrome: HeaderChrome = scene ? { after: hide } : {
    before: (
      <button type="button" className="crumb" data-tip="The scene: its light and look" onClick={() => store.select(null)}>
        Scene <ChevronRight size={12} aria-hidden />
      </button>
    ),
    after: hide,
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
