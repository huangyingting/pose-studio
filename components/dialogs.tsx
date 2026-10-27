'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Download, Film, ImagePlus, Images, Keyboard, LayoutGrid, Package, RefreshCw, Rows3, ScanFace, Square } from 'lucide-react';
import { keyframePack } from '@/lib/pack';
import { sceneAt } from '@/lib/evaluate';
import { addFigures, appendScenes, setSceneView } from '@/lib/actions';
import { newFigure, newScene } from '@/lib/doc';
import { allPoses, poseScene } from '@/lib/poses';
import { Ink } from '@/lib/ink';
import { Mannequin } from '@/lib/mannequin';
import { detectPeople, loadImage, type DetectedPerson } from '@/lib/photo';
import {
  canvasToBlob, DEFAULT_EXPORT, downloadBlob, exportCells, parseExportOptions, safeFilename, sheetSize, VIDEO_SIZES, type ExportOptions, type Pass, type VideoSize,
} from '@/lib/render';
import { framingFor, shotAt } from '@/lib/shot';
import { recordVideo, videoSupported } from '@/lib/video';
import { fromMediaPipe, retarget } from '@/lib/retarget';
import { STYLE_LIST, styleDef } from '@/lib/styles';
import { sharedRenderer } from '@/lib/thumbnails';
import type { BodyParams, Figure, Style, View } from '@/lib/types';
import { useScene, useStore, useStudio } from './store-context';
import { Field, Modal, Segmented, Select, Slider, Toggle, type Notify, type SegmentOption } from './ui';

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


