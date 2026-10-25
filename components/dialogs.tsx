'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { addFigures, appendScenes } from '@/lib/actions';
import { newFigure, newScene } from '@/lib/doc';
import { Ink } from '@/lib/ink';
import { Mannequin } from '@/lib/mannequin';
import { detectPeople, loadImage, type DetectedPerson } from '@/lib/photo';
import {
  canvasToBlob, DEFAULT_EXPORT, downloadBlob, exportCells, parseExportOptions, safeFilename, sheetSize, type ExportOptions,
} from '@/lib/render';
import { fromMediaPipe, retarget } from '@/lib/retarget';
import { sharedRenderer } from '@/lib/thumbnails';
import type { BodyParams, Figure, Style } from '@/lib/types';
import { useScene, useStore, useStudio } from './store-context';
import { Field, Modal, Segmented, Toggle, type Notify } from './ui';

/* ---------------- Export ---------------- */

const EXPORT_KEY = 'pose-studio-export-v1';

function loadExportOptions(): ExportOptions {
  try {
    const raw = localStorage.getItem(EXPORT_KEY);
    if (raw) return parseExportOptions(JSON.parse(raw));
  } catch {
    // ignore
  }
  return { ...DEFAULT_EXPORT };
}

const STYLE_OPTIONS: { value: Style; label: string }[] = [
  { value: 'line', label: 'Line art' },
  { value: 'shaded', label: 'Shaded' },
  { value: 'silhouette', label: 'Silhouette' },
];

