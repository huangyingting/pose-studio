'use client';

import { ChevronRight, Clapperboard, Eye, EyeOff, ImagePlus, Trash2 } from 'lucide-react';
import { editReference, renameScene, setCaption, setReferenceImage } from '@/lib/actions';
import { videoModel } from '@/lib/shots';
import { menu } from '../commands';
import { useFilm } from '../store-context';
import { IconButton, NameHeader, Slider, type HeaderChrome } from '../ui';
import type { Target } from './target';

/* The scene's header and sections (nothing selected): see sections.ts for which show when. */

export function SceneHeader({ t, chrome }: { t: Target; chrome: HeaderChrome }) {
  const film = useFilm();
  const index = t.store.getState().sceneIndex;
  return (
    <>
      <NameHeader chrome={chrome} lead={<Clapperboard size={16} strokeWidth={1.75} aria-hidden />} name={t.scene.name} label="Scene name" onRename={(name) => renameScene(t.store, name)} menu={() => menu('scene', { store: t.store, scene: index })} />
      <div className="psec">
        {/* The film's settings are the project's: a link to their one home, not a copy of them. */}
        <button type="button" className="summary-row" onClick={t.ctx.projectSettings} data-tip="The frame, what it is cut for and face features, for every scene">
          <span>Project settings…</span>
          <em>{film.frame}{film.target ? ` · ${videoModel(film.target)?.name}` : ''}</em>
          <ChevronRight size={14} aria-hidden />
        </button>
      </div>
    </>
  );
}

export function CaptionPanel({ t }: { t: Target }) {
  return (
    <label className="field">
      <span>Caption</span>
      <textarea
        value={t.scene.caption ?? ''}
        aria-label="Scene caption"
        rows={2}
        placeholder="What happens…"
        onChange={(e) => setCaption(t.store, t.scene.id, null, e.target.value)}
      />
    </label>
  );
}

export const referenceSummary = (t: Target) => {
  const r = t.scene.reference;
  return r ? `${Math.round(r.opacity * 100)}%${r.visible ? '' : ' · hidden'}` : 'None';
};

/** A photo or drawing over the canvas, to pose against: saved with the scene, not filmed or exported. */
export function ReferencePanel({ t }: { t: Target }) {
  const reference = t.scene.reference;
  return (
    <>
      <label className="btn subtle file-button">
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void setReferenceImage(t.store, file);
            e.target.value = '';
          }}
        />
        <ImagePlus size={14} aria-hidden /> {reference ? 'Replace image…' : 'Add an image…'}
      </label>
      {reference && (
        <Slider
          label="Opacity"
          min={0.05}
          max={1}
          step={0.01}
          value={reference.opacity}
          display={`${Math.round(reference.opacity * 100)}%`}
          onChange={(opacity) => editReference(t.store, { opacity }, 'reference')}
        />
      )}
    </>
  );
}

export function ReferenceActions({ t }: { t: Target }) {
  const reference = t.scene.reference;
  if (!reference) return null;
  return (
    <>
      <IconButton
        icon={reference.visible ? Eye : EyeOff}
        label={reference.visible ? 'Hide reference' : 'Show reference'}
        onClick={() => editReference(t.store, { visible: !reference.visible })}
      />
      <IconButton icon={Trash2} label="Remove reference" onClick={() => editReference(t.store, null)} />
    </>
  );
}