export function ExportDialog({ onClose, notify, currentView }: { onClose(): void; notify: Notify; currentView(): View | null }) {
  const store = useStore();
  const library = useStudio((s) => s.library);
  const scenes = library.scenes;
  const faces = useStudio((s) => s.settings.faces);
  const scene = useScene();
  const time = useStudio((s) => s.time);
  const animated = !!scene.animation;
  const [o, setO] = useState<ExportOptions>(loadExportOptions);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const preview = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<ExportOptions>) => setO((prev) => ({ ...prev, ...patch }));
  // Animation outputs fall back to the single pose when the open pose is not animated.
  const scope: ExportOptions['scope'] = (!animated && (o.scope === 'frames' || o.scope === 'video')) || (o.scope === 'all' && scenes.length < 2) ? 'current' : o.scope;
  const video = scope === 'video';
  const pack = scope === 'pack';
  // Video and keyframe packs are framed by the shot camera at a video size.
  const filmed = video || pack;
  const canRecord = videoSupported();

  // The pose library sheet shows each pose on its own figure (the reference sheet layout).
  const poseCount = allPoses(library).length;
  const cells = useMemo(
    () => exportCells(scope === 'poses' ? allPoses(library).map((p) => poseScene(p)) : scenes, scene, { ...o, scope }),
    [o, scope, scenes, scene, library],
  );
  const size = filmed ? VIDEO_SIZES[o.videoSize] : sheetSize(cells.length, o);
  const { width, height } = size;
  const tooBig = !filmed && (width * height > 120_000_000 || width > 16384 || height > 16384);
  const pass = pack ? 'beauty' : o.pass;

  useEffect(() => () => abort.current?.abort(), []);

  useEffect(() => {
    try {
      localStorage.setItem(EXPORT_KEY, JSON.stringify(o));
    } catch {
      // Not critical: the options just won't be remembered.
    }
    // Low-resolution preview of the layout (or the first frame of the video).
    const t = setTimeout(() => {
      const scale = Math.min(1, 360 / Math.max(width, height));
      let small: HTMLCanvasElement;
      if (filmed) {
        const r = sharedRenderer().renderShot(sceneAt(scene, 0), Math.round(width * scale), Math.round(height * scale), Math.max(0.8, o.lineWidth * scale * 1.5), {
          style: o.style, faces, pass, shot: shotAt(scene, 0), framing: framingFor(scene), follow: !!scene.animation?.camera?.follow, shake: 0,
        });
        small = document.createElement('canvas');
        small.width = r.width;
        small.height = r.height;
        small.getContext('2d')!.drawImage(r, 0, 0);
      } else {
        small = sharedRenderer().sheet(cells, {
          ...o,
          scope,
          cellWidth: Math.max(24, Math.round(o.cellWidth * scale)),
          cellHeight: Math.max(24, Math.round(o.cellHeight * scale)),
          lineWidth: Math.max(0.8, o.lineWidth * scale * 1.5),
          labels: false,
        }, faces);
      }
      small.className = 'preview-canvas';
      preview.current?.replaceChildren(small);
    }, 150);
    return () => clearTimeout(t);
  }, [o, scope, filmed, pass, cells, width, height, faces, scene]);

  const run = async () => {
    setBusy(true);
    setProgress(0);
    await new Promise((r) => setTimeout(r, 30)); // let the button state paint
    try {
      if (pack) {
        abort.current = new AbortController();
        const blob = await keyframePack(scene, {
          width, height, style: o.style, lineWidth: o.lineWidth * (height / 640), faces, greybox: o.greybox,
        }, setProgress, abort.current.signal);
        const name = `${safeFilename(scene.name)}_keyframes.zip`;
        downloadBlob(blob, name);
        notify(`Saved ${name}`);
        onClose();
        return;
      }
      if (video) {
        abort.current = new AbortController();
        const { blob, ext } = await recordVideo(scene, {
          width, height, style: o.style, lineWidth: o.lineWidth * (height / 640), loops: o.videoLoops, faces, pass,
        }, setProgress, abort.current.signal);
        const name = `${safeFilename(scene.name)}.${ext}`;
        downloadBlob(blob, name);
        notify(`Saved ${name} (${width} × ${height})`);
        onClose();
        return;
      }
      const canvas = sharedRenderer().sheet(cells, { ...o, scope }, faces);
      const blob = await canvasToBlob(canvas, o.format, 0.92);
      const ext = o.format === 'png' ? 'png' : 'jpg';
      const base = scope === 'poses' ? 'Pose' : scope === 'all' ? 'Scenes' : safeFilename(scene.name);
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

  const images: SegmentOption<ExportOptions['scope']>[] = [
    { value: 'current', label: 'This scene', icon: Square },
    { value: 'turnaround', label: 'Turnaround', icon: RefreshCw, title: 'This scene from evenly spaced angles' },
    ...(scenes.length > 1 ? [{ value: 'all' as const, label: `${scenes.length} scenes`, icon: LayoutGrid, title: 'Every scene of the project' }] : []),
    { value: 'poses', label: `Poses ${poseCount}`, icon: Images, title: 'The pose library as a reference sheet' },
  ];
  const forVideo: SegmentOption<ExportOptions['scope']>[] = [
    ...(animated ? [
      { value: 'frames' as const, label: 'Frame sheet', icon: Rows3, title: 'Evenly spaced moments of the animation, as a motion study' },
      { value: 'video' as const, label: 'Video', icon: Film, title: 'The animation filmed by its shot camera' },
    ] : []),
    { value: 'pack', label: 'Keyframe pack', icon: Package, title: 'First/last frames, depth, normals, camera, prompt (and greybox clips) per shot, for AI video models' },
  ];

  return (
    <Modal
      title={pack ? 'Export keyframe pack' : video ? 'Export video' : 'Export image'}
      icon={pack ? Package : video ? Film : Download}
      onClose={onClose}
      wide
      footer={
        <>
          <span className={tooBig ? 'error-text' : 'muted'}>
            {width} × {height} px{tooBig ? ' — too large for most browsers' : ''}
            {video && scene.animation && ` · ${(scene.animation.duration * o.videoLoops).toFixed(1)} s at ${scene.animation.fps} fps`}
          </span>
          <button
            type="button"
            className="btn ghost"
            data-tip={scene.animation ? 'The open scene for Blender and other 3D tools: its figures, props and shot camera, animated' : 'The open scene, posed as shown, for Blender and other 3D tools'}
            onClick={async () => {
              try {
                const { sceneToGlb } = await import('@/lib/model3d');
                downloadBlob(await sceneToGlb(scene, time), `${safeFilename(scene.name)}.glb`);
                notify(scene.animation ? '3D model saved, animated (.glb)' : '3D model saved (.glb)');
              } catch (err) {
                notify(`Could not export the 3D model: ${(err as Error).message}`, 'error');
              }
            }}
          >
            <Box size={15} aria-hidden /> 3D model (.glb)
          </button>
          {!filmed && <button type="button" className="btn ghost" onClick={() => setO({ ...DEFAULT_EXPORT })} data-tip="4 columns of 600 × 640 cells, as the original Pose.jpg sheet">Default layout</button>}
          {busy && filmed && <button type="button" className="btn ghost" onClick={() => abort.current?.abort()}>Cancel</button>}
          <button type="button" className="btn primary" onClick={run} disabled={busy || tooBig || (video && !canRecord)} data-autofocus>
            {video ? <Film size={15} aria-hidden /> : pack ? <Package size={15} aria-hidden /> : <Download size={15} aria-hidden />}
            {busy
              ? (filmed ? `${video ? 'Recording' : 'Packing'}… ${Math.round(progress * 100)}%` : 'Rendering…')
              : video ? 'Record video' : pack ? 'Download pack' : 'Download'}
          </button>
        </>
      }
    >
      <div className="export-grid">
        <div className="form">
          <Field label="Image">
            <Segmented<ExportOptions['scope']> label="Image" full value={scope} onChange={(sc) => set({ scope: sc })} options={images} />
          </Field>
          <Field label="For video">
            <Segmented<ExportOptions['scope']> label="For video" full value={scope} onChange={(sc) => set({ scope: sc })} options={forVideo} />
          </Field>
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
            // Stills of this scene are taken from its own camera (saved with it), not the editor's.
            <Field label="Camera">
              <Slider label="Turn" min={-180} max={180} value={scene.view.yaw} display={`${Math.round(scene.view.yaw)}°`} typeable onChange={(yaw) => setSceneView(store, { ...scene.view, yaw })} />
              <Slider label="Height" min={-60} max={89} value={scene.view.pitch} display={`${Math.round(scene.view.pitch)}°`} typeable onChange={(pitch) => setSceneView(store, { ...scene.view, pitch })} />
              <Slider label="Lens (field of view)" min={8} max={70} value={scene.view.fov} display={`${Math.round(scene.view.fov)}°`} typeable onChange={(fov) => setSceneView(store, { ...scene.view, fov })} />
              <button type="button" className="btn subtle" onClick={() => { const v = currentView(); if (v) setSceneView(store, { ...scene.view, yaw: v.yaw, pitch: v.pitch }); }}>
                Use the editor&apos;s view
              </button>
            </Field>
          )}
          {!pack && (
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
          <div className="row">
            <label>Style
              <Select<Style> label="Style" value={o.style} onChange={(style) => set({ style })} options={STYLE_LIST.map((st) => ({ value: st.id, label: st.label }))} />
            </label>
            {filmed ? (
              <label>Size
                <Select<VideoSize> label="Size" value={o.videoSize} onChange={(videoSize) => set({ videoSize })} options={(Object.keys(VIDEO_SIZES) as VideoSize[]).map((k) => ({ value: k, label: VIDEO_SIZES[k].label }))} />
              </label>
            ) : (
              <label>Format
                <Select<ExportOptions['format']> label="Format" value={o.format} onChange={(format) => set({ format })} options={[{ value: 'jpeg', label: 'JPG' }, { value: 'png', label: 'PNG' }]} />
              </label>
            )}
          </div>
          {pack ? (
            <>
              {animated && <Toggle label="Greybox clip of each shot" hint="A clay-shaded video of the motion and camera, as a reference for the model" checked={o.greybox} onChange={(greybox) => set({ greybox })} />}
              <p className="muted small">
                Per shot: first and last frame with depth and normals, the camera for every frame and a prompt
                {animated ? ', plus the cut list (OTIO)' : ''}. Give them to an AI video model so it follows your blocking.
              </p>
            </>
          ) : video ? (
            <>
              <Field label="Play the animation">
                <Segmented<string>
                  label="Play the animation"
                  value={String(o.videoLoops)}
                  onChange={(v) => set({ videoLoops: Number(v) })}
                  options={[{ value: '1', label: 'Once' }, { value: '2', label: 'Twice' }, { value: '3', label: '3 times' }]}
                />
              </Field>
              <Slider label="Line weight" min={0.5} max={8} step={0.1} value={o.lineWidth} display={`${o.lineWidth.toFixed(1)} px`} onChange={(lineWidth) => set({ lineWidth })} />
              <p className="muted small">
                Filmed through the shot camera: set camera keys or pick a camera move on the timeline.
                {!canRecord && ' This browser cannot record video.'}
              </p>
            </>
          ) : (
            <>
              <div className="row">
                {/* One scene is one cell: its size is the picture's. */}
                {scope !== 'current' && <label>Columns {num('columns', 1, 12)}</label>}
                <label>{scope === 'current' ? 'Width' : 'Cell width'} {num('cellWidth', 100, 4000)}</label>
                <label>{scope === 'current' ? 'Height' : 'Cell height'} {num('cellHeight', 100, 4000)}</label>
              </div>
              <Slider label="Line weight" min={0.5} max={8} step={0.1} value={o.lineWidth} display={`${o.lineWidth.toFixed(1)} px`} onChange={(lineWidth) => set({ lineWidth })} />
              <Slider label="Padding" min={0} max={0.4} step={0.01} value={o.margin} display={`${Math.round(o.margin * 100)}%`} onChange={(margin) => set({ margin })} />
              <div className="stack">
                <Toggle label="Captions under each cell" checked={o.labels} onChange={(labels) => set({ labels })} />
                {(scope === 'all' || scope === 'poses') && (
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
            </>
          )}
          {styleDef(o.style).lit && <p className="muted small">Each scene is lit by its own light (select the scene in the inspector).</p>}
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
        figures: s.figures.map((f) => (f.id === activeFigure ? { ...f, bones: first.bones } : f)),
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
              options={[{ value: 'new', label: 'A new scene' }, { value: 'current', label: 'The selected figure' }]}
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
  ['Menu for a figure, prop, shot or scene', 'Right click'],
  ['Pose a limb · move a hand or foot', 'Drag it'],
  ['Twist a part · turn a figure or prop', 'Shift drag'],
  ['Move a figure or prop on the floor', 'Drag its torso / it'],
  ['Turn a figure or prop', 'Drag its floor ring (Shift: 15°)'],
  ['Walk · run · jump the selected figure there', 'Right click the floor'],
  ['How a figure gets to its next key (walk, run, jump…)', 'Right click between its keys'],
  ['Orbit · pan · zoom', 'Drag empty space or Alt drag · Right drag · Wheel'],
  ['Tools: pose · move (with height) · scale props', 'E  W  R'],
  ['Camera views', '1 – 6'],
  ['Frame all', 'F'],
  ['Mirror pose', 'M'],
  ['Drag handles', 'H'],
  ['Show / hide the inspector', 'I'],
  ['Next render style', 'L'],
  ['Storyboard', 'B'],
  ['Gesture practice', 'P'],
  ['Play / pause animation', 'Space'],
  ['Step a frame', ',  .'],
  ['Key the selected figure · cut shot', 'K · C'],
  ['Zoom · scroll the timeline', 'Ctrl wheel · Shift wheel'],
  ['Move a key and the keys after it', 'Shift drag the key'],
  ['Edit an action (a walk, a motion) in the inspector', 'Click its block'],
  ['Move · retime · blend an action', 'Drag its block · its right edge · its ramp'],
  ['Where an action ends · a formation', 'Drag its numbered mark on the floor'],
  ['Previous / next scene', '[  ]'],
  ['Undo / redo', 'Ctrl Z  ·  Ctrl Shift Z'],
  ['Copy / paste pose', 'Ctrl C  ·  Ctrl V'],
  ['Duplicate the selection', 'Ctrl D'],
  ['Rename the selection', 'F2 · Double-click'],
  ['Export image', 'Ctrl E'],
  ['Save library', 'Ctrl S'],
  ['Reorder scenes (scene picker)', 'Alt + arrows'],
  ['Delete the selection', 'Del'],
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
