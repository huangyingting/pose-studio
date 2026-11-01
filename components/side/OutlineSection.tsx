'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { Camera, Castle, Ellipsis, Eye, EyeOff, Film, Hand, type LucideIcon, PersonStanding, Plus, ScanFace, Scissors, SunMedium, UserRound, X } from 'lucide-react';
import {
  addCamera, addFigure, addProp, setSceneSet, addStandIn, editCamera, editShot, renameFigure, renameProp, setFigureHidden, toggleSelected,
} from '@/lib/actions';
import { moments } from '@/lib/track';
import { liveCamera } from '@/lib/cameras';
import { MAX_LIGHTS, ROLE_NAMES, lightText, lightingName, lightingOf } from '@/lib/lighting';
import { shotSpans } from '@/lib/shots';
import { setById } from '@/lib/sets';
import { HANDHELD, PROP_KINDS, PROP_LABELS, type Vec3 } from '@/lib/types';
import { openContextMenu } from '../ContextMenu';
import { PROP_ICONS } from '../icons';
import { App, command, menu, placeOrAdd, shortcutOf, type Ctx } from '../commands';
import { placingFigure, placingProp } from '../placing';
import { startRename, useRenaming } from '../rename';
import { useProjectSettings, useScene, useStore, useStudio } from '../store-context';
import { Hint, IconButton, Menu } from '../ui';
import { KIND_ICONS } from '../inspector/light';
import type { SectionProps } from './sections';
import { menuKey, rovingKey, useRoving, type Roving } from '../roving';

/** The outline's rows for the keyboard: ↑ ↓ between them all, selecting as a click does; their ⋯ and eye left to the menu (Shift + F10). */
const OUTLINE_KEYS: Roving = {
  items: '.layers > li > button.layer-main',
  orientation: 'vertical',
  chosen: '.layers > li.on > button.layer-main',
  activate: (el) => el.click(),
  quiet: '.layers .layer-actions button',
};

/**
 * The open scene in workflow order: its cast (figures and stand-ins), its set (props), its
 * cameras and its shots. Selecting an item shows it in the inspector; the library applies to what is selected.
 * Double-click (or F2) renames; right-click opens the item's menu.
 */
