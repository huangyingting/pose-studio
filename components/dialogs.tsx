'use client';

import { rovingKey, useRoving, type Roving } from './roving';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Clapperboard, Download, Film, ImagePlus, Keyboard, LayoutGrid, LayoutPanelTop, Package, RefreshCw, Rows3, ScanFace, Square, type LucideIcon } from 'lucide-react';
import { keyframePack } from '@/lib/pack';
import { sceneShots, storyLength, storyShots } from '@/lib/board';
import { boardSheet, boardSize, recordStory } from '@/lib/boardExport';
import { sceneAt } from '@/lib/evaluate';
import { addCamera, applyPhotoPose } from '@/lib/actions';
import { newFigure } from '@/lib/doc';
import { Ink } from '@/lib/ink';
import { Mannequin } from '@/lib/mannequin';
import { detectPeople, loadImage, type DetectedPerson } from '@/lib/photo';
import {
  canvasToBlob, DEFAULT_EXPORT, downloadBlob, exportCells, laidOut, parseExportOptions, safeFilename, sheetSize, VIDEO_SIZES, videoSize, type ExportOptions, type Pass, type VideoSize,
} from '@/lib/render';
import { ASPECTS, cameraAt, frameAspect, type CameraView } from '@/lib/cameras';
import { recordVideo, videoSupported } from '@/lib/video';
import { fromMediaPipe, retarget } from '@/lib/retarget';
import { STYLE_LIST, styleDef } from '@/lib/styles';
import { sharedRenderer } from '@/lib/thumbnails';
import { type BodyParams, type Figure, type Style } from '@/lib/types';
import { useProjectSettings, useScene, useStore, useStudio } from './store-context';
import { COMMANDS, GESTURES, SELECTION_KEYS, keyLabel, titleOf } from './commands';
import { Field, Hint, Modal, NumberInput, Segmented, Select, Slider, Toggle, type Notify } from './ui';

/* ---------------- Export ---------------- */

/** One thing the dialog exports: its label in its group, its name alone (if longer), and why it cannot be now. */
interface Output { value: ExportOptions['scope']; label: string; name?: string; icon: LucideIcon; title?: string; off?: string }

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


