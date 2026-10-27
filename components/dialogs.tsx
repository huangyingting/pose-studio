'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Download, Film, ImagePlus, Images, Keyboard, LayoutGrid, Package, RefreshCw, Rows3, ScanFace, Square } from 'lucide-react';
import { keyframePack } from '@/lib/pack';
import { sceneAt } from '@/lib/evaluate';
import { addCamera, applyPhotoPose, setReferenceImage } from '@/lib/actions';
import { newFigure } from '@/lib/doc';
import { allPoses, poseScene } from '@/lib/poses';
import { Ink } from '@/lib/ink';
import { Mannequin } from '@/lib/mannequin';
import { detectPeople, loadImage, type DetectedPerson } from '@/lib/photo';
import {
  canvasToBlob, DEFAULT_EXPORT, downloadBlob, exportCells, parseExportOptions, safeFilename, sheetSize, VIDEO_SIZES, videoSize, type ExportOptions, type Pass, type VideoSize,
} from '@/lib/render';
import { cameraAt, frameAspect, type CameraView } from '@/lib/cameras';
import { recordVideo, videoSupported } from '@/lib/video';
import { fromMediaPipe, retarget } from '@/lib/retarget';
import { STYLE_LIST, styleDef } from '@/lib/styles';
import { sharedRenderer } from '@/lib/thumbnails';
import type { BodyParams, Figure, Style } from '@/lib/types';
import { useScene, useStore, useStudio } from './store-context';
import { SHORTCUTS } from './shortcuts';
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


