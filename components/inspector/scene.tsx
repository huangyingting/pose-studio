'use client';

import type { ReactNode } from 'react';
import { Camera, Castle, ChevronRight, Clapperboard, Clock, LayoutPanelTop, RectangleHorizontal, SunMedium, UsersRound, type LucideIcon } from 'lucide-react';
import { renameScene } from '@/lib/actions';
import { DEFAULT_HOLD } from '@/lib/board';
import { lightingName, lightingOf } from '@/lib/lighting';
import { projectSettingsOf } from '@/lib/project';
import { setById } from '@/lib/sets';
import { shotSpans } from '@/lib/shots';
import { styleDef } from '@/lib/styles';
import type { SideSection } from '@/lib/store';
import type { Selection } from '@/lib/types';
import { choices, command, menu } from '../commands';
import { STYLE_ICONS } from '../icons';
import { Menu, NameHeader, type HeaderChrome, type MenuItem } from '../ui';
import type { Target } from './target';

/*
 * The scene, with nothing selected: what is in it and how it looks, to read at a glance. Each line
 * leads to where it is changed (its library category, its menu, the storyboard), and each person,
 * camera and light in it is a chip that selects it.
 */

export function SceneHeader({ t, chrome }: { t: Target; chrome: HeaderChrome }) {
  const index = t.store.getState().sceneIndex;
  return <NameHeader chrome={chrome} lead={<Clapperboard size={16} strokeWidth={1.75} aria-hidden />} name={t.scene.name} label="Scene name" onRename={(name) => renameScene(t.store, name)} menu={() => menu('scene', { store: t.store, scene: index })} />;
}

export function SceneOverview({ t }: { t: Target }) {
  const { store, scene } = t;
  const look = projectSettingsOf(store.getState().library);
  const lighting = lightingOf(scene);
  const a = scene.animation;
  const shots = a ? shotSpans(a).length : 0;
  const people = scene.figures.filter((f) => !f.hidden);
  const show = (side: SideSection) => () => store.setSettings({ side });
  const pick = (to: NonNullable<Selection>) => () => store.select(to);
  const ctx = { store };
  return (
    <div className="scene-overview">
      <section aria-label="Look">
        <h3>Look <span>every scene</span></h3>
        <Line icon={STYLE_ICONS[look.style]} label="Style" value={styleDef(look.style).label} items={() => choices('view.style', ctx)} />
        <Line icon={RectangleHorizontal} label="Frame" value={look.frame} items={() => choices('view.aspect', ctx)} />
      </section>
      <section aria-label="In this scene">
        <h3>In this scene</h3>
        <Line icon={UsersRound} label="Cast" value={people.length ? `${people.length}` : 'Nobody yet'} go={show('scene')} tip="The cast in the scene's outline">
          {people.map((f) => <Chip key={f.id} label={f.name} onClick={pick({ kind: 'figure', figure: f.id })} />)}
        </Line>
        <Line icon={Castle} label="Set" value={setById(scene.set)?.name ?? 'None'} go={show('sets')} tip="Pick a set" />
        <Line icon={SunMedium} label="Lighting" value={`${lightingName(lighting)} · ${lighting.lights.length} ${lighting.lights.length === 1 ? 'light' : 'lights'}`} go={show('lighting')} tip="Pick a lighting scheme">
          <Chip label="Look" onClick={pick({ kind: 'lighting' })} />
          {lighting.lights.map((l) => <Chip key={l.id} label={l.name} onClick={pick({ kind: 'light', light: l.id })} />)}
        </Line>
        <Line icon={Camera} label="Cameras" value={`${scene.cameras.length}`} go={pick({ kind: 'camera', camera: scene.cameras[0].id })} tip="Its first camera: its framing and move">
          {scene.cameras.map((c) => <Chip key={c.id} label={c.name} onClick={pick({ kind: 'camera', camera: c.id })} />)}
        </Line>
        <Line icon={Clock} label="Length" value={a ? `${a.duration.toFixed(1)} s · ${shots} ${shots === 1 ? 'shot' : 'shots'}` : 'A still image'} />
        <Line
          icon={LayoutPanelTop}
          label="Storyboard"
          value={scene.offStory ? 'Left out' : a ? 'Shot by shot' : `Held ${(scene.hold ?? DEFAULT_HOLD).toFixed(1)} s`}
          go={() => command('app.board').run!(ctx)}
          tip="Open the storyboard"
        />
      </section>
    </div>
  );
}

/** One thing about the scene: what it is, its value, and where it is changed (a place, or a menu of its choices). */
function Line({ icon: Icon, label, value, go, items, tip, children }: {
  icon: LucideIcon;
  label: string;
  value: string;
  go?(): void;
  items?(): MenuItem[];
  tip?: string;
  children?: ReactNode;
}) {
  const inner = (
    <>
      <Icon size={15} strokeWidth={1.75} aria-hidden />
      <span className="scene-line-label">{label}</span>
      <span className="scene-line-value">{value}</span>
      {(go || items) && <ChevronRight size={14} className="scene-line-go" aria-hidden />}
    </>
  );
  return (
    <div className="scene-line">
      {items ? (
        <Menu label={label} className="scene-line-main" align="end" items={items}>{inner}</Menu>
      ) : go ? (
        <button type="button" className="scene-line-main" data-tip={tip} onClick={go}>{inner}</button>
      ) : (
        <div className="scene-line-main">{inner}</div>
      )}
      {children && <div className="scene-chips">{children}</div>}
    </div>
  );
}

function Chip({ label, onClick }: { label: string; onClick(): void }) {
  return <button type="button" className="scene-chip" onClick={onClick}>{label}</button>;
}
