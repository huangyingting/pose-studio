'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Download, EyeOff, LayoutPanelTop, Plus, X } from 'lucide-react';
import { moveScene, setCaption, setHold, setInStory } from '@/lib/actions';
import { DEFAULT_HOLD, storyLength, storyScenes, storyShots, type StoryShot } from '@/lib/board';
import { panelLabel, panelTime } from '@/lib/boardExport';
import { frameAspect } from '@/lib/cameras';
import { thumbnail } from '@/lib/thumbnails';
import type { Scene, Style } from '@/lib/types';
import { drawShot } from '@/lib/video';
import { useProjectSettings, useStore, useStudio } from './store-context';
import { IconButton, NumberField } from './ui';
import { shortcutOf } from './commands';

const previewCache = new Map<string, string>();

/** A small frame of a shot of a scene at t, in the project's frame (cached by everything it shows). */
function preview(scene: Scene, t: number, style: Style, aspect: number) {
  const a = scene.animation;
  const key = JSON.stringify([t, style, aspect, scene.figures, scene.props, scene.cameras, scene.lighting, a?.actions, a?.props, a?.constraints, a?.shots]);
  let url = previewCache.get(key);
  if (!url) {
    const c = document.createElement('canvas');
    c.width = aspect >= 1 ? 320 : 180;
    c.height = Math.round(c.width / aspect);
    drawShot(c.getContext('2d')!, scene, t, { width: c.width, height: c.height, style, lineWidth: 1.2 });
    url = c.toDataURL('image/png');
    if (previewCache.size > 300) previewCache.delete(previewCache.keys().next().value!);
    previewCache.set(key, url);
  }
  return url;
}

/**
 * Storyboard: the story as panels, shot by shot: the project's scenes in the scene list's order
 * (dragging a panel moves its scene there), but those left out. An animated scene shows a panel
 * per shot (through its camera, with its caption and length), a still one a panel held for its
 * time. Its export is the Export dialog's (Storyboard image, Storyboard video…).
 */
