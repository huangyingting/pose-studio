'use client';

import { useState } from 'react';
import { Clapperboard, FilePlus2 } from 'lucide-react';
import { startFilm } from '@/lib/actions';
import { LIBRARY_CATEGORIES } from './side/libraryItems';
import { Thumbnail } from './side/LibrarySection';
import { useStore } from './store-context';
import { Modal, Segmented, type Notify } from './ui';

/** How long the film is (s). */
const LENGTHS = [{ value: '15', label: '15 s' }, { value: '30', label: '30 s' }, { value: '60', label: '1 min' }];

/**
 * A new scene that starts from a result (#14): what is filmed (a shoot preset, a template, or an
 * empty scene) and how long; it opens as a film, the director filming it.
 */
export function StartDialog({ onClose, notify }: { onClose(): void; notify: Notify }) {
  const store = useStore();
  const [length, setLength] = useState('30');
  const ui = { notify: (t: string) => notify(t), notifyUndo: (t: string) => notify(t) };
  // The Library's templates and shoot presets, with their thumbnails (a template once: as its
  // preset, where one of the same name films it).
  const all = LIBRARY_CATEGORIES.find((c) => c.id === 'templates')!.items(store, ui);
  const shot = new Set(all.filter((it) => it.key.startsWith('shoot:')).map((it) => it.name));
  const items = all.filter((it) => !(it.key.startsWith('template:') && shot.has(it.name)));
  const start = (what: { template?: string; shoot?: string }, name: string) => {
    if (startFilm(store, what, Number(length))) {
      notify(`${name}: a ${LENGTHS.find((l) => l.value === length)!.label} film`);
      onClose();
    }
  };
  return (
    <Modal title="What are you filming?" icon={Clapperboard} onClose={onClose} wide>
      <div className="start-length">
        <span>How long</span>
        <Segmented label="How long" value={length} onChange={setLength} options={LENGTHS} />
      </div>
      <div className="start-grid" role="list" aria-label="What to film">
        <button type="button" className="start-tile" onClick={() => start({}, 'Empty')}>
          <span className="start-thumb"><FilePlus2 size={28} strokeWidth={1.5} aria-hidden /></span>
          <span className="start-name">Empty</span>
          <span className="start-meta">One figure, nothing yet</span>
        </button>
        {items.map((it) => {
          const [kind, id] = it.key.split(':');
          return (
            <button key={it.key} type="button" className="start-tile" onClick={() => start(kind === 'shoot' ? { shoot: id } : { template: id }, it.name)}>
              <span className="start-thumb"><Thumbnail thumb={it.thumb} fallback={<it.icon size={24} aria-hidden />} /></span>
              <span className="start-name">{it.name}</span>
              <span className="start-meta">{it.meta}</span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
