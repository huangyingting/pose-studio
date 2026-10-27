'use client';

import { useRef, useState } from 'react';
import { Camera, Copy, Eye, EyeOff, Film, Hand, type LucideIcon, PersonStanding, Play, Plus, ScanFace, Scissors, SunMedium, Trash2, TriangleAlert, UserRound } from 'lucide-react';
import {
  addCamera, addFigure, addProp, addStandIn, cutShot, deleteCamera, deleteFigure, editCamera, deleteProp, duplicateFigure, duplicateProp, editShot, renameFigure, renameProp,
  setFigureHidden, startAnimation,
} from '@/lib/actions';
import { moments } from '@/lib/track';
import { liveCamera } from '@/lib/cameras';
import { overLimit, shotSpans } from '@/lib/shots';
import { HANDHELD, PROP_KINDS, PROP_LABELS } from '@/lib/types';
import { openContextMenu } from '../ContextMenu';
import { PROP_ICONS } from '../icons';
import { cameraMenu, figureMenu, propMenu, shotMenu } from '../menus';
import { startRename, useRenaming } from '../rename';
import { useScene, useStore, useStudio } from '../store-context';
import { IconButton, Menu } from '../ui';
import type { SectionProps } from './sections';
import { KEYS } from '../shortcuts';

/**
 * The open scene in workflow order: its cast (figures and stand-ins), its set (props), its
 * cameras and its shots. Selecting an item shows it in the inspector; the library applies to what is selected.
 * Double-click (or F2) renames; right-click opens the item's menu.
 */
