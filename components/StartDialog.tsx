'use client';

import { useState } from 'react';
import { Clapperboard, FilePlus2, Layers, PersonStanding, Trash2, UsersRound, type LucideIcon } from 'lucide-react';
import { addScene, deleteShoot, deleteTemplate, newShoot, placeTemplate, sceneFromTemplate, startFilm } from '@/lib/actions';
import { COVERAGES } from '@/lib/coverage';
import { templateThumb } from '@/lib/previews';
import { SHOOT_PRESETS, TEMPLATE_GROUPS, shootsOf, templatesOf } from '@/lib/templates';
import { placeOrAdd } from './commands';
import { placingTemplate } from './placing';
import { Thumbnail } from './side/LibrarySection';
import type { Thumb } from './side/libraryItems';
import { useStore, useStudio } from './store-context';
import { Modal, Segmented } from './ui';

/** How long it is: as made (a still one still, a film as long as it is), or a film this long (s). */
const LENGTHS = [{ value: '0', label: 'As made' }, { value: '15', label: '15 s' }, { value: '30', label: '30 s' }, { value: '60', label: '1 min' }];

interface Tile {
  key: string;
  name: string;
  meta: string;
  icon: LucideIcon;
  thumb?: Thumb;
  open(): boolean;
  /** Small buttons on it: put it into this scene, delete one of mine. */
  actions?: { icon: LucideIcon; label: string; run(): void }[];
}

/**
 * A new scene (the one way to start one, #14): empty, a scene template (a film, people standing
 * together, a set-up, one of mine) or a shoot preset (a template filmed a way). As made, or a film
 * of a length that the director films.
 */
export function StartDialog({ onClose }: { onClose(): void }) {
  const store = useStore();
  const library = useStudio((s) => s.library);
  const active = useStudio((s) => s.activeFigure);
  const figure = store.scene.figures.find((f) => f.id === active);
  const [length, setLength] = useState('0');
  const seconds = Number(length);
  const templates = templatesOf(library);
  const shoots = shootsOf(library);

  const start = (tile: Tile) => {
    if (!tile.open()) return;
    onClose();
  };
  const empty: Tile = {
    key: 'empty', name: 'Empty', meta: 'One figure', icon: FilePlus2,
    open: () => (seconds ? startFilm(store, {}, seconds) : (addScene(store), true)),
  };
  const presets = shoots.map((p): Tile => {
    const t = templates.find((x) => x.id === p.template)!;
    const mine = !SHOOT_PRESETS.includes(p);
    return {
      key: `shoot:${p.id}`, name: p.name, meta: COVERAGES.find((c) => c.id === p.coverage)!.name, icon: Clapperboard, thumb: templateThumb(t.id, t.build),
      open: () => (seconds ? startFilm(store, { shoot: p.id }, seconds) : !!newShoot(store, p.id)),
      actions: mine ? [{ icon: Trash2, label: `Delete the shoot preset ${p.name}`, run: () => deleteShoot(store, p.id) }] : undefined,
    };
  });
  // (A template once: as the preset of the same name that films it, where there is one: a film.)
  const filmed = new Set(shoots.filter((p) => templates.find((t) => t.id === p.template)?.name === p.name).map((p) => p.template));
  const scenes = (group: string) => templates.filter((t) => t.group === group && !filmed.has(t.id)).map((t): Tile => ({
    key: `template:${t.id}`, name: t.name, meta: t.people === 1 ? '1 person' : `${t.people} people`, icon: t.people > 1 ? UsersRound : PersonStanding, thumb: templateThumb(t.id, t.build),
    open: () => (seconds ? startFilm(store, { template: t.id }, seconds) : sceneFromTemplate(store, t.id)),
    actions: [
      {
        icon: Layers,
        label: figure ? `Put ${t.name} into this scene, ${figure.name} in its first role` : `Put ${t.name} into this scene`,
        // (Placed with the pointer: onto a figure, its first role, or the floor.)
        run: () => { onClose(); placeOrAdd(placingTemplate(store, t.id), () => { placeTemplate(store, t.id); }); },
      },
      ...(t.group === 'Mine' ? [{ icon: Trash2, label: `Delete the template ${t.name}`, run: () => { deleteTemplate(store, t.id); } }] : []),
    ],
  }));
  const groups: [string, Tile[]][] = [
    ['Ready to shoot', [empty, ...presets.filter((p) => !p.actions)]],
    ...TEMPLATE_GROUPS.map((g): [string, Tile[]] => [g, scenes(g)]),
    ['My templates', [...presets.filter((p) => p.actions), ...scenes('Mine')]],
  ];

  return (
    <Modal title="New scene" icon={FilePlus2} onClose={onClose} wide>
      <div className="start-length">
        <span>Length</span>
        <Segmented label="Length" value={length} onChange={setLength} options={LENGTHS} />
      </div>
      <div className="start-groups">
        {groups.filter(([, tiles]) => tiles.length).map(([group, tiles]) => (
          <section key={group} aria-label={group}>
            <h3 className="start-group">{group}</h3>
            <div className="start-grid" role="list">
              {tiles.map((tile) => (
                <div key={tile.key} className="start-tile" role="listitem">
                  <button type="button" className="start-open" onClick={() => start(tile)}>
                    <span className="start-thumb"><Thumbnail thumb={tile.thumb} fallback={<tile.icon size={24} aria-hidden />} /></span>
                    <span className="start-name">{tile.name}</span>
                    <span className="start-meta">{tile.meta}</span>
                  </button>
                  {tile.actions && (
                    <span className="start-actions">
                      {tile.actions.map((a) => (
                        <button key={a.label} type="button" className="ibtn" aria-label={a.label} data-tip={a.label} onClick={a.run}>
                          <a.icon size={15} aria-hidden />
                        </button>
                      ))}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  );
}
