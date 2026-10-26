'use client';

import { Copy, Eye, EyeOff, PersonStanding, Plus, Trash2, UserRound } from 'lucide-react';
import {
  addFigure, addProp, addStandIn, deleteFigure, deleteProp, duplicateFigure, duplicateProp, setFigureHidden,
} from '@/lib/actions';
import { PROP_LABELS } from '@/lib/props';
import { PROP_KINDS } from '@/lib/types';
import { PROP_ICONS } from '../icons';
import { useScene, useStore, useStudio } from '../store-context';
import { IconButton, Menu } from '../ui';
import type { SectionProps } from './sections';

/** The open pose's figures, stand-ins and props: pick, add, duplicate, hide and delete them. */
export default function LayersSection({ notifyUndo }: SectionProps) {
  const store = useStore();
  const scene = useScene();
  const active = useStudio((s) => s.activeFigure);
  const selection = useStudio((s) => s.selection);
  const counts: Record<string, number> = {};
  return (
    <div className="side-section">
      <div className="side-head">
        <h2>Layers <span className="count">{scene.figures.length + scene.props.length}</span></h2>
        <Menu
          label="Add layer"
          className="ibtn"
          align="end"
          tip="Add figure, stand-in or prop"
          items={[
            { label: 'Figure', icon: PersonStanding, onSelect: () => addFigure(store) },
            { label: 'Stand-in (for blocking)', icon: UserRound, onSelect: () => addStandIn(store) },
            '-',
            ...PROP_KINDS.map((k) => ({ label: PROP_LABELS[k], icon: PROP_ICONS[k], onSelect: () => addProp(store, k) })),
          ]}
        >
          <Plus size={16} strokeWidth={1.75} aria-hidden />
        </Menu>
      </div>
      <ul className="layers" aria-label="Layers">
        {scene.figures.map((f) => {
          const on = f.id === active && selection?.kind !== 'prop';
          return (
            <li key={f.id} className={`${on ? 'on' : ''}${f.hidden ? ' hidden-layer' : ''}`}>
              <button type="button" className="layer-main" onClick={() => store.setActiveFigure(f.id)}>
                {f.proxy ? <UserRound size={15} strokeWidth={1.75} aria-hidden /> : <PersonStanding size={15} strokeWidth={1.75} aria-hidden />}
                <span>{f.name}</span>
              </button>
              <span className="layer-actions">
                <IconButton icon={Copy} label={`Duplicate ${f.name}`} onClick={() => duplicateFigure(store, f.id)} size={14} />
                <IconButton
                  icon={Trash2}
                  label={`Delete ${f.name}`}
                  disabled={scene.figures.length <= 1}
                  onClick={() => { if (deleteFigure(store, f.id)) notifyUndo(`Deleted ${f.name}`); }}
                  size={14}
                />
                <IconButton
                  icon={f.hidden ? EyeOff : Eye}
                  label={`${f.hidden ? 'Show' : 'Hide'} ${f.name}`}
                  pressed={!f.hidden}
                  className={f.hidden ? 'keep' : ''}
                  onClick={() => setFigureHidden(store, f.id, !f.hidden)}
                  size={14}
                />
              </span>
            </li>
          );
        })}
        {scene.props.map((p) => {
          counts[p.kind] = (counts[p.kind] ?? 0) + 1;
          const name = `${PROP_LABELS[p.kind]} ${counts[p.kind]}`;
          const Icon = PROP_ICONS[p.kind];
          const on = selection?.kind === 'prop' && selection.prop === p.id;
          return (
            <li key={p.id} className={on ? 'on' : ''}>
              <button type="button" className="layer-main" onClick={() => store.select({ kind: 'prop', prop: p.id })}>
                <Icon size={15} strokeWidth={1.75} aria-hidden />
                <span>{name}</span>
              </button>
              <span className="layer-actions">
                <IconButton icon={Copy} label={`Duplicate ${name}`} onClick={() => duplicateProp(store, p.id)} size={14} />
                <IconButton icon={Trash2} label={`Delete ${name}`} onClick={() => { deleteProp(store, p.id); notifyUndo('Prop deleted'); }} size={14} />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