export function ExportDialog({ onClose, notify, editorCamera, initial }: {
  onClose(): void;
  notify: Notify;
  editorCamera(): CameraView | null;
  /** What to export, when it is opened for something (the storyboard's Export: the story). */
  initial?: ExportOptions['scope'];
}) {
  const store = useStore();
  const library = useStudio((s) => s.library);
  const scenes = library.scenes;
  const look = useProjectSettings();
  const scene = useScene();
  const time = useStudio((s) => s.time);
  const animated = !!scene.animation;
  const story = useMemo(() => storyShots(library), [library]);
  const [o, setO] = useState<ExportOptions>(() => ({ ...loadExportOptions(), ...(initial ? { scope: initial } : {}) }));
  // the project's style, unless another is picked for this export.
  const style = o.style ?? look.style;
  // The camera stills are taken through: '' is the one filming at the playhead (a still scene: its first).
  const [picked, setPicked] = useState('');
  const camera = scene.cameras.some((c) => c.id === picked) ? picked : '';
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const preview = useRef<HTMLDivElement>(null);
  // (Its outputs a radio group: one Tab stop, the arrows choose: #20.)
  const outputList = useRef<HTMLDivElement>(null);
  useRoving(outputList, OUTPUT_KEYS);
  const set = (patch: Partial<ExportOptions>) => setO((prev) => ({ ...prev, ...patch }));
  // Animation outputs fall back to the single scene when the open one is not animated; the story's, when there is none.
  const scope: ExportOptions['scope'] = (!animated && (o.scope === 'frames' || o.scope === 'video')) || (o.scope === 'all' && scenes.length < 2)
    || (!story.length && (o.scope === 'board' || o.scope === 'story-video' || o.scope === 'story-pack')) ? 'current' : o.scope;
  const whole = scope === 'board' || scope === 'story-video' || scope === 'story-pack';
  const video = scope === 'video' || scope === 'story-video';
  // (A scene with an in and out, #22: the video films just it, unless asked not to.)
  const ranged = scope === 'video' && !!scene.animation?.range && o.videoRange;
  const pack = scope === 'pack' || scope === 'story-pack';
  const model = scope === 'model';
  // Videos and keyframe packs are framed by the shot cameras at a video size.
  const filmed = video || pack;
  const sceneStory = useMemo(() => sceneShots(scene), [scene]);
  const shots = whole ? story : sceneStory;
  const canRecord = videoSupported();

  const laid = useMemo(() => laidOut({ ...o, scope }, ASPECTS[look.frame]), [o, scope, look.frame]);
  const cells = useMemo(() => exportCells(scenes, scene, laid, time, camera || undefined), [laid, scenes, scene, time, camera]);
  const size = filmed ? videoSize(o.videoSize, frameAspect()) : scope === 'board' ? boardSize(story.length, o.columns, o.labels) : sheetSize(cells.length, laid);
  const { width, height } = size;
  const tooBig = !filmed && !model && (width * height > 120_000_000 || width > 16384 || height > 16384);
  const pass = pack ? 'beauty' : o.pass;

  useEffect(() => () => abort.current?.abort(), []);

  useEffect(() => {
    try {
      // The style picked is for this export only.
      const { style: _once, ...kept } = o;
      void _once;
      localStorage.setItem(EXPORT_KEY, JSON.stringify(kept));
    } catch {
      // Not critical: the options just won't be remembered.
    }
    // Low-resolution preview of the layout (or the first frame of the video).
    const t = setTimeout(() => {
      const scale = Math.min(1, 360 / Math.max(width, height));
      let small: HTMLCanvasElement;
      if (filmed) {
        const first = shots[0];
        const at = first?.span?.start ?? 0;
        const r = sharedRenderer().renderShot(sceneAt(first.scene, at, true), Math.round(width * scale), Math.round(height * scale), Math.max(0.8, o.lineWidth * scale * 1.5), {
          style, pass, camera: cameraAt(first.scene, at, width / height),
        });
        small = document.createElement('canvas');
        small.width = r.width;
        small.height = r.height;
        small.getContext('2d')!.drawImage(r, 0, 0);
      } else if (scope === 'board') {
        const sheet = boardSheet(story, { style, captions: o.labels, columns: o.columns, pass });
        small = document.createElement('canvas');
        small.width = Math.round(sheet.width * scale);
        small.height = Math.round(sheet.height * scale);
        small.getContext('2d')!.drawImage(sheet, 0, 0, small.width, small.height);
      } else {
        small = sharedRenderer().sheet(cells, {
          ...laid,
          style,
          cellWidth: Math.max(24, Math.round(laid.cellWidth * scale)),
          cellHeight: Math.max(24, Math.round(laid.cellHeight * scale)),
          lineWidth: Math.max(0.8, laid.lineWidth * scale * 1.5),
          labels: false,
        });
      }
      small.className = 'preview-canvas';
      preview.current?.replaceChildren(small);
    }, 150);
    return () => clearTimeout(t);
  }, [o, laid, style, scope, filmed, pass, cells, width, height, shots, story]);

  const run = async () => {
    setBusy(true);
    setProgress(0);
    await new Promise((r) => setTimeout(r, 30)); // let the button state paint
    try {
      if (model) {
        const { sceneToGlb } = await import('@/lib/model3d');
        downloadBlob(await sceneToGlb(scene, time), `${safeFilename(scene.name)}.glb`);
        notify(scene.animation ? '3D model saved, animated (.glb)' : '3D model saved (.glb)');
        onClose();
        return;
      }
      const title = whole ? 'Story' : safeFilename(scene.name);
      if (pack) {
        abort.current = new AbortController();
        const blob = await keyframePack(shots, whole ? 'Story' : scene.name, {
          width, height, style, lineWidth: o.lineWidth * (height / 640), greybox: o.greybox,
        }, setProgress, abort.current.signal);
        const name = `${title}_ai_pack.zip`;
        downloadBlob(blob, name);
        notify(`Saved ${name}`);
        onClose();
        return;
      }
      if (video) {
        abort.current = new AbortController();
        const look = { width, height, style, lineWidth: o.lineWidth * (height / 640), pass };
        const { blob, ext } = whole
          ? await recordStory(story, { ...look, captions: o.labels }, setProgress, abort.current.signal)
          : await recordVideo(scene, { ...look, loops: o.videoLoops, ...(ranged ? { range: [scene.animation!.range!.from, scene.animation!.range!.to] as [number, number] } : {}) }, setProgress, abort.current.signal);
        const name = `${title}.${ext}`;
        downloadBlob(blob, name);
        notify(`Saved ${name} (${width} × ${height})`);
        onClose();
        return;
      }
      const canvas = scope === 'board'
        ? boardSheet(story, { style, captions: o.labels, columns: o.columns, pass })
        : sharedRenderer().sheet(cells, { ...laid, style });
      const blob = await canvasToBlob(canvas, o.format, 0.92);
      const ext = o.format === 'png' ? 'png' : 'jpg';
      const base = scope === 'all' ? 'Scenes' : scope === 'board' ? 'Storyboard' : safeFilename(scene.name);
      const name = `${base}${scope === 'turnaround' ? '_turnaround' : scope === 'frames' ? '_frames' : ''}.${ext}`;
      downloadBlob(blob, name);
      notify(`Saved ${name} (${canvas.width} × ${canvas.height})`);
      onClose();
    } catch (err) {
      if ((err as Error).message !== 'Cancelled') notify(`Export failed: ${(err as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const num = (key: 'columns' | 'width' | 'cellWidth' | 'cellHeight', min: number, max: number, label: string) => (
    <NumberInput label={label} value={o[key]} min={min} max={max} digits={0} onChange={(v) => set({ [key]: v })} />
  );

  // What to export: one choice, in groups; one not possible now says why.
  const story0 = !story.length ? 'Nothing in the storyboard' : undefined;
  const still = !animated ? 'Animate the scene first' : undefined;
  const outputs: { group: string; options: Output[] }[] = [
    {
      group: 'Image',
      options: [
        { value: 'current', label: 'This scene', name: 'Image', icon: Square },
        { value: 'turnaround', label: 'Turnaround', icon: RefreshCw, title: 'This scene from evenly spaced angles' },
        { value: 'all', label: 'All scenes', icon: LayoutGrid, title: 'Every scene on one sheet', off: scenes.length < 2 ? 'Only one scene' : undefined },
        { value: 'frames', label: 'Frames', name: 'Frame sheet', icon: Rows3, title: 'Moments of the animation, as a motion study', off: still },
        { value: 'board', label: 'Storyboard', name: 'Storyboard image', icon: LayoutPanelTop, title: 'A panel per shot, in story order', off: story0 },
      ],
    },
    {
      group: 'Video',
      options: [
        { value: 'video', label: 'This scene', name: 'Video', icon: Film, title: 'Filmed by its shot camera', off: still },
        { value: 'story-video', label: 'Storyboard', name: 'Storyboard video', icon: Clapperboard, title: 'Every scene\'s shots in story order', off: story0 },
      ],
    },
    {
      group: 'For AI video',
      options: [
        { value: 'pack', label: 'This scene', name: 'AI video pack', icon: Package, title: 'Per shot: first and last frames, depth, normals, camera and prompt, for AI video tools' },
        { value: 'story-pack', label: 'Storyboard', name: 'Storyboard AI pack', icon: Package, title: 'The storyboard\'s shots, with one cut list', off: story0 },
      ],
    },
    {
      group: '3D',
      options: [{ value: 'model', label: 'This scene (.glb)', name: '3D model', icon: Box, title: scene.animation ? 'For Blender and other 3D tools: figures, props and shot camera, animated' : 'For Blender and other 3D tools, posed as shown' }],
    },
  ];

  return (
    <Modal
      title="Export"
      icon={Download}
      onClose={onClose}
      wide
      footer={
        <>
          <span className={tooBig ? 'error-text' : 'muted'}>
            {model ? '.glb' : `${width} × ${height} px`}{tooBig ? ' — too large for most browsers' : ''}
            {video && (whole ? ` · ${storyLength(story).toFixed(1)} s at 24 fps` : scene.animation && ` · ${(ranged ? scene.animation.range!.to - scene.animation.range!.from : scene.animation.duration * o.videoLoops).toFixed(1)} s at ${scene.animation.fps} fps`)}
          </span>
          {!filmed && !model && scope !== 'current' && <button type="button" className="btn ghost" onClick={() => setO({ ...DEFAULT_EXPORT, scope })} data-tip="4 columns of 600 × 640 cells">Reset layout</button>}
          {busy && filmed && <button type="button" className="btn ghost" onClick={() => abort.current?.abort()}>Cancel</button>}
          <button type="button" className="btn primary" onClick={run} disabled={busy || tooBig || (video && !canRecord)} data-autofocus>
            <Download size={16} aria-hidden />
            {busy ? (filmed ? `${video ? 'Recording' : 'Packing'}… ${Math.round(progress * 100)}%` : 'Rendering…') : 'Download'}
          </button>
        </>
      }
    >
      <div className="export-grid">
        <div className="export-outputs" role="radiogroup" aria-label="Export" ref={outputList} onKeyDown={(e) => rovingKey(e, OUTPUT_KEYS)}>
          {outputs.map((g) => (
            <div key={g.group} className="export-group">
              <h3>{g.group}</h3>
              {g.options.map((op) => (
                <button
                  key={op.value}
                  type="button"
                  role="radio"
                  aria-checked={op.value === scope}
                  aria-label={op.name ?? op.label}
                  className={op.value === scope ? 'on' : ''}
                  disabled={!!op.off}
                  data-tip={op.off ?? op.title}
                  data-tip-side="right"
                  onClick={() => set({ scope: op.value })}
                >
                  <op.icon size={16} strokeWidth={1.75} aria-hidden /><span>{op.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="form">
          {scope === 'turnaround' && (
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
          {scope === 'frames' && (
            <Field label="Frames">
              <Segmented<string>
                label="Frames"
                full
                value={String(o.frames)}
                onChange={(v) => set({ frames: Number(v) })}
                options={['4', '6', '8', '12', '16'].map((v) => ({ value: v, label: v }))}
              />
            </Field>
          )}
          {(scope === 'current' || scope === 'turnaround' || scope === 'frames') && (
            <Field label="Camera">
              <Select<string>
                label="Camera"
                value={camera}
                onChange={setPicked}
                options={[
                  { value: '', label: animated ? 'Filming at the playhead' : scene.cameras[0].name },
                  ...scene.cameras.slice(animated ? 0 : 1).map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
              <button type="button" className="btn subtle" onClick={() => { const v = editorCamera(); if (v) setPicked(addCamera(store, v, false)); }}>
                New camera from the view
              </button>
            </Field>
          )}
          {!pack && !model && (
            <Field label="Pass">
              <Segmented<Pass>
                label="Pass"
                value={o.pass}
                onChange={(p) => set({ pass: p })}
                options={[
                  { value: 'beauty', label: 'Picture' },
                  { value: 'depth', label: 'Depth', title: 'Near is white, far is black (e.g. for ControlNet)' },
                  { value: 'normal', label: 'Normals', title: 'View-space normals' },
                ]}
              />
            </Field>
          )}
          {!model && (
            <Field label="Style">
              <Select<Style | ''>
                label="Style"
                value={o.style ?? ''}
                onChange={(v) => set({ style: v || undefined })}
                options={[{ value: '', label: `The project's (${styleDef(look.style).label})` }, ...STYLE_LIST.map((st) => ({ value: st.id, label: st.label }))]}
              />
            </Field>
          )}
          {!model && (filmed ? (
            <Field label="Size">
              <Select<VideoSize> label="Size" value={o.videoSize} onChange={(v) => set({ videoSize: v })} options={VIDEO_SIZES.map((k) => ({ value: k, label: `${videoSize(k, frameAspect()).label} (${look.frame})` }))} />
            </Field>
          ) : (
            <Field label="Format">
              <Select<ExportOptions['format']> label="Format" value={o.format} onChange={(format) => set({ format })} options={[{ value: 'jpeg', label: 'JPG' }, { value: 'png', label: 'PNG' }]} />
            </Field>
          ))}
          {model ? (
            <div className="export-note">
              <Box size={32} strokeWidth={1.25} aria-hidden />
              <span>{scene.animation ? 'Figures, props and the shot camera, animated' : 'Figures and props, posed as shown'}</span>
              <span className="muted small">A .glb file for Blender and other 3D tools</span>
            </div>
          ) : pack ? (
            animated && <Toggle label="Greybox clips" hint="A clay-shaded video of each shot's motion and camera, as a reference for the model" checked={o.greybox} onChange={(greybox) => set({ greybox })} />
          ) : scope === 'board' ? (
            <>
              <label className="field"><span>Columns</span>{num('columns', 1, 12, 'Columns')}</label>
              <Toggle label="Captions" checked={o.labels} onChange={(labels) => set({ labels })} />
              <Hint>{story.length} panels</Hint>
            </>
          ) : scope === 'story-video' ? (
            <>
              <Toggle label="Subtitles" hint="The captions" checked={o.labels} onChange={(labels) => set({ labels })} />
              <Slider label="Line weight" min={0.5} max={8} step={0.1} value={o.lineWidth} display={`${o.lineWidth.toFixed(1)} px`} onChange={(lineWidth) => set({ lineWidth })} />
              {!canRecord && <Hint>This browser cannot record video</Hint>}
            </>
          ) : video ? (
            <>
              {scene.animation?.range && (
                <Toggle label="Just the in and out" hint={`${scene.animation.range.from.toFixed(2)}–${scene.animation.range.to.toFixed(2)} s, as the timeline plays it`} checked={o.videoRange} onChange={(videoRange) => set({ videoRange })} />
              )}
              {!ranged && (
                <Field label="Plays">
                  <Segmented<string>
                    label="Play the animation"
                    value={String(o.videoLoops)}
                    onChange={(v) => set({ videoLoops: Number(v) })}
                    options={[{ value: '1', label: 'Once' }, { value: '2', label: 'Twice' }, { value: '3', label: '3 times' }]}
                  />
                </Field>
              )}
              <Slider label="Line weight" min={0.5} max={8} step={0.1} value={o.lineWidth} display={`${o.lineWidth.toFixed(1)} px`} onChange={(lineWidth) => set({ lineWidth })} />
              {!canRecord && <Hint>This browser cannot record video</Hint>}
            </>
          ) : (
            <>
              {/* One scene is one cell: its size is the picture's. */}
              {scope !== 'current' && <label className="field"><span>Columns</span>{num('columns', 1, 12, 'Columns')}</label>}
              <label className="field"><span>{scope === 'current' ? 'Width' : 'Cell width'}</span>{scope === 'current' ? num('width', 100, 8000, 'Width') : num('cellWidth', 100, 4000, 'Cell width')}</label>
              {/* (A still through a camera: as the shot shows it, in the project's frame; another shape is another frame.) */}
              {scope === 'current'
                ? <Field label="Height" info="The project's frame sets the shape (the frame menu in the top bar)"><span className="muted">{height} px · {look.frame}</span></Field>
                : <label className="field"><span>Cell height</span>{num('cellHeight', 100, 4000, 'Cell height')}</label>}
              <Slider label="Line weight" min={0.5} max={8} step={0.1} value={o.lineWidth} display={`${o.lineWidth.toFixed(1)} px`} onChange={(lineWidth) => set({ lineWidth })} />
              {/* (Around the figures, in the cells framed to fit them: a camera frames this scene's.) */}
              {scope !== 'current' && <Slider label="Padding" min={0} max={0.4} step={0.01} value={o.margin} display={`${Math.round(o.margin * 100)}%`} onChange={(margin) => set({ margin })} />}
              <div className="stack">
                <Toggle label="Captions" checked={o.labels} onChange={(labels) => set({ labels })} />
                {scope === 'all' && (
                  <Toggle
                    label="Same scale"
                    hint="Keep figures comparable in size instead of filling each cell"
                    checked={o.sameScale}
                    onChange={(sameScale) => set({ sameScale })}
                  />
                )}
                <Toggle
                  label="Transparent"
                  hint="No background (PNG)"
                  checked={o.transparent && o.format === 'png'}
                  onChange={(transparent) => set({ transparent, format: transparent ? 'png' : o.format })}
                />
              </div>
            </>
          )}
          {styleDef(style).lit && <Hint>Lit by each scene&apos;s own light</Hint>}
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
    return newFigure({ name: people.length > 1 ? `Person ${i + 1}` : 'Figure', body: { ...body }, bones: res.bones, position: [(hipX - 0.5) * 3, 0, 0] });
  });
  m.dispose();
  return { figures, skipped: [...skipped] };
}