export function ExportDialog({ onClose, notify, editorCamera }: { onClose(): void; notify: Notify; editorCamera(): CameraView | null }) {
  const store = useStore();
  const library = useStudio((s) => s.library);
  const scenes = library.scenes;
  const faces = useStudio((s) => s.settings.faces);
  const scene = useScene();
  const time = useStudio((s) => s.time);
  const animated = !!scene.animation;
  const [o, setO] = useState<ExportOptions>(loadExportOptions);
  // The camera stills are taken through: '' is the one filming at the playhead (a still scene: its first).
  const [picked, setPicked] = useState('');
  const camera = scene.cameras.some((c) => c.id === picked) ? picked : '';
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const preview = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<ExportOptions>) => setO((prev) => ({ ...prev, ...patch }));
  // Animation outputs fall back to the single pose when the open pose is not animated.
  const scope: ExportOptions['scope'] = (!animated && (o.scope === 'frames' || o.scope === 'video')) || (o.scope === 'all' && scenes.length < 2) ? 'current' : o.scope;
  const video = scope === 'video';
  const pack = scope === 'pack';
  const model = scope === 'model';
  // Video and keyframe packs are framed by the shot camera at a video size.
  const filmed = video || pack;
  const canRecord = videoSupported();

  // The pose library sheet shows each pose on its own figure (the reference sheet layout).
  const poseCount = allPoses(library).length;
  const cells = useMemo(
    () => exportCells(scope === 'poses' ? allPoses(library).map((p) => poseScene(p)) : scenes, scene, { ...o, scope }, time, camera || undefined),
    [o, scope, scenes, scene, library, time, camera],
  );
  const size = filmed ? videoSize(o.videoSize, frameAspect(scene)) : sheetSize(cells.length, o);
  const { width, height } = size;
  const tooBig = !filmed && !model && (width * height > 120_000_000 || width > 16384 || height > 16384);
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
          style: o.style, faces, pass, camera: cameraAt(scene, 0, width / height),
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
      if (model) {
        const { sceneToGlb } = await import('@/lib/model3d');
        downloadBlob(await sceneToGlb(scene, time), `${safeFilename(scene.name)}.glb`);
        notify(scene.animation ? '3D model saved, animated (.glb)' : '3D model saved (.glb)');
        onClose();
        return;
      }
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

  // What to export: one choice, grouped.
  const outputs: { group: string; options: SegmentOption<ExportOptions['scope']>[] }[] = [
    {
      group: 'Stills',
      options: [
        { value: 'current', label: 'This scene', icon: Square },
        { value: 'turnaround', label: 'Turnaround', icon: RefreshCw, title: 'This scene from evenly spaced angles' },
        ...(scenes.length > 1 ? [{ value: 'all' as const, label: `${scenes.length} scenes`, icon: LayoutGrid, title: 'Every scene of the project' }] : []),
        { value: 'poses', label: `Poses ${poseCount}`, icon: Images, title: 'The pose library as a reference sheet' },
        ...(animated ? [{ value: 'frames' as const, label: 'Frame sheet', icon: Rows3, title: 'Evenly spaced moments of the animation, as a motion study' }] : []),
      ],
    },
    {
      group: 'Film',
      options: [
        ...(animated ? [{ value: 'video' as const, label: 'Video', icon: Film, title: 'The animation filmed by its shot camera' }] : []),
        { value: 'pack', label: 'Keyframe pack', icon: Package, title: 'First/last frames, depth, normals, camera, prompt (and greybox clips) per shot, for AI video models' },
      ],
    },
    {
      group: '3D',
      options: [{ value: 'model', label: '3D model (.glb)', icon: Box, title: scene.animation ? 'The open scene for Blender and other 3D tools: its figures, props and shot camera, animated' : 'The open scene, posed as shown, for Blender and other 3D tools' }],
    },
  ];

  return (
    <Modal
      title={model ? 'Export 3D model' : pack ? 'Export keyframe pack' : video ? 'Export video' : 'Export image'}
      icon={model ? Box : pack ? Package : video ? Film : Download}
      onClose={onClose}
      wide
      footer={
        <>
          <span className={tooBig ? 'error-text' : 'muted'}>
            {model ? (scene.animation ? 'Animated: figures, props and the shot camera' : 'Posed as shown') : `${width} × ${height} px`}{tooBig ? ' — too large for most browsers' : ''}
            {video && scene.animation && ` · ${(scene.animation.duration * o.videoLoops).toFixed(1)} s at ${scene.animation.fps} fps`}
          </span>
          {!filmed && !model && <button type="button" className="btn ghost" onClick={() => setO({ ...DEFAULT_EXPORT })} data-tip="4 columns of 600 × 640 cells, as the original Pose.jpg sheet">Default layout</button>}
          {busy && filmed && <button type="button" className="btn ghost" onClick={() => abort.current?.abort()}>Cancel</button>}
          <button type="button" className="btn primary" onClick={run} disabled={busy || tooBig || (video && !canRecord)} data-autofocus>
            {video ? <Film size={15} aria-hidden /> : pack ? <Package size={15} aria-hidden /> : model ? <Box size={15} aria-hidden /> : <Download size={15} aria-hidden />}
            {busy
              ? (filmed ? `${video ? 'Recording' : 'Packing'}… ${Math.round(progress * 100)}%` : 'Rendering…')
              : video ? 'Record video' : pack ? 'Download pack' : 'Download'}
          </button>
        </>
      }
    >
      <div className="export-grid">
        <div className="form">
          <div className="export-outputs" role="radiogroup" aria-label="Export">
            {outputs.map((g) => (
              <div key={g.group} className="field">
                <span>{g.group}</span>
                <div className="segmented full">
                  {g.options.map((op) => (
                    <button key={op.value} type="button" role="radio" aria-checked={op.value === scope} className={op.value === scope ? 'on' : ''} title={op.title} onClick={() => set({ scope: op.value })}>
                      {op.icon && <op.icon size={15} strokeWidth={1.75} aria-hidden />}<span>{op.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
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
                New camera from the editor view
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
          {!model && <div className="row">
            <label>Style
              <Select<Style> label="Style" value={o.style} onChange={(style) => set({ style })} options={STYLE_LIST.map((st) => ({ value: st.id, label: st.label }))} />
            </label>
            {filmed ? (
              <label>Size
                <Select<VideoSize> label="Size" value={o.videoSize} onChange={(v) => set({ videoSize: v })} options={VIDEO_SIZES.map((k) => ({ value: k, label: `${videoSize(k, frameAspect(scene)).label} (${scene.animation?.frame ?? '16:9'})` }))} />
              </label>
            ) : (
              <label>Format
                <Select<ExportOptions['format']> label="Format" value={o.format} onChange={(format) => set({ format })} options={[{ value: 'jpeg', label: 'JPG' }, { value: 'png', label: 'PNG' }]} />
              </label>
            )}
          </div>}
          {model ? (
            <p className="muted small">
              The open scene as a binary glTF for Blender, game engines and other 3D tools{animated ? ': an animation per person, one for the props and one for the shot camera' : ', posed as shown'}.
            </p>
          ) : pack ? (
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
                Filmed through the shots&apos; cameras: frame a shot or pick a camera move for it.
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

export function PhotoDialog({ onClose, notify }: { onClose(): void; notify: Notify }) {
  const store = useStore();
  const activeFigure = useStudio((s) => s.activeFigure);
  const selection = useStudio((s) => s.selection);
  const scene = useScene();
  // The pose can go on the selected figure only if one that can be posed is selected.
  const posable = (selection?.kind === 'figure' || selection?.kind === 'joint') && !scene.figures.find((f) => f.id === selection.figure)?.proxy ? selection.figure : null;
  const [url, setUrl] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [people, setPeople] = useState<DetectedPerson[]>([]);
  const [chosen, setTarget] = useState<'new' | 'current'>('new');
  const target = posable ? chosen : 'new';
  const [asReference, setAsReference] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const body = useMemo(() => scene.figures.find((f) => f.id === activeFigure)?.body ?? newFigure().body, [scene, activeFigure]);

  const pick = async (file: File) => {
    const src = URL.createObjectURL(file);
    setUrl(src);
    setPhotoFile(file);
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
    // Over the scene posed (the new one, or this one), saved with it.
    if (asReference && photoFile) void setReferenceImage(store, photoFile);
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
              options={[{ value: 'new', label: 'A new scene' }, ...(posable ? [{ value: 'current' as const, label: 'The selected figure' }] : [])]}
            />
          </Field>
          <Toggle label="Keep the photo as the scene's reference image" checked={asReference} onChange={setAsReference} />
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

export function HelpDialog({ onClose }: { onClose(): void }) {
  return (
    <Modal title="Keyboard shortcuts" icon={Keyboard} onClose={onClose} wide>
      <div className="shortcuts">
        {SHORTCUTS.map(([what, keys]) => (
          <div key={what} className="shortcut"><span>{what}</span><kbd>{keys}</kbd></div>
        ))}
      </div>
      <p className="muted small" style={{ marginTop: 14 }}>
        Click a slider&apos;s value to type an exact number. Scenes are saved in this browser automatically; use <b>Save project</b> in
        the main menu to keep a file, and <b>Copy share link</b> in a scene&apos;s menu to send one scene.
      </p>
    </Modal>
  );
}
