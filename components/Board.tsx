'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Download, Film, Image as ImageIcon, LayoutPanelTop, Plus, Trash2, X } from 'lucide-react';
import { addToBoard, editPanel, moveOnBoard, removeFromBoard } from '@/lib/actions';
import { boardDuration, boardPanels } from '@/lib/board';
import { boardSheet, recordAnimatic } from '@/lib/boardExport';
import { canvasToBlob, downloadBlob } from '@/lib/render';
import { STYLE_LIST } from '@/lib/styles';
import type { Panel, Scene, Style } from '@/lib/types';
import { drawShot, videoSupported } from '@/lib/video';
import { useStore, useStudio } from './store-context';
import { IconButton, Menu, NumberField, Select, Toggle, type Notify } from './ui';

const PREVIEW = { width: 320, height: 180 };
const previewCache = new Map<string, string>();

/** A small 16:9 frame of a scene through the camera filming its start (cached by everything it shows). */
function preview(scene: Scene, style: Style, faces: boolean) {
  const a = scene.animation;
  const key = JSON.stringify([style, faces, scene.figures, scene.props, scene.cameras, scene.light, a?.actions, a?.props, a?.constraints, a?.shots, a?.frame]);
  let url = previewCache.get(key);
  if (!url) {
    const c = document.createElement('canvas');
    c.width = PREVIEW.width;
    c.height = PREVIEW.height;
    drawShot(c.getContext('2d')!, scene, 0, { ...PREVIEW, style, lineWidth: 1.2, faces });
    url = c.toDataURL('image/png');
    if (previewCache.size > 200) previewCache.delete(previewCache.keys().next().value!);
    previewCache.set(key, url);
  }
  return url;
}

/**
 * Storyboard: the story as a row of panels, each a scene of the project with a caption and
 * how long it stays on screen. Export a board sheet or an animatic.
 */