export function PhotoDialog({ onClose, notify }: { onClose(): void; notify: Notify }) {
  const store = useStore();
  const activeFigure = useStudio((s) => s.activeFigure);
  const selection = useStudio((s) => s.selection);
  const scene = useScene();
  // The pose can go on the selected figure only if one that can be posed is selected.
  const posable = (selection?.kind === 'figure' || selection?.kind === 'joint') && !scene.figures.find((f) => f.id === selection.figure)?.proxy ? selection.figure : null;
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [people, setPeople] = useState<DetectedPerson[]>([]);
  const [chosen, setTarget] = useState<'new' | 'current'>('new');
  const target = posable ? chosen : 'new';
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
    applyPhotoPose(store, figures, target === 'current' ? posable! : undefined);
    if (skipped.length) notify(`Not visible in the photo: ${skipped.join(', ')}`);
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
            <span className="muted small">or drop it here · it stays on this computer</span>
          </label>
          {posable ? (
            <Field label="Pose goes on">
              <Segmented<'new' | 'current'>
                label="Put the pose on"
                full
                value={target}
                onChange={setTarget}
                options={[{ value: 'new', label: 'A new scene' }, { value: 'current', label: 'The selected figure' }]}
              />
            </Field>
          ) : (
            // (Nothing to choose: one place it can go.)
            <Hint>The pose goes on a new scene (to pose a figure here with it, select the figure first)</Hint>
          )}
        </div>
        <div className="preview">
          {status === 'loading' && <div className="spinner" aria-label="Working" />}
          <canvas ref={canvas} className={url ? '' : 'hidden'} />
          {!url && <Hint>The detected skeleton shows here</Hint>}
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- Help ---------------- */

/** The keys (from the commands) and the gestures. */
export function HelpDialog({ onClose }: { onClose(): void }) {
  const store = useStore();
  const c = { store };
  return (
    <Modal title="Keyboard shortcuts" icon={Keyboard} onClose={onClose} wide>
      <div className="shortcuts">
        {/* One row per key: commands on different things share some (Del deletes whatever is selected). */}
        {/* (The keys for what is selected have a table of their own, below.) */}
        {COMMANDS.filter((cmd, i) => cmd.keys && !/^(step|whole|select)\./.test(cmd.id) && COMMANDS.findIndex((x) => x.keys?.[0] === cmd.keys![0]) === i).map((cmd) => (
          <div key={cmd.id} className="shortcut"><span>{cmd.help ?? titleOf(cmd, c)}</span><kbd>{cmd.keys!.map(keyLabel).join(' · ')}</kbd></div>
        ))}
      </div>
      <h3 className="shortcuts-head">For what is selected</h3>
      <div className="shortcuts">
        {SELECTION_KEYS.map(([what, keys]) => (
          <div key={what} className="shortcut"><span>{what}</span><kbd>{keys}</kbd></div>
        ))}
      </div>
      <h3 className="shortcuts-head">Gestures</h3>
      <div className="shortcuts">
        {GESTURES.map(([what, how]) => (
          <div key={what} className="shortcut"><span>{what}</span><span>{how}</span></div>
        ))}
      </div>
    </Modal>
  );
}

const OUTPUT_KEYS: Roving = { items: '[role="radio"]', orientation: 'vertical', chosen: '[aria-checked="true"]', activate: (el) => el.click() };
