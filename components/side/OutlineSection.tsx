'use client';

import { Copy, Eye, EyeOff, Film, PersonStanding, Play, Plus, Scissors, Trash2, TriangleAlert, UserRound } from 'lucide-react';
import {
  addFigure, addProp, addStandIn, cutShot, deleteFigure, deleteProp, duplicateFigure, duplicateProp, setFigureHidden, startAnimation,
} from '@/lib/actions';
import { figureKeyTimes } from '@/lib/animation';
import { PROP_LABELS } from '@/lib/props';
import { overLimit, shotSpans } from '@/lib/shots';
import { PROP_KINDS } from '@/lib/types';
import { PROP_ICONS } from '../icons';
import { useScene, useStore, useStudio } from '../store-context';
import { IconButton, Menu } from '../ui';
import type { SectionProps } from './sections';

/**
 * The open scene in workflow order: its cast (figures and stand-ins), its set (props) and its
 * shots. Selecting an item shows it in the inspector; the library applies to what is selected.
 */
export default function OutlineSection({ notify, notifyUndo }: SectionProps) {
  const store = useStore();
  const scene = useScene();
  const active = useStudio((s) => s.activeFigure);
  const selection = useStudio((s) => s.selection);
  const time = useStudio((s) => s.time);
  const a = scene.animation;
  const spans = a ? shotSpans(a) : [];
  const counts: Record<string, number> = {};

  return (
    <div className="side-section outline">
      <div className="side-head">
        <h2>Scene</h2>
      </div>
      <div className="side-scroll">
        <div className="outline-group">
          <div className="outline-head">
            <h3>Cast <span className="count">{scene.figures.length}</span></h3>
            <Menu
              label="Add to cast"
              className="ibtn"
              align="end"
              tip="Add a figure or a stand-in"
              items={[
                { label: 'Figure', icon: PersonStanding, onSelect: () => addFigure(store) },
                { label: 'Stand-in (for blocking)', icon: UserRound, onSelect: () => addStandIn(store) },
              ]}
            >
              <Plus size={15} strokeWidth={1.75} aria-hidden />
            </Menu>
          </div>
          <ul className="layers" aria-label="Cast">
            {scene.figures.map((f) => {
              const on = f.id === active && selection?.kind !== 'prop' && selection?.kind !== 'shot';
              const moving = !!a && figureKeyTimes(a, f.id).length > 1;
              return (
                <li key={f.id} className={`${on ? 'on' : ''}${f.hidden ? ' hidden-layer' : ''}`}>
                  <button type="button" className="layer-main" onClick={() => { store.select(null); store.setActiveFigure(f.id); }}>
                    {f.proxy ? <UserRound size={15} strokeWidth={1.75} aria-hidden /> : <PersonStanding size={15} strokeWidth={1.75} aria-hidden />}
                    <span>{f.name}</span>
                    {moving && <Film size={12} className="layer-tag" aria-label="animated" />}
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
          </ul>
        </div>

        <div className="outline-group">
          <div className="outline-head">
            <h3>Set <span className="count">{scene.props.length}</span></h3>
            <Menu
              label="Add to set"
              className="ibtn"
              align="end"
              tip="Add a prop"
              items={PROP_KINDS.map((k) => ({ label: PROP_LABELS[k], icon: PROP_ICONS[k], onSelect: () => addProp(store, k) }))}
            >
              <Plus size={15} strokeWidth={1.75} aria-hidden />
            </Menu>
          </div>
          <ul className="layers" aria-label="Set">
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
            {!scene.props.length && <li className="outline-empty">No props yet</li>}
          </ul>
        </div>

        <div className="outline-group">
          <div className="outline-head">
            <h3>Shots <span className="count">{spans.length}</span></h3>
            {a && <IconButton icon={Scissors} label="Cut a new shot at the playhead" shortcut="C" onClick={() => cutShot(store)} size={15} />}
          </div>
          {a ? (
            <ul className="layers" aria-label="Shots">
              {spans.map((sp) => {
                const on = selection?.kind === 'shot' && selection.shot === sp.shot.id;
                const here = time >= sp.start - 1e-6 && (time < sp.end - 1e-6 || sp.index === spans.length - 1);
                return (
                  <li key={sp.shot.id} className={on ? 'on' : here ? 'here' : ''}>
                    <button
                      type="button"
                      className="layer-main"
                      onClick={() => { store.setTime(sp.start); store.select({ kind: 'shot', shot: sp.shot.id }); }}
                      title={sp.shot.caption || undefined}
                    >
                      <span className="shot-no">{sp.index + 1}</span>
                      <span>{sp.shot.name}</span>
                      {overLimit(a, sp) && <TriangleAlert size={12} className="layer-tag warn" aria-label="Longer than the model allows" />}
                      <em>{(sp.end - sp.start).toFixed(1)} s</em>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="outline-still">
              <p className="hint-text">A still image. Animate it to act it out and film it in shots.</p>
              <button type="button" className="btn subtle" onClick={() => { startAnimation(store); notify('Animation started: pose the figures at other times on the timeline'); }}>
                <Play size={14} aria-hidden /> Animate
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