export default function Board({ onClose, notify }: { onClose(): void; notify: Notify }) {
  const store = useStore();
  const library = useStudio((s) => s.library);
  const settings = useStudio((s) => s.settings);
  const panels = useMemo(() => boardPanels(library), [library]);
  const scenes = useMemo(() => new Map(library.scenes.map((s) => [s.id, s])), [library]);
  const [style, setStyle] = useState<Style>('line');
  const [captions, setCaptions] = useState(true);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      const next: Record<string, string> = {};
      for (const p of panels) {
        const s = scenes.get(p.sceneId);
        if (s) next[p.id] = preview(s, style, settings.faces);
      }
      setThumbs(next);
    }, 60);
    return () => clearTimeout(t);
  }, [panels, scenes, style, settings.faces]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement).closest('textarea, input')) { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const resolve = (p: Panel) => scenes.get(p.sceneId);
  const opts = { style, faces: settings.faces, captions };

  const exportSheet = async () => {
    setBusy('sheet');
    await new Promise((r) => setTimeout(r, 30));
    try {
      const canvas = boardSheet(panels, resolve, opts);
      downloadBlob(await canvasToBlob(canvas, 'png'), 'Storyboard.png');
      notify(`Saved Storyboard.png (${canvas.width} × ${canvas.height})`);
    } catch (err) {
      notify(`Export failed: ${(err as Error).message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const exportAnimatic = async () => {
    setBusy('animatic');
    try {
      const { blob, ext } = await recordAnimatic(panels, resolve, { ...opts, width: 1280, height: 720 }, (f) => setBusy(`animatic ${Math.round(f * 100)}%`));
      downloadBlob(blob, `Animatic.${ext}`);
      notify(`Saved Animatic.${ext} (${boardDuration(panels).toFixed(1)} s)`);
    } catch (err) {
      notify(`Export failed: ${(err as Error).message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const open = (sceneId: string) => {
    const i = library.scenes.findIndex((s) => s.id === sceneId);
    if (i >= 0) store.setSceneIndex(i);
    onClose();
  };

  return (
    <div className="board" role="dialog" aria-modal="true" aria-label="Storyboard">
      <header className="board-head">
        <h2><LayoutPanelTop size={18} aria-hidden /> Storyboard</h2>
        <span className="muted">{panels.length} {panels.length === 1 ? 'panel' : 'panels'} · {boardDuration(panels).toFixed(1)} s</span>
        <span className="spacer" />
        <div className="board-style">
          <Select<Style> label="Board style" value={style} onChange={setStyle} options={STYLE_LIST.map((s) => ({ value: s.id, label: s.label }))} />
        </div>
        <Toggle label="Captions" checked={captions} onChange={setCaptions} />
        <button type="button" className="btn subtle" onClick={() => addToBoard(store)}>
          <Plus size={15} aria-hidden /> Add “{store.scene.name}”
        </button>
        <Menu
          label="Export storyboard"
          align="end"
          className="btn primary"
          items={[
            { label: 'Board sheet (PNG)', icon: ImageIcon, disabled: !panels.length, onSelect: exportSheet },
            { label: 'Animatic (video)', icon: Film, disabled: !panels.length || !videoSupported(), onSelect: exportAnimatic },
          ]}
        >
          <Download size={15} aria-hidden /> {busy ? (busy.startsWith('animatic') ? `Recording ${busy.split(' ')[1] ?? ''}` : 'Rendering…') : 'Export'}
        </Menu>
        <IconButton icon={X} label="Close storyboard" shortcut="Esc" onClick={onClose} />
      </header>
      {panels.length ? (
        <ol className="board-grid">
          {panels.map((p, i) => {
            const s = scenes.get(p.sceneId)!;
            return (
              <li
                key={p.id}
                className={`panel-card${dragFrom === i ? ' dragging' : ''}`}
                draggable
                onDragStart={(e) => { setDragFrom(i); e.dataTransfer.effectAllowed = 'move'; }}
                onDragOver={(e) => { if (dragFrom !== null) e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); if (dragFrom !== null) moveOnBoard(store, dragFrom, i); setDragFrom(null); }}
                onDragEnd={() => setDragFrom(null)}
              >
                <div className="panel-frame">
                  {/* Generated data: URLs, so next/image does not apply. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {thumbs[p.id] ? <img src={thumbs[p.id]} alt="" draggable={false} /> : <div className="ph" />}
                  <span className="panel-no">{i + 1}</span>
                  <div className="panel-actions">
                    <IconButton icon={ArrowUpRight} label={`Open ${s.name}`} onClick={() => open(p.sceneId)} size={14} />
                    <IconButton icon={Trash2} label={`Remove panel ${i + 1}`} onClick={() => removeFromBoard(store, p.id)} size={14} />
                  </div>
                </div>
                <div className="panel-meta">
                  <span className="panel-name">{s.name}{s.animation ? ' · animated' : ''}</span>
                  <div className="panel-hold">
                    <NumberField prefix="⏱" label={`Panel ${i + 1} hold (seconds)`} value={p.hold} step={0.1} min={0.2} max={60} digits={1} onChange={(hold) => editPanel(store, p.id, { hold })} />
                  </div>
                </div>
                <textarea
                  className="panel-caption"
                  value={p.caption ?? ''}
                  placeholder="What happens…"
                  aria-label={`Panel ${i + 1} caption`}
                  rows={2}
                  onChange={(e) => editPanel(store, p.id, { caption: e.target.value })}
                />
              </li>
            );
          })}
          <li className="panel-add">
            <button type="button" onClick={() => addToBoard(store)}>
              <Plus size={20} aria-hidden />
              <span>Add the open scene</span>
            </button>
          </li>
        </ol>
      ) : (
        <div className="board-empty">
          <LayoutPanelTop size={28} strokeWidth={1.5} aria-hidden />
          <h3>Tell a story, one panel at a time</h3>
          <p className="muted">Each panel is one of your scenes, framed by its camera, with a caption and how long it stays on screen.</p>
          <button type="button" className="btn primary" onClick={() => addToBoard(store)}><Plus size={15} aria-hidden /> Add “{store.scene.name}”</button>
        </div>
      )}
    </div>
  );
}
