'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, ImagePlus, Keyboard, LayoutGrid, RefreshCw, ScanFace, Square } from 'lucide-react';
import { addFigures, appendScenes } from '@/lib/actions';
import { newFigure, newScene } from '@/lib/doc';
import { Ink } from '@/lib/ink';
import { Mannequin } from '@/lib/mannequin';
import { detectPeople, loadImage, type DetectedPerson } from '@/lib/photo';
import {
  canvasToBlob, DEFAULT_EXPORT, downloadBlob, exportCells, parseExportOptions, safeFilename, sheetSize, type ExportOptions,
} from '@/lib/render';
import { fromMediaPipe, retarget } from '@/lib/retarget';
import { STYLE_LIST, styleDef } from '@/lib/styles';
import { sharedRenderer } from '@/lib/thumbnails';
import type { BodyParams, Figure, Style } from '@/lib/types';
import { useScene, useStore, useStudio } from './store-context';
import { Field, Modal, Segmented, Select, Slider, Toggle, type Notify } from './ui';

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
      icon={Download}
      onClose={onClose}
      wide
      footer={
        <>
          <span className={tooBig ? 'error-text' : 'muted'}>{width} × {height} px{tooBig ? ' — too large for most browsers' : ''}</span>
          <button type="button" className="btn ghost" onClick={() => setO({ ...DEFAULT_EXPORT })}>Reset to Pose.jpg layout</button>
          <button type="button" className="btn primary" onClick={run} disabled={busy || tooBig} data-autofocus>
            <Download size={15} aria-hidden /> {busy ? 'Rendering…' : 'Download'}
          </button>
        </>
      }
    >
      <div className="export-grid">
        <div className="form">
          <Field label="What">
            <Segmented<ExportOptions['scope']>
              label="What"
              full
              value={o.scope}
              onChange={(scope) => set({ scope })}
              options={[
                { value: 'all', label: `All ${scenes.length}`, icon: LayoutGrid, title: 'Every pose in the library' },
                { value: 'current', label: 'This pose', icon: Square },
                { value: 'turnaround', label: 'Turnaround', icon: RefreshCw, title: 'This pose from evenly spaced angles' },
              ]}
            />
          </Field>
          {o.scope === 'turnaround' && (
            <Field label="Angles">
              <Segmented<'4' | '8'>
                label="Angles"
                full
                value={String(o.angles) as '4' | '8'}
                onChange={(v) => set({ angles: Number(v) as 4 | 8 })}
                options={[{ value: '4', label: '4 · every 90°' }, { value: '8', label: '8 · every 45°' }]}
              />
            </Field>
          )}
          <div className="row">
            <label>Style
              <Select<Style> label="Style" value={o.style} onChange={(style) => set({ style })} options={STYLE_LIST.map((st) => ({ value: st.id, label: st.label }))} />
            </label>
            <label>Format
              <Select<ExportOptions['format']> label="Format" value={o.format} onChange={(format) => set({ format })} options={[{ value: 'jpeg', label: 'JPG' }, { value: 'png', label: 'PNG' }]} />
            </label>
          </div>
          <div className="row">
            <label>Columns {num('columns', 1, 12)}</label>
            <label>Cell width {num('cellWidth', 100, 4000)}</label>
            <label>Cell height {num('cellHeight', 100, 4000)}</label>
          </div>
          <Slider label="Line weight" min={0.5} max={8} step={0.1} value={o.lineWidth} display={`${o.lineWidth.toFixed(1)} px`} onChange={(lineWidth) => set({ lineWidth })} />
          <Slider label="Padding" min={0} max={0.4} step={0.01} value={o.margin} display={`${Math.round(o.margin * 100)}%`} onChange={(margin) => set({ margin })} />
          <div className="stack">
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
          </div>
          {styleDef(o.style).lit && <p className="muted small">Uses the light set in the Render tab.</p>}
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
      icon={ScanFace}
      onClose={onClose}
      wide
      footer={
        <>
          <span className={status === 'error' ? 'error-text' : 'muted'}>{message}</span>
          <button type="button" className="btn primary" disabled={status !== 'done'} onClick={apply}>Apply pose</button>
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
            <ImagePlus size={22} strokeWidth={1.5} aria-hidden />
            <strong>Choose a photo</strong>
            <span className="muted small">or drop it here. Full-body shots work best. The photo never leaves your computer.</span>
          </label>
          <Field label="Put the pose on">
            <Segmented<'new' | 'current'>
              label="Put the pose on"
              full
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
  ['Select a body part', 'Click'],
  ['Move hands / feet (IK)', 'Drag dots'],
  ['Orbit · pan · zoom', 'Drag · Right drag · Wheel'],
  ['Move / rotate / scale', 'W  E  R'],
  ['Camera views', '1 – 6'],
  ['Frame all', 'F'],
  ['Mirror pose', 'M'],
  ['Drag handles', 'H'],
  ['Next render style', 'L'],
  ['Gesture practice', 'P'],
  ['Previous / next pose', '[  ]'],
  ['Undo / redo', 'Ctrl Z  ·  Ctrl Shift Z'],
  ['Copy / paste pose', 'Ctrl C  ·  Ctrl V'],
  ['Duplicate pose', 'Ctrl D'],
  ['Export image', 'Ctrl E'],
  ['Save library', 'Ctrl S'],
  ['Reorder poses', 'Alt + arrows'],
  ['Delete prop', 'Del'],
  ['Deselect', 'Esc'],
  ['This help', '?'],
];

export function HelpDialog({ onClose }: { onClose(): void }) {
  return (
    <Modal title="Keyboard shortcuts" icon={Keyboard} onClose={onClose} wide>
      <div className="shortcuts">
        {SHORTCUTS.map(([what, keys]) => (
          <div key={what} className="shortcut"><span>{what}</span><kbd>{keys}</kbd></div>
        ))}
      </div>
      <p className="muted small" style={{ marginTop: 14 }}>
        Click a slider&apos;s value to type an exact number. Poses are saved in this browser automatically; use <b>Save library</b> in
        the main menu to keep a file, and <b>Share link</b> to send a single pose.
      </p>
    </Modal>
  );
}