export default function Board({ onClose, onExport }: { onClose(): void; onExport(): void }) {
  const store = useStore();
  const library = useStudio((s) => s.library);
  const look = useProjectSettings();
  const aspect = frameAspect();
  const shots = useMemo(() => storyShots(library), [library]);
  const entries = useMemo(() => storyScenes(library).map((s) => s.id), [library]);
  const out = library.scenes.filter((s) => s.offStory);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  // Drawn one at a time, in idle moments (the board opens at once, however long the story).
  useEffect(() => {
    let i = 0;
    let t = 0;
    const next: string[] = [];
    const step = () => {
      const start = performance.now();
      for (; i < shots.length && performance.now() - start < 12; i++) next[i] = preview(shots[i].scene, panelTime(shots[i]), look.style, aspect);
      setThumbs([...next]);
      if (i < shots.length) t = window.setTimeout(step, 16);
    };
    t = window.setTimeout(step, 30);
    return () => clearTimeout(t);
  }, [shots, look.style, aspect]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement).closest('textarea, input')) { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** Open a panel's scene at its shot. */
  const open = (x: StoryShot) => {
    const i = library.scenes.findIndex((s) => s.id === x.scene.id);
    if (i < 0) return;
    store.setSceneIndex(i);
    if (x.span) {
      store.setTime(x.span.start);
      store.select({ kind: 'shot', shot: x.span.shot.id });
    }
    onClose();
  };

  // Scenes left out of the story, to put back in.
  const addList = adding && (
    <ul className="board-add-list" aria-label="Scenes to add">
      {out.map((s) => (
        <li key={s.id}>
          <button type="button" onClick={() => { setInStory(store, s.id, true); setAdding(out.length > 1); }}>
            {/* Generated data: URLs, so next/image does not apply. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumbnail(s)} alt="" />
            <span>{s.name}{s.animation ? ` · ${s.animation.shots.length} ${s.animation.shots.length === 1 ? 'shot' : 'shots'}` : ''}</span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="board" role="dialog" aria-modal="true" aria-label="Storyboard">
      <header className="board-head">
        <h2><LayoutPanelTop size={18} aria-hidden /> Storyboard</h2>
        <span className="muted">{entries.length} {entries.length === 1 ? 'scene' : 'scenes'} · {shots.length} {shots.length === 1 ? 'shot' : 'shots'} · {storyLength(shots).toFixed(1)} s</span>
        <span className="spacer" />
        {out.length > 0 && (
          <button type="button" className="btn subtle" aria-expanded={adding} onClick={() => setAdding(!adding)}>
            <Plus size={15} aria-hidden /> Add a scene
          </button>
        )}
        <button type="button" className="btn primary" disabled={!shots.length} onClick={onExport}>
          <Download size={15} aria-hidden /> Export
        </button>
        <IconButton icon={X} label="Close storyboard" shortcut={shortcutOf('app.deselect')} onClick={onClose} />
      </header>
      {addList}
      {shots.length ? (
        <ol className="board-grid">
          {shots.map((x, i) => {
            const entry = library.scenes.findIndex((s) => s.id === x.scene.id);
            const first = i === 0 || shots[i - 1].scene.id !== x.scene.id;
            return (
              <li
                key={`${x.scene.id}:${x.span?.shot.id ?? ''}`}
                className={`panel-card${dragFrom === entry ? ' dragging' : ''}${first ? ' first' : ''}`}
                draggable
                onDragStart={(e) => { setDragFrom(entry); e.dataTransfer.effectAllowed = 'move'; }}
                onDragOver={(e) => { if (dragFrom !== null) e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); if (dragFrom !== null) moveScene(store, dragFrom, entry); setDragFrom(null); }}
                onDragEnd={() => setDragFrom(null)}
              >
                <div className="panel-frame" style={{ aspectRatio: aspect }}>
                  {/* Generated data: URLs, so next/image does not apply. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {thumbs[i] ? <img src={thumbs[i]} alt="" draggable={false} /> : <div className="ph" />}
                  <span className="panel-no">{i + 1}</span>
                  <div className="panel-actions">
                    <IconButton icon={ArrowUpRight} label={`Open ${x.scene.name}${x.span ? ` at ${x.span.shot.name}` : ''}`} onClick={() => open(x)} size={14} />
                    <IconButton icon={EyeOff} label={`Leave ${x.scene.name} out of the story`} onClick={() => setInStory(store, x.scene.id, false)} size={14} />
                  </div>
                </div>
                <div className="panel-meta">
                  <span className="panel-name" title={panelLabel(x)}>{x.scene.name}{x.span ? ` · ${x.span.shot.name}` : ''}</span>
                  {x.span ? <span className="muted">{x.length.toFixed(1)} s</span> : (
                    <div className="panel-hold">
                      <NumberField prefix="⏱" label={`${x.scene.name}: seconds on screen`} value={x.scene.hold ?? DEFAULT_HOLD} step={0.1} min={0.2} max={60} digits={1} onChange={(hold) => setHold(store, x.scene.id, hold)} />
                    </div>
                  )}
                </div>
                <textarea
                  className="panel-caption"
                  value={x.caption}
                  placeholder="What happens…"
                  aria-label={`Panel ${i + 1} caption`}
                  rows={2}
                  onChange={(e) => setCaption(store, x.scene.id, x.span?.shot.id ?? null, e.target.value)}
                />
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="board-empty">
          <LayoutPanelTop size={28} strokeWidth={1.5} aria-hidden />
          <h3>Tell a story, one scene at a time</h3>
          {!adding && out.length > 0 && <button type="button" className="btn primary" onClick={() => setAdding(true)}><Plus size={15} aria-hidden /> Add a scene</button>}
        </div>
      )}
    </div>
  );
}
