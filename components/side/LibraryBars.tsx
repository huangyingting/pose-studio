'use client';

import { useRef, useState, type ReactNode } from 'react';
import { BookmarkPlus, Upload } from 'lucide-react';
import { addModel, saveMotion, savePose, setFigureModel } from '@/lib/actions';
import { MissingBones, importModel, type BoneMap } from '@/lib/model';
import { characterThumb } from '@/lib/previews';
import { shotSpans, spanAt } from '@/lib/shots';
import { useScene, useStore, useStudio } from '../store-context';
import BoneMapDialog from '../BoneMapDialog';
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

/** Read a file (a motion, a character; first in `files`, what comes with it after), mapping its bones by hand when they cannot all be named. */
function useImport(read: (files: File[], map?: BoneMap) => Promise<void>, notify: (text: string) => void) {
  const [reading, setReading] = useState(false);
  const [mapping, setMapping] = useState<{ files: File[]; err: MissingBones } | null>(null);
  const run = async (files: File[], map?: BoneMap) => {
    setReading(true);
    try {
      await read(files, map);
    } catch (e) {
      if (e instanceof MissingBones && !map) setMapping({ files, err: e });
      else notify(`Could not import ${files[0].name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setReading(false);
    }
  };
  const dialog = mapping && (
    <BoneMapDialog file={mapping.files[0].name} names={mapping.err.names} found={mapping.err.found} onClose={() => setMapping(null)} onDone={(map) => { setMapping(null); void run(mapping.files, map); }} />
  );
  return { reading, run, dialog };
}

function ImportButton({ label, accept, tip, fileLabel, reading, multiple, onFiles }: { label: string; accept: string; tip: string; fileLabel: string; reading: boolean; multiple?: boolean; onFiles(f: File[]): void }) {
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
        multiple={multiple}
        hidden
        aria-label={fileLabel}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length) onFiles(files);
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
  const imp = useImport(async ([file], map) => {
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
          accept=".bvh,.fbx,.glb,.gltf,.json"
          tip="A BVH, FBX or glTF/GLB animation (motion capture, Mixamo…), fitted to the mannequin, or a Pose Studio motion (.json)"
          fileLabel="Motion file"
          reading={imp.reading}
          onFiles={(files) => void imp.run(files)}
        />
      </div>
      {imp.dialog}
    </>
  );
}

export function CharactersBar({ notify, notifyUndo }: BarProps) {
  const store = useStore();
  const { figure } = usePosable();
  const imp = useImport(async ([file, ...others], map) => {
    const info = await importModel(file.name, await file.arrayBuffer(), map, others);
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
          accept=".vrm,.glb,.gltf,.fbx,.bin,.png,.jpg,.jpeg,.tga,.webp"
          tip="A character with a skeleton (VRM, glTF/GLB or FBX: VRoid, Mixamo…), with its textures if they are separate files; in the Toon style, drawn in its own colours"
          fileLabel="Character file"
          reading={imp.reading}
          multiple
          onFiles={(files) => {
            const main = files.find((f) => /\.(vrm|glb|gltf|fbx)$/i.test(f.name));
            if (main) void imp.run([main, ...files.filter((f) => f !== main)]);
            else notify('Choose the character’s file too (VRM, glTF/GLB or FBX)');
          }}
        />
      </div>
      {imp.dialog}
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