export function ExportDialog({ onClose, notify }: { onClose(): void; notify: Notify }) {
  const scenes = useStudio((s) => s.library.scenes);
  const light = useStudio((s) => s.settings.light);
  const scene = useScene();
  const [o, setO] = useState<ExportOptions>(loadExportOptions);
  const [busy, setBusy] = useState(false);
  const preview = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<ExportOptions>) => setO((prev) => ({ ...prev, ...patch }));

  const cells = useMemo(() => exportCells(scenes, scene, o), [o, scenes, scene]);
  const { width, height } = sheetSize(cells.length, o);
  const tooBig = width * height > 120_000_000 || width > 16384 || height > 16384;

  useEffect(() => {
    try {
      localStorage.setItem(EXPORT_KEY, JSON.stringify(o));
    } catch {
      // Not critical: the options just won't be remembered.
    }
    // Low-resolution preview of the layout.
    const t = setTimeout(() => {
      const scale = Math.min(1, 360 / Math.max(width, height));
      const small = sharedRenderer().sheet(cells, {
        ...o,
        cellWidth: Math.max(24, Math.round(o.cellWidth * scale)),
        cellHeight: Math.max(24, Math.round(o.cellHeight * scale)),
        lineWidth: Math.max(0.8, o.lineWidth * scale * 1.5),
        labels: false,
      }, light);
      small.className = 'preview-canvas';
      preview.current?.replaceChildren(small);
    }, 150);
    return () => clearTimeout(t);
  }, [o, cells, width, height, light]);

  const run = async () => {
    setBusy(true);
    await new Promise((r) => setTimeout(r, 30)); // let the button state paint
    try {
      const canvas = sharedRenderer().sheet(cells, o, light);
      const blob = await canvasToBlob(canvas, o.format, 0.92);
      const ext = o.format === 'png' ? 'png' : 'jpg';
      const base = o.scope === 'all' ? 'Pose' : safeFilename(scene.name);
      const name = `${base}${o.scope === 'turnaround' ? '_turnaround' : ''}.${ext}`;
      downloadBlob(blob, name);
      notify(`Saved ${name} (${canvas.width} × ${canvas.height})`);
      onClose();
    } catch (err) {
      notify(`Export failed: ${(err as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const num = (key: 'columns' | 'cellWidth' | 'cellHeight', min: number, max: number) => (
    <input
      type="number"
      min={min}
      max={max}
      value={o[key]}
      onChange={(e) => {
        const v = Math.round(Number(e.target.value));
        if (Number.isFinite(v)) set({ [key]: Math.min(max, Math.max(min, v)) });
      }}
    />
  );

  return (
    <Modal
      title="Export image"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="muted">{width} × {height} px{tooBig ? ' — too large for most browsers' : ''}</span>
          <button onClick={() => setO({ ...DEFAULT_EXPORT })}>Reset to Pose.jpg layout</button>
          <button className="primary" onClick={run} disabled={busy || tooBig} data-autofocus>
            {busy ? 'Rendering…' : 'Download'}
          </button>
        </>
      }
    >
      <div className="export-grid">
        <div className="form">
          <Field label="What">
            <Segmented<ExportOptions['scope']> label="What"
              value={o.scope}
              onChange={(scope) => set({ scope })}
              options={[
                { value: 'all', label: `All poses (${scenes.length})` },
                { value: 'current', label: 'This pose' },
                { value: 'turnaround', label: 'Turnaround', title: 'This pose from evenly spaced angles' },
              ]}
            />
          </Field>
          {o.scope === 'turnaround' && (
            <Field label="Angles">
              <Segmented<'4' | '8'> label="Angles"
                value={String(o.angles) as '4' | '8'}
                onChange={(v) => set({ angles: Number(v) as 4 | 8 })}
                options={[{ value: '4', label: '4 (every 90°)' }, { value: '8', label: '8 (every 45°)' }]}
              />
            </Field>
          )}
          <Field label="Style">
            <Segmented<Style> label="Style" value={o.style} onChange={(style) => set({ style })} options={STYLE_OPTIONS} />
          </Field>
          <Field label="Format">
            <Segmented<ExportOptions['format']> label="Format" value={o.format} onChange={(format) => set({ format })} options={[{ value: 'jpeg', label: 'JPG' }, { value: 'png', label: 'PNG' }]} />
          </Field>
          <div className="row">
            <label>Columns {num('columns', 1, 12)}</label>
            <label>Cell width {num('cellWidth', 100, 4000)}</label>
            <label>Cell height {num('cellHeight', 100, 4000)}</label>
          </div>
          <label>Line weight: {o.lineWidth.toFixed(1)} px
            <input type="range" min={0.5} max={8} step={0.1} value={o.lineWidth} onChange={(e) => set({ lineWidth: Number(e.target.value) })} />
          </label>
          <label>Padding: {Math.round(o.margin * 100)}%
            <input type="range" min={0} max={0.4} step={0.01} value={o.margin} onChange={(e) => set({ margin: Number(e.target.value) })} />
          </label>
          <Toggle label="Captions under each cell" checked={o.labels} onChange={(labels) => set({ labels })} />
          {o.scope === 'all' && (
            <Toggle
              label="Same scale in every cell"
              hint="Keep figures comparable in size instead of filling each cell"
              checked={o.sameScale}
              onChange={(sameScale) => set({ sameScale })}
            />
          )}
          <Toggle
            label="Transparent background (PNG)"
            checked={o.transparent && o.format === 'png'}
            onChange={(transparent) => set({ transparent, format: transparent ? 'png' : o.format })}
          />
          {o.style === 'shaded' && <p className="muted small">Shaded exports use the light set in the View tab.</p>}
        </div>
        <div className="preview" ref={preview} aria-label="Preview" />
      </div>
    </Modal>
  );
}

/* ---------------- Pose from photo ---------------- */

const BONES: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32],
];

function poseFigures(people: DetectedPerson[], body: BodyParams): { figures: Figure[]; skipped: string[] } {
  const m = new Mannequin(new Ink(), body);
  const skipped = new Set<string>();
  const figures = people.map((p, i) => {
    const res = retarget(m, fromMediaPipe(p.world));
    res.skipped.forEach((s) => skipped.add(s));
    // Spread people out horizontally in the order they appear in the photo.
    const hipX = p.image.length > 24 ? (p.image[23].x + p.image[24].x) / 2 : 0.5;
    return newFigure({ name: people.length > 1 ? `Person ${i + 1}` : 'Figure', body: { ...body }, joints: res.joints, position: [(hipX - 0.5) * 3, 0, 0] });
  });
  m.dispose();
  return { figures, skipped: [...skipped] };
}

export function PhotoDialog({ onClose, notify, onReference }: {
  onClose(): void;
  notify: Notify;
  onReference(url: string): void;
}) {
  const store = useStore();
  const activeFigure = useStudio((s) => s.activeFigure);
  const scene = useScene();
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [people, setPeople] = useState<DetectedPerson[]>([]);
  const [target, setTarget] = useState<'new' | 'current'>('new');
  const [asReference, setAsReference] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const body = useMemo(() => scene.figures.find((f) => f.id === activeFigure)?.body ?? newFigure().body, [scene, activeFigure]);

  const pick = async (file: File) => {
    const src = URL.createObjectURL(file);
    setUrl(src);
    setPeople([]);
    setStatus('loading');
    setMessage('Loading the pose model (first time only)…');
    try {
      const img = await loadImage(src);
      setMessage('Finding people…');
      const found = await detectPeople(img);
      setPeople(found);
      setStatus(found.length ? 'done' : 'error');
      setMessage(found.length ? `Found ${found.length} ${found.length === 1 ? 'person' : 'people'}.` : 'No person found. Detection needs a photo of a real person — line drawings and sketches are not recognised.');
      draw(img, found);
    } catch (err) {
      setStatus('error');
      setMessage(`Could not analyse the photo: ${(err as Error).message}`);
    }
  };

  const draw = (img: HTMLImageElement, found: DetectedPerson[]) => {
    const c = canvas.current;
    if (!c) return;
    const scale = Math.min(1, 520 / img.width, 360 / img.height);
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (const p of found) {
      ctx.strokeStyle = '#4f6bed';
      for (const [a, b] of BONES) {
        const A = p.image[a];
        const B = p.image[b];
        if (!A || !B || (A.visibility ?? 1) < 0.35 || (B.visibility ?? 1) < 0.35) continue;
        ctx.beginPath();
        ctx.moveTo(A.x * c.width, A.y * c.height);
        ctx.lineTo(B.x * c.width, B.y * c.height);
        ctx.stroke();
      }
    }
  };

  const apply = () => {
    const { figures, skipped } = poseFigures(people, body);
    const photoView = { yaw: 0, pitch: 0, fov: 30 };
    if (target === 'new') {
      const s = newScene('From photo', figures);
      s.view = photoView;
      appendScenes(store, [s]);
    } else if (activeFigure) {
      const [first, ...rest] = figures;
      store.updateScene((s) => ({
        ...s,
        view: photoView,
        figures: s.figures.map((f) => (f.id === activeFigure ? { ...f, joints: first.joints } : f)),
      }));
      if (rest.length) addFigures(store, rest);
    }
    if (asReference && url) onReference(url);
    notify(skipped.length ? `Posed. Not visible in the photo: ${skipped.join(', ')}` : 'Pose applied from photo');
    onClose();
  };

  return (
    <Modal
      title="Pose from photo"
      onClose={onClose}
      wide
      footer={
        <>
          <span className={status === 'error' ? 'error-text' : 'muted'}>{message}</span>
          <button className="primary" disabled={status !== 'done'} onClick={apply}>Apply pose</button>
        </>
      }
    >
      <div className="photo-grid">
        <div className="form">
          <label
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f?.type.startsWith('image/')) pick(f);
            }}
          >
            <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ''; }} data-autofocus />
            <strong>Choose a photo</strong>
            <span className="muted small">or drop it here. Full-body shots work best. The photo never leaves your computer.</span>
          </label>
          <Field label="Put the pose on">
            <Segmented<'new' | 'current'> label="Put the pose on"
              value={target}
              onChange={setTarget}
              options={[{ value: 'new', label: 'A new pose' }, { value: 'current', label: 'The current figure' }]}
            />
          </Field>
          <Toggle label="Show the photo as a reference overlay" checked={asReference} onChange={setAsReference} />
        </div>
        <div className="preview">
          {status === 'loading' && <div className="spinner" aria-label="Working" />}
          <canvas ref={canvas} className={url ? '' : 'hidden'} />
          {!url && <p className="muted">The detected skeleton will appear here.</p>}
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- Help ---------------- */

const SHORTCUTS: [string, string][] = [
  ['Click a body part', 'Select it and rotate with the gizmo or sliders'],
  ['Drag orange / green dots', 'Move hands / feet (the limb follows)'],
  ['Drag the purple dot', 'Move the hips; feet stay planted'],
  ['Drag the small dots', 'Point elbows and knees'],
  ['Left drag · right drag · wheel', 'Orbit · pan · zoom'],
  ['W / E / R', 'Move / rotate / scale gizmo'],
  ['1 – 6', 'Front, back, left, right, top, ¾ view'],
  ['F', 'Frame the scene'],
  ['M', 'Mirror pose'],
  ['H', 'Show / hide drag handles'],
  ['L', 'Cycle line art / shaded / silhouette'],
  ['P', 'Gesture practice (timed slideshow)'],
  ['[  /  ]', 'Previous / next pose'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
  ['Ctrl+C / Ctrl+V', 'Copy / paste pose'],
  ['Ctrl+D', 'Duplicate pose'],
  ['Ctrl+E', 'Export image'],
  ['Click a slider value', 'Type an exact angle'],
  ['Arrow keys in the library', 'Move between poses (Alt+arrows reorders)'],
  ['Delete', 'Delete selected prop'],
  ['Esc', 'Deselect'],
  ['?', 'This help'],
];

export function HelpDialog({ onClose }: { onClose(): void }) {
  return (
    <Modal title="How to use Pose Studio" onClose={onClose}>
      <table className="shortcuts">
        <tbody>
          {SHORTCUTS.map(([k, v]) => (
            <tr key={k}><th><kbd>{k}</kbd></th><td>{v}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        Your poses are saved in this browser automatically. Use <b>Save</b> in the menu to keep a file copy, and <b>Share</b> to send a
        single pose as a link.
      </p>
    </Modal>
  );
}