export default function OutlineSection({ notify, notifyUndo, onPhoto }: SectionProps) {
  const store = useStore();
  const scene = useScene();
  const active = useStudio((s) => s.activeFigure);
  const selection = useStudio((s) => s.selection);
  const time = useStudio((s) => s.time);
  const a = scene.animation;
  const spans = a ? shotSpans(a) : [];
  const renaming = useRenaming();
  const ui = { notify, notifyUndo };

  return (
    <div className="side-section outline">
      <div className="side-head">
        <h2>Scene</h2>
        <IconButton icon={SunMedium} label="Light and look of the scene" size={15} active={!selection} onClick={() => store.select(null)} />
      </div>
      <div className="side-scroll">
        <div className="outline-group">
          <div className="outline-head">
            <h3>Cast <span className="count">{scene.figures.length}</span></h3>
            <Menu
              label="Add to cast"
              className="ibtn"
              align="end"
              tip="Add a figure, a stand-in, or figures from a photo"
              items={[
                { label: 'Figure', icon: PersonStanding, onSelect: () => addFigure(store) },
                { label: 'Stand-in (for blocking)', icon: UserRound, onSelect: () => addStandIn(store) },
                '-',
                { label: 'From a photo…', icon: ScanFace, onSelect: onPhoto },
              ]}
            >
              <Plus size={15} strokeWidth={1.75} aria-hidden />
            </Menu>
          </div>
          <ul className="layers" aria-label="Cast">
            {scene.figures.map((f) => {
              const on = f.id === active && (!selection || selection.kind === 'figure' || selection.kind === 'joint');
              const moving = !!a && moments(a, f.id).length > 1;
              return (
                <li key={f.id} className={`${on ? 'on' : ''}${f.hidden ? ' hidden-layer' : ''}`}>
                  <Row
                    id={f.id}
                    icon={f.proxy ? UserRound : PersonStanding}
                    name={f.name}
                    renaming={renaming === f.id}
                    onRename={(name) => renameFigure(store, f.id, name)}
                    onClick={() => store.select({ kind: 'figure', figure: f.id })}
                    onMenu={(e) => { store.select({ kind: 'figure', figure: f.id }); openContextMenu(e, figureMenu(store, f.id, ui), f.name); }}
                  >
                    {moving && <Film size={12} className="layer-tag" aria-label="animated" />}
                  </Row>
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
              tip="Add a prop: on the floor, or in the selected figure's hand"
              items={[
                ...PROP_KINDS.filter((k) => !HANDHELD.includes(k)).map((k) => ({ label: PROP_LABELS[k], icon: PROP_ICONS[k], onSelect: () => addProp(store, k) })),
                { group: 'In the hand' },
                ...HANDHELD.map((k) => ({ label: PROP_LABELS[k], icon: PROP_ICONS[k], onSelect: () => addProp(store, k) })),
              ]}
            >
              <Plus size={15} strokeWidth={1.75} aria-hidden />
            </Menu>
          </div>
          <ul className="layers" aria-label="Set">
            {scene.props.map((p) => {
              const on = selection?.kind === 'prop' && selection.prop === p.id;
              return (
                <li key={p.id} className={on ? 'on' : ''}>
                  <Row
                    id={p.id}
                    icon={PROP_ICONS[p.kind]}
                    name={p.name}
                    renaming={renaming === p.id}
                    onRename={(name) => renameProp(store, p.id, name)}
                    onClick={() => store.select({ kind: 'prop', prop: p.id })}
                    onMenu={(e) => { store.select({ kind: 'prop', prop: p.id }); openContextMenu(e, propMenu(store, p.id, ui), p.name); }}
                  >
                    {p.hold && <Hand size={12} className="layer-tag" aria-label={`In ${scene.figures.find((f) => f.id === p.hold!.figure)?.name}'s ${p.hold.hand === 'L' ? 'left' : 'right'} hand`} />}
                  </Row>
                  <span className="layer-actions">
                    <IconButton icon={Copy} label={`Duplicate ${p.name}`} onClick={() => duplicateProp(store, p.id)} size={14} />
                    <IconButton icon={Trash2} label={`Delete ${p.name}`} onClick={() => { deleteProp(store, p.id); notifyUndo(`Deleted ${p.name}`); }} size={14} />
                  </span>
                </li>
              );
            })}
            {!scene.props.length && <li className="outline-empty">No props yet</li>}
          </ul>
        </div>

        <div className="outline-group">
            <div className="outline-head">
              <h3>Cameras <span className="count">{scene.cameras.length}</span></h3>
              <IconButton
                icon={Plus}
                label={a ? 'New camera from the view, for the shot at the playhead' : 'New camera from the view'}
                onClick={() => store.select({ kind: 'camera', camera: addCamera(store) })}
                size={15}
              />
            </div>
            <ul className="layers" aria-label="Cameras">
              {scene.cameras.map((c) => {
                const on = selection?.kind === 'camera' && selection.camera === c.id;
                const films = spans.filter((sp) => sp.shot.camera === c.id).map((sp) => sp.index + 1);
                return (
                  <li key={c.id} className={on ? 'on' : liveCamera(scene, time).id === c.id ? 'here' : ''}>
                    <Row
                      id={c.id}
                      icon={Camera}
                      name={c.name}
                      renaming={renaming === c.id}
                      onRename={(name) => editCamera(store, c.id, { name })}
                      onClick={() => store.select({ kind: 'camera', camera: c.id })}
                      onMenu={(e) => { store.select({ kind: 'camera', camera: c.id }); openContextMenu(e, cameraMenu(store, c.id, { notifyUndo }), c.name); }}
                    >
                      {films.length > 0 && <em>{films.length > 1 ? 'Shots' : 'Shot'} {films.join(', ')}</em>}
                    </Row>
                    {scene.cameras.length > 1 && (
                      <span className="layer-actions">
                        <IconButton icon={Trash2} label={`Delete ${c.name}`} onClick={() => { deleteCamera(store, c.id); notifyUndo(`Deleted ${c.name}`); }} size={14} />
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
        </div>

        <div className="outline-group">
          <div className="outline-head">
            <h3>Shots <span className="count">{spans.length}</span></h3>
            {a && <IconButton icon={Scissors} label="Cut a new shot at the playhead" shortcut={KEYS.cut} onClick={() => cutShot(store)} size={15} />}
          </div>
          {a ? (
            <ul className="layers" aria-label="Shots">
              {spans.map((sp) => {
                const on = selection?.kind === 'shot' && selection.shot === sp.shot.id;
                const here = time >= sp.start - 1e-6 && (time < sp.end - 1e-6 || sp.index === spans.length - 1);
                return (
                  <li key={sp.shot.id} className={on ? 'on' : here ? 'here' : ''}>
                    <Row
                      id={sp.shot.id}
                      lead={<span className="shot-no">{sp.index + 1}</span>}
                      name={sp.shot.name}
                      title={sp.shot.caption || undefined}
                      renaming={renaming === sp.shot.id}
                      onRename={(name) => editShot(store, sp.shot.id, { name })}
                      onClick={() => { store.setTime(sp.start); store.select({ kind: 'shot', shot: sp.shot.id }); }}
                      onMenu={(e) => { store.select({ kind: 'shot', shot: sp.shot.id }); openContextMenu(e, shotMenu(store, sp.shot.id, ui), sp.shot.name); }}
                    >
                      {overLimit(a, sp) && <TriangleAlert size={12} className="layer-tag warn" aria-label="Longer than the model allows" />}
                      <em>{(sp.end - sp.start).toFixed(1)} s</em>
                    </Row>
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

/** An outline row: click selects, double-click renames in place, right-click opens its menu. */
function Row({ id, icon: Icon, lead, name, title, renaming, onRename, onClick, onMenu, children }: {
  id: string;
  icon?: LucideIcon;
  lead?: React.ReactNode;
  name: string;
  title?: string;
  renaming: boolean;
  onRename(name: string): void;
  onClick(): void;
  onMenu(e: React.MouseEvent): void;
  children?: React.ReactNode;
}) {
  const head = Icon ? <Icon size={15} strokeWidth={1.75} aria-hidden /> : lead;
  if (renaming) {
    return (
      <div className="layer-main">
        {head}
        <NameField name={name} onDone={(next) => { startRename(null); if (next) onRename(next); }} />
      </div>
    );
  }
  return (
    <button
      type="button"
      className="layer-main"
      title={title}
      onClick={onClick}
      onDoubleClick={() => startRename(id)}
      onContextMenu={onMenu}
    >
      {head}
      <span>{name}</span>
      {children}
    </button>
  );
}

/** The in-place name editor: Enter or leaving it keeps the name, Escape cancels. */
function NameField({ name, onDone }: { name: string; onDone(next: string | null): void }) {
  const [text, setText] = useState(name);
  const done = useRef(false);
  const finish = (keep: boolean) => {
    if (done.current) return;
    done.current = true;
    const next = text.trim();
    onDone(keep && next && next !== name ? next.slice(0, 60) : null);
  };
  return (
    <input
      className="layer-rename"
      type="text"
      value={text}
      aria-label={`Rename ${name}`}
      autoFocus
      spellCheck={false}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
      }}
    />
  );
}
