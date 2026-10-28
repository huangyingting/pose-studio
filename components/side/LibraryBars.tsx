'use client';

import { useRef, useState, type ReactNode } from 'react';
import { BookmarkPlus, Clapperboard, Layers, Upload } from 'lucide-react';
import { addModel, saveMotion, savePose, saveShoot, setFigureModel } from '@/lib/actions';
import { COVERAGES } from '@/lib/coverage';
import { MissingBones, importModel, type BoneMap } from '@/lib/model';
import { characterThumb } from '@/lib/previews';
import { shotSpans, spanAt } from '@/lib/shots';
import { templatesOf } from '@/lib/templates';
import type { ShootPreset } from '@/lib/types';
import { useScene, useStore, useStudio } from '../store-context';
import { saveAsTemplate } from '../commands';
import BoneMapDialog from '../BoneMapDialog';
import { Field, Hint, Modal, NumberField, Select } from '../ui';
import type { LibraryUi } from './libraryItems';

/*
 * What a Library category shows above its items: what they apply to (one line), and what adds to
 * it (saving the pose, importing a motion or a character, saving the scene as a template).
 */

export type BarProps = LibraryUi;

/** Who the library applies to, or what to select first. */
function Target({ children }: { children: ReactNode }) {
  return <p className="library-target">{children}</p>;
}

function usePosable() {
  const scene = useScene();
  const id = useStudio((s) => s.activeFigure);
  // (A prop, a camera, the light or several things selected: no figure is the target.)
  const other = useStudio((s) => s.selection?.kind === 'prop' || s.selection?.kind === 'camera' || s.selection?.kind === 'light' || s.selection?.kind === 'many');
  const f = other ? null : scene.figures.find((x) => x.id === id) ?? null;
  return { figure: f && !f.proxy ? f : null, proxy: !!f?.proxy };
}

