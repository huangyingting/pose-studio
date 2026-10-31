import { Layers } from 'lucide-react';
import { menu, menuItems } from '../commands';
import { NameHeader, type HeaderChrome } from '../ui';
import type { Target } from './target';

/* Several figures and props selected: how many, which, and what can be done to all of them. */

const ctx = (t: Target) => ({ store: t.store, many: { figures: t.many!.figures.map((f) => f.id), props: t.many!.props.map((p) => p.id) } });
const count = (t: Target) => t.many!.figures.length + t.many!.props.length;

export function ManyHeader({ t, chrome }: { t: Target; chrome: HeaderChrome }) {
  return <NameHeader chrome={chrome} lead={<Layers size={17} strokeWidth={1.75} aria-hidden />} name={`${count(t)} selected`} label="Selection" menu={() => menu('many', ctx(t))} />;
}

export const manySummary = (t: Target) => [...t.many!.figures, ...t.many!.props].map((x) => x.name).join(', ');

/** Who and what is selected, and the commands for all of them (drag one on the canvas to move them all; Shift-drag turns them). */
export function ManyPanel({ t }: { t: Target }) {
  const items = menuItems(['many.duplicate', 'many.hide', 'many.delete'], ctx(t));
  return (
    <>
      <p className="hint">{manySummary(t)}</p>
      <div className="many-actions">
        {items.map((it) => (typeof it === 'object' && 'label' in it ? (
          <button key={it.label} type="button" className={`btn subtle${it.danger ? ' danger' : ''}`} disabled={it.disabled} onClick={it.onSelect}>
            {it.icon && <it.icon size={15} aria-hidden />} {it.label}
          </button>
        ) : null))}
      </div>
      <p className="hint">Drag one of them on the canvas to move them all; Shift-drag turns them about their middle. Shift-click adds or takes one away.</p>
    </>
  );
}