export default function OutlineSection({ onPhoto }: Pick<SectionProps, 'onPhoto' | 'notify' | 'notifyUndo'>) {
  const store = useStore();
  const scene = useScene();
  // Shots are flagged as longer than the project's video model allows: follow it.
  useProjectSettings();
  const active = useStudio((s) => s.activeFigure);
  const selection = useStudio((s) => s.selection);
  const time = useStudio((s) => s.time);
  const a = scene.animation;
  const spans = a ? shotSpans(a) : [];
  const lighting = lightingOf(scene);
  const renaming = useRenaming();
  // Resting on a row outlines its figure, prop or camera on the canvas (and the canvas marks the row).
  const linked = useStudio((s) => s.linked);
  const link = (id: string) => ({ onPointerEnter: () => store.setLinked(id), onPointerLeave: () => store.setLinked(null) });
  // What the pointer rested on is gone (deleted from its row's menu): nothing is linked.
  useEffect(() => {
    if (linked && !scene.figures.some((f) => f.id === linked) && !scene.props.some((p) => p.id === linked) && !scene.cameras.some((c) => c.id === linked)) store.setLinked(null);
  }, [linked, scene, store]);

  // Several selected: a right-click on one of them is the menu of them all.
  const manyHas = (id: string) => selection?.kind === 'many' && (selection.figures.includes(id) || selection.props.includes(id));
  const manyMenu = (e: React.MouseEvent) => {
    if (selection?.kind !== 'many') return;
    openContextMenu(e, menu('many', { store, many: { figures: selection.figures, props: selection.props } }), `${selection.figures.length + selection.props.length} selected`);
  };

  // (One Tab stop for all its rows, the arrows between them, moving selects: #20.)
  const rows = useRef<HTMLDivElement>(null);
  useRoving(rows, OUTLINE_KEYS);
  return (
    <div className="side-section outline">
      <div className="side-head">
        <h2>Scene</h2>
      </div>
      <div className="side-scroll" ref={rows} onKeyDown={(e) => { if (!rovingKey(e, OUTLINE_KEYS)) menuKey(e); }}>
        <div className="outline-group">
          <div className="outline-head">
            <h3>Cast <span className="count">{scene.figures.length}</span></h3>
            <Menu
              label="Add to cast"
              className="ibtn"
              align="end"
              tip="Add a figure, a stand-in, or figures from a photo"
              items={[
                // Placed with the pointer (from the keyboard: beside the others, framed).
                { label: 'Figure', icon: PersonStanding, onSelect: () => placeOrAdd(placingFigure(store), () => addFigure(store)) },
                { label: 'Stand-in (for blocking)', icon: UserRound, onSelect: () => placeOrAdd(placingFigure(store, true), () => addStandIn(store)) },
                '-',
                { label: 'From a photo…', icon: ScanFace, onSelect: onPhoto },
              ]}
            >
              <Plus size={16} strokeWidth={1.75} aria-hidden />
            </Menu>
          </div>
          <ul className="layers" aria-label="Cast">
            {scene.figures.map((f) => {
              const on = (f.id === active && (!selection || selection.kind === 'figure' || selection.kind === 'joint')) || (selection?.kind === 'many' && selection.figures.includes(f.id));
              const moving = !!a && moments(a, f.id).length > 1;
              return (
                <li key={f.id} className={`${on ? 'on' : ''}${f.hidden ? ' hidden-layer' : ''}${linked === f.id ? ' linked' : ''}`} {...link(f.id)}>
                  <Row
                    id={f.id}
                    icon={f.proxy ? UserRound : PersonStanding}
                    name={f.name}
                    renaming={renaming === f.id}
                    onRename={(name) => renameFigure(store, f.id, name)}
                    onClick={(e) => (e.shiftKey ? toggleSelected(store, { figure: f.id }) : store.select({ kind: 'figure', figure: f.id }))}
                    onMenu={(e) => { if (manyHas(f.id)) return manyMenu(e); store.select({ kind: 'figure', figure: f.id }); openContextMenu(e, menu('figure', { store, figure: f.id }), f.name); }}
                  >
                    {moving && <Film size={13} className="layer-tag" aria-label="animated" />}
                  </Row>
                  <span className="layer-actions">
                    <More name={f.name} kind="figure" c={{ store, figure: f.id }} />
                    <IconButton
                      icon={f.hidden ? EyeOff : Eye}
                      label={`${f.hidden ? 'Show' : 'Hide'} ${f.name}`}
                      pressed={!f.hidden}
                      className={f.hidden ? 'keep' : ''}
                      onClick={() => setFigureHidden(store, f.id, !f.hidden)}
                      size={15}
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
              tip="Add a prop, or pick a set to play the scene in"
              items={[
                { label: scene.set ? 'Change the set…' : 'Pick a set…', icon: Castle, onSelect: () => store.setSettings({ side: 'sets' }) },
                { group: 'On the floor' },
                // (Or dragged: onto the floor, at the drop point; a handheld one onto a figure, into its hand.)
                ...PROP_KINDS.filter((k) => !HANDHELD.includes(k)).map((k) => ({ label: PROP_LABELS[k], icon: PROP_ICONS[k], onSelect: () => placeOrAdd(placingProp(store, k), () => addProp(store, k)), drag: { floor: (at: Vec3) => addProp(store, k, at) } })),
                { group: 'In the hand' },
                ...HANDHELD.map((k) => ({
                  label: PROP_LABELS[k], icon: PROP_ICONS[k], onSelect: () => placeOrAdd(placingProp(store, k), () => addProp(store, k)),
                  drag: { figure: (id: string) => { store.select({ kind: 'figure', figure: id }); addProp(store, k); } },
                })),
              ]}
            >
              <Plus size={16} strokeWidth={1.75} aria-hidden />
            </Menu>
          </div>
          <ul className="layers" aria-label="Set">
            {setById(scene.set) && (
              <li>
                <button type="button" className="layer-main" data-tip="The set the scene is played in: change it in the Library's Sets" data-tip-side="right" onClick={() => store.setSettings({ side: 'sets' })}>
                  <Castle size={16} strokeWidth={1.75} aria-hidden />
                  <span className="layer-name">{setById(scene.set)!.name}</span>
                </button>
                <span className="layer-actions">
                  <IconButton icon={X} label={`Take the set ${setById(scene.set)!.name} away`} className="row-action" size={14} onClick={() => setSceneSet(store, null)} />
                </span>
              </li>
            )}
            {scene.props.map((p) => {
              const on = (selection?.kind === 'prop' && selection.prop === p.id) || (selection?.kind === 'many' && selection.props.includes(p.id));
              return (
                <li key={p.id} className={`${on ? 'on' : ''}${linked === p.id ? ' linked' : ''}`} {...link(p.id)}>
                  <Row
                    id={p.id}
                    icon={PROP_ICONS[p.kind]}
                    name={p.name}
                    renaming={renaming === p.id}
                    onRename={(name) => renameProp(store, p.id, name)}
                    onClick={(e) => (e.shiftKey ? toggleSelected(store, { prop: p.id }) : store.select({ kind: 'prop', prop: p.id }))}
                    onMenu={(e) => { if (manyHas(p.id)) return manyMenu(e); store.select({ kind: 'prop', prop: p.id }); openContextMenu(e, menu('prop', { store, prop: p.id }), p.name); }}
                  >
                    {p.hold && <Hand size={13} className="layer-tag" aria-label={`In ${scene.figures.find((f) => f.id === p.hold!.figure)?.name}'s ${p.hold.hand === 'L' ? 'left' : 'right'} hand`} />}
                  </Row>
                  <span className="layer-actions">
                    <More name={p.name} kind="prop" c={{ store, prop: p.id }} />
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
                size={16}
              />
            </div>
            <ul className="layers" aria-label="Cameras">
              {scene.cameras.map((c) => {
                const on = selection?.kind === 'camera' && selection.camera === c.id;
                const films = spans.filter((sp) => sp.shot.camera === c.id).map((sp) => sp.index + 1);
                return (
                  <li key={c.id} className={`${on ? 'on' : liveCamera(scene, time).id === c.id ? 'here' : ''}${linked === c.id ? ' linked' : ''}`} {...link(c.id)}>
                    <Row
                      id={c.id}
                      icon={Camera}
                      name={c.name}
                      renaming={renaming === c.id}
                      onRename={(name) => editCamera(store, c.id, { name })}
                      onClick={() => store.select({ kind: 'camera', camera: c.id })}
                      onMenu={(e) => { store.select({ kind: 'camera', camera: c.id }); openContextMenu(e, menu('camera', { store, camera: c.id }), c.name); }}
                    >
                      {films.length > 0 && <em>{films.length > 1 ? 'Shots' : 'Shot'} {films.join(', ')}</em>}
                    </Row>
                    <span className="layer-actions">
                      <More name={c.name} kind="camera" c={{ store, camera: c.id }} />
                    </span>
                  </li>
                );
              })}
            </ul>
        </div>

        <div className="outline-group">
          <div className="outline-head">
            <h3>Lights <span className="count">{lighting.lights.length}</span></h3>
            {lighting.lights.length < MAX_LIGHTS ? (
              <Menu label="Add a light" className="ibtn" align="end" tip="Add a sun, a lamp or a window" items={() => command('light.add').items!({ store }).map((x) => ({ label: x.title, onSelect: x.run }))}>
                <Plus size={16} strokeWidth={1.75} aria-hidden />
              </Menu>
            ) : <IconButton icon={Plus} label={`Add a light (${MAX_LIGHTS} at most)`} disabled onClick={() => {}} size={16} />}
          </div>
          <ul className="layers" aria-label="Lights">
            {/* (The lighting as a whole: its look, where it is, its sky.) */}
            <li className={selection?.kind === 'lighting' ? 'on' : undefined}>
              <button
                type="button"
                className="layer-main"
                data-tip="The look: where the key comes from, the contrast, the warmth; indoors or out, the time of day; the sky"
                data-tip-side="right"
                onClick={() => store.select({ kind: 'lighting' })}
              >
                <SunMedium size={16} strokeWidth={1.75} aria-hidden />
                <span className="layer-name">Lighting</span>
                <em aria-hidden>{lightingName(lighting)}</em>
                <i className="light-dot" style={{ background: `linear-gradient(${lighting.ambient.sky} 50%, ${lighting.ambient.ground} 50%)` }} aria-hidden />
              </button>
            </li>
            {[...lighting.lights.filter((l) => !l.ofSet), ...lighting.lights.filter((l) => l.ofSet)].map((l, i, all) => {
              const name = l.name;
              const Icon = KIND_ICONS[l.kind];
              const c = { store, light: l.id };
              return (
                <Fragment key={l.id}>
                {l.ofSet && !all[i - 1]?.ofSet && <li className="layers-sub" aria-hidden>The set&apos;s own</li>}
                <li className={selection?.kind === 'light' && selection.light === l.id ? 'on' : undefined}>
                  <button
                    type="button"
                    className="layer-main"
                    data-tip={`${lightText(l)}, ${Math.round(l.intensity * 100)}%\nRight-click for more`}
                    data-tip-side="right"
                    // (Its lamp brought into view if it is out of it.)
                    onClick={() => { store.select({ kind: 'light', light: l.id }); App().frameSelection?.(); }}
                    onContextMenu={(e) => { store.select({ kind: 'light', light: l.id }); openContextMenu(e, menu('light', c), name); }}
                  >
                    <Icon size={16} strokeWidth={1.75} aria-hidden />
                    <span className="layer-name">{name}</span>
                    {/* (Its role, as a badge: the row is named by the light's name.) */}
                    {l.role && !l.ofSet && <em aria-hidden>{ROLE_NAMES[l.role]}</em>}
                    <i className="light-dot" style={{ background: l.color }} aria-hidden />
                  </button>
                  <span className="layer-actions">
                    <More name={name} kind="light" c={c} />
                  </span>
                </li>
                </Fragment>
              );
            })}
          </ul>
        </div>

        <div className="outline-group">
          <div className="outline-head">
            <h3>Shots <span className="count">{spans.length}</span></h3>
            {a && <IconButton icon={Scissors} label="Cut a new shot at the playhead" shortcut={shortcutOf('timeline.cut')} onClick={() => command('timeline.cut').run!({ store })} size={16} />}
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
                      onMenu={(e) => { store.select({ kind: 'shot', shot: sp.shot.id }); openContextMenu(e, menu('shot', { store, shot: sp.shot.id }), sp.shot.name); }}
                    >
                      <em>{(sp.end - sp.start).toFixed(1)} s</em>
                    </Row>
                    <span className="layer-actions">
                      <More name={sp.shot.name} kind="shot" c={{ store, shot: sp.shot.id }} />
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="outline-still">
              <Hint>None in a still image</Hint>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** A row's menu (the same as right-clicking it), on a ⋯ shown while the pointer is over the row. */
function More({ name, kind, c }: { name: string; kind: 'figure' | 'prop' | 'camera' | 'shot' | 'light'; c: Ctx }) {
  return (
    <Menu label={`More for ${name}`} className="ibtn" align="end" tip="More (or right-click the row)" items={() => menu(kind, c)}>
      <Ellipsis size={15} aria-hidden />
    </Menu>
  );
}

/** An outline row: click selects, double-click renames in place, right-click opens its menu. */
function Row({ icon: Icon, lead, name, title, renaming, onRename, onClick, onMenu, children }: {
  id: string;
  icon?: LucideIcon;
  lead?: React.ReactNode;
  name: string;
  title?: string;
  renaming: boolean;
  onRename(name: string): void;
  onClick(e: React.MouseEvent): void;
  onMenu(e: React.MouseEvent): void;
  children?: React.ReactNode;
}) {
  const store = useStore();
  const head = Icon ? <Icon size={16} strokeWidth={1.75} aria-hidden /> : lead;
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
      data-tip={`${title ? `${name} — ${title}` : name}\nRight-click for more`}
      data-tip-side="right"
      onClick={onClick}
      // Double-click: frame it on the canvas (F2 or its menu renames it).
      onDoubleClick={(e) => { onClick(e); command('view.frame').run!({ store }); }}
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