/** Read a file (a motion, a character), mapping its bones by hand when they cannot all be named. */
function useImport(read: (file: File, map?: BoneMap) => Promise<void>, notify: (text: string) => void) {
  const [reading, setReading] = useState(false);
  const [mapping, setMapping] = useState<{ file: File; err: MissingBones } | null>(null);
  const run = async (file: File, map?: BoneMap) => {
    setReading(true);
    try {
      await read(file, map);
    } catch (e) {
      if (e instanceof MissingBones && !map) setMapping({ file, err: e });
      else notify(`Could not import ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setReading(false);
    }
  };
  const dialog = mapping && (
    <BoneMapDialog file={mapping.file.name} names={mapping.err.names} found={mapping.err.found} onClose={() => setMapping(null)} onDone={(map) => { setMapping(null); void run(mapping.file, map); }} />
  );
  return { reading, run, dialog };
}

function ImportButton({ label, accept, tip, fileLabel, reading, onFile }: { label: string; accept: string; tip: string; fileLabel: string; reading: boolean; onFile(f: File): void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="btn subtle library-import" disabled={reading} onClick={() => ref.current?.click()} data-tip={tip}>
        <Upload size={14} aria-hidden /> {reading ? 'Importing…' : label}
      </button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        hidden
        aria-label={fileLabel}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </>
  );
}

export function PosesBar({ notifyUndo }: BarProps) {
  const store = useStore();
  const { figure, proxy } = usePosable();
  return (
    <>
      <Target>{figure ? <>On <strong>{figure.name}</strong></> : proxy ? 'Stand-ins take postures: select a figure' : 'Select a figure to pose'}</Target>
      <div className="library-row">
        <button
          type="button"
          className="btn subtle library-import"
          disabled={!figure}
          onClick={() => {
            if (!figure) return;
            const saved = savePose(store, figure.id, `${store.scene.name} · ${figure.name}`);
            if (saved) notifyUndo(`Saved “${saved.name}” to the library`);
          }}
        >
          <BookmarkPlus size={14} aria-hidden /> {figure ? `Save ${figure.name}'s pose` : 'Save the selected figure’s pose'}
        </button>
      </div>
    </>
  );
}

export function MotionsBar({ notify, notifyUndo }: BarProps) {
  const store = useStore();
  const { figure } = usePosable();
  const imp = useImport(async (file, map) => {
    // The loaders are only fetched when a motion is imported.
    const { importMotion } = await import('@/lib/importmotion');
    const motion = await importMotion(file.name, await file.arrayBuffer(), map);
    saveMotion(store, motion);
    notifyUndo(`Imported “${motion.name}” (${motion.duration.toFixed(1)} s) to My motions`);
  }, notify);
  return (
    <>
      <Target>{figure ? <>On <strong>{figure.name}</strong>, at the playhead</> : 'Select a figure to give it a motion'}</Target>
      <div className="library-row">
        <ImportButton
          label="Import motion…"
          accept=".bvh,.fbx,.glb,.gltf"
          tip="A BVH, FBX or glTF/GLB animation (motion capture, Mixamo…), fitted to the mannequin"
          fileLabel="Motion file"
          reading={imp.reading}
          onFile={(f) => void imp.run(f)}
        />
      </div>
      {imp.dialog}
    </>
  );
}

export function CharactersBar({ notify, notifyUndo }: BarProps) {
  const store = useStore();
  const { figure } = usePosable();
  const imp = useImport(async (file, map) => {
    const info = await importModel(file.name, await file.arrayBuffer(), map);
    // Its file is here now: its thumbnail is drawn once, and kept with it.
    addModel(store, { ...info, thumb: characterThumb(info.id).make() });
    if (figure) setFigureModel(store, figure.id, info.id);
    notifyUndo(`Imported “${info.name}”${figure ? `: ${figure.name} is drawn as it` : ''}`);
  }, notify);
  return (
    <>
      <Target>{figure ? <>On <strong>{figure.name}</strong></> : 'Select a figure to draw as a character'}</Target>
      <div className="library-row">
        <ImportButton
          label="Import character…"
          accept=".glb,.gltf,.fbx"
          tip="A character with a skeleton (glTF/GLB or FBX: Mixamo, VRoid…), posed and animated like the mannequin"
          fileLabel="Character file"
          reading={imp.reading}
          onFile={(f) => void imp.run(f)}
        />
      </div>
      {imp.dialog}
    </>
  );
}

export function TemplatesBar({ notifyUndo }: BarProps) {
  const store = useStore();
  const scene = useScene();
  const active = useStudio((s) => s.activeFigure);
  const figure = scene.figures.find((f) => f.id === active);
  const [making, setMaking] = useState(false);
  return (
    <>
      <Target>Opens as a new scene{figure && <>; <Layers size={11} aria-label="Put into this scene" /> puts it around <strong>{figure.name}</strong></>}</Target>
      <div className="library-row">
        <button type="button" className="btn subtle library-import" onClick={() => saveAsTemplate(store, { notifyUndo })} data-tip="Its cast, set, actions and light, without cameras or cuts">
          <BookmarkPlus size={14} aria-hidden /> Save scene as template…
        </button>
        <button type="button" className="btn subtle library-import" onClick={() => setMaking(true)} data-tip="A template filmed with a coverage, opened in one go">
          <Clapperboard size={14} aria-hidden /> New shoot preset…
        </button>
      </div>
      {making && <ShootDialog onClose={() => setMaking(false)} onMade={(p) => notifyUndo(`Made the shoot preset ${p.name}`)} />}
    </>
  );
}

export function CameraBar() {
  const scene = useScene();
  const selection = useStudio((s) => s.selection);
  const a = scene.animation;
  // The shot moves apply to: the selected one, or the one at the playhead.
  const shot = useStudio((s) => (a ? (s.selection?.kind === 'shot' ? shotSpans(a).find((sp) => sp.shot.id === (s.selection as { shot: string }).shot) : spanAt(a, s.time))?.shot.name : undefined));
  const cam = selection?.kind === 'camera' ? scene.cameras.find((c) => c.id === selection.camera) : undefined;
  return <Target>{cam ? <>Moves: on <strong>{cam.name}</strong></> : shot ? <>Moves: on <strong>{shot}</strong></> : 'A move animates this still scene and films it'}</Target>;
}

/** Make a shoot preset: a name, a template, a coverage that fits its cast and (a still template) a length. */
function ShootDialog({ onClose, onMade }: { onClose(): void; onMade(p: ShootPreset): void }) {
  const store = useStore();
  const library = useStudio((s) => s.library);
  const all = templatesOf(library);
  const [name, setName] = useState('');
  const [template, setTemplate] = useState(all[0].id);
  const chosen = all.some((x) => x.id === template) ? template : all[0].id;
  const t = all.find((x) => x.id === chosen)!;
  const fitting = COVERAGES.filter((c) => c.roles.length <= t.people);
  const [coverage, setCoverage] = useState(fitting[0]?.id ?? '');
  const how = fitting.find((c) => c.id === coverage) ?? fitting[0];
  // A template that does not move is filmed for a length of its own (worked out as one is picked).
  const isStill = (id: string) => !all.find((x) => x.id === id)?.build().animation;
  const [still, setStill] = useState(() => isStill(chosen));
  const [length, setLength] = useState(6);
  const make = () => {
    if (!how) return;
    const p = saveShoot(store, { name: name || `${t.name}, ${how.name.toLowerCase()}`, template: t.id, coverage: how.id, ...(still ? { duration: length } : {}) });
    onMade(p);
    onClose();
  };
  return (
    <Modal
      title="New shoot preset"
      icon={Clapperboard}
      onClose={onClose}
      footer={<button type="button" className="btn primary" disabled={!how} onClick={make}>Make preset</button>}
    >
      <div className="form">
        <label className="field">
          <span>Name</span>
          <input type="text" value={name} placeholder={how ? `${t.name}, ${how.name.toLowerCase()}` : t.name} aria-label="Preset name" onChange={(e) => setName(e.target.value)} data-autofocus />
        </label>
        <Field label="Template">
          <Select<string> label="Template" value={t.id} onChange={(id) => { setTemplate(id); setStill(isStill(id)); }} options={all.map((x) => ({ value: x.id, label: `${x.name}${x.group === 'Mine' ? ' (mine)' : ''}`, hint: x.people === 1 ? '1 person' : `${x.people} people` }))} />
        </Field>
        <Field label="Coverage">
          {fitting.length
            ? <Select<string> label="Coverage" value={how.id} onChange={setCoverage} options={fitting.map((c) => ({ value: c.id, label: c.name }))} />
            : <Hint>None films one person alone yet</Hint>}
        </Field>
        {still && (
          <Field label="Length">
            <NumberField prefix="s" label="Length (seconds)" value={length} step={1} min={1} max={60} digits={0} onChange={setLength} />
          </Field>
        )}
      </div>
    </Modal>
  );
}
