'use client';

import { useEffect, useRef, useState } from 'react';
import { BookmarkPlus, Film, Search, Trash2, Upload, UsersRound, Video } from 'lucide-react';
import { addScene, applyCameraMove, applyMotion, applyPose, deleteMotion, deletePose, saveMotion, savePose, startAnimation } from '@/lib/actions';
import { MOTIONS } from '@/lib/motions';
import { builtInPoses, poseScene } from '@/lib/poses';
import { CAMERA_MOVES } from '@/lib/shot';
import { shotSpans, spanAt } from '@/lib/shots';
import { thumbnail } from '@/lib/thumbnails';
import type { LibraryTab } from '@/lib/store';
import type { PoseAsset } from '@/lib/types';
import { useScene, useStore, useStudio } from '../store-context';
import { IconButton, Segmented } from '../ui';
import type { SectionProps } from './sections';


/**
 * Ready-made things to build a scene with. They apply to what is selected: a pose or a motion to
 * the selected figure, a camera move to the selected (or current) shot. (Scene set-ups are in the
 * scene picker's New menu.)
 */
export default function LibrarySection(props: SectionProps) {
  const store = useStore();
  const tab = useStudio((s) => s.settings.libraryTab);
  const setTab = (libraryTab: LibraryTab) => store.setSettings({ libraryTab });
  return (
    <div className="side-section">
      <div className="side-head">
        <h2>Library</h2>
      </div>
      <div className="library-tabs">
        <Segmented<LibraryTab>
          label="Library"
          full
          value={tab}
          onChange={setTab}
          options={[{ value: 'poses', label: 'Poses' }, { value: 'motions', label: 'Motions' }, { value: 'camera', label: 'Camera' }]}
        />
      </div>
      {tab === 'poses' && <Poses {...props} />}
      {tab === 'motions' && <Motions {...props} />}
      {tab === 'camera' && <CameraMoves {...props} />}
    </div>
  );
}

/** Who the library applies to, or what to select first. */
function Target({ children }: { children: React.ReactNode }) {
  return <p className="library-target">{children}</p>;
}

function useActiveFigure() {
  const scene = useScene();
  const id = useStudio((s) => s.activeFigure);
  return scene.figures.find((f) => f.id === id) ?? null;
}

function Poses({ notifyUndo }: SectionProps) {
  const store = useStore();
  const figure = useActiveFigure();
  const mine = useStudio((s) => s.library.poses);
  const [query, setQuery] = useState('');
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const poses: (PoseAsset & { mine?: boolean })[] = [...builtInPoses(), ...(mine ?? []).map((p) => ({ ...p, mine: true }))];
  const q = query.trim().toLowerCase();
  const shown = poses.filter((p) => !q || p.name.toLowerCase().includes(q));

  // Thumbnails are cached by content: only new or changed poses render.
  useEffect(() => {
    const t = setTimeout(() => {
      const next: Record<string, string> = {};
      for (const p of [...builtInPoses(), ...(mine ?? [])]) next[p.id] = thumbnail(poseScene(p));
      setThumbs(next);
    }, 120);
    return () => clearTimeout(t);
  }, [mine]);

  const usable = figure && !figure.proxy;
  return (
    <div className="side-scroll">
      <Target>
        {usable ? <>Click a pose to put it on <strong>{figure.name}</strong>.</> : figure?.proxy ? 'Stand-ins take postures, not poses: pick a figure.' : 'Select a figure to pose it.'}
      </Target>
      <div className="library-row">
        <label className="search">
          <Search size={14} aria-hidden />
          <input type="search" placeholder="Search poses" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search poses" />
        </label>
        <IconButton
          icon={BookmarkPlus}
          label={usable ? `Save ${figure.name}'s pose` : 'Save the selected figure’s pose'}
          disabled={!usable}
          onClick={() => {
            if (!figure) return;
            const saved = savePose(store, figure.id, `${store.scene.name} · ${figure.name}`);
            if (saved) notifyUndo(`Saved “${saved.name}” to the library`);
          }}
        />
      </div>
      <ol className="thumbs" aria-label="Poses">
        {shown.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              className="thumb"
              disabled={!usable}
              onClick={() => { if (figure && applyPose(store, figure.id, p.id)) notifyUndo(`${figure.name}: ${p.name}`); }}
              title={usable ? `Put “${p.name}” on ${figure.name}` : p.name}
            >
              {thumbs[p.id] ? (
                // Generated data: URLs, so next/image does not apply.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbs[p.id]} alt="" draggable={false} />
              ) : <div className="ph" />}
              <span>{p.name}</span>
            </button>
            {p.mine && <IconButton icon={Trash2} label={`Delete my pose ${p.name}`} className="thumb-delete" size={13} onClick={() => { deletePose(store, p.id); notifyUndo(`Deleted “${p.name}”`); }} />}
          </li>
        ))}
        {!shown.length && <li className="empty">No poses match “{query}”.</li>}
      </ol>
    </div>
  );
}

// A motion's length (building one solves IK, so do it once per motion).
const lengths = new Map<string, number>();
function motionLength(id: string) {
  if (!lengths.has(id)) lengths.set(id, MOTIONS.find((m) => m.id === id)?.build().animation?.duration ?? 0);
  return lengths.get(id)!;
}

function Motions({ notify, notifyUndo }: SectionProps) {
  const store = useStore();
  const figure = useActiveFigure();
  const mine = useStudio((s) => s.library.motions) ?? [];
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const usable = figure && !figure.proxy;
  const give = (id: string, name: string) => { if (figure && applyMotion(store, figure.id, id)) notifyUndo(`${figure.name}: ${name}`); };

  const read = async (file: File) => {
    setReading(true);
    try {
      // The loaders are only fetched when a motion is imported.
      const { importMotion } = await import('@/lib/importmotion');
      const motion = await importMotion(file.name, await file.arrayBuffer());
      saveMotion(store, motion);
      notifyUndo(`Imported “${motion.name}” (${motion.scene.animation!.duration.toFixed(1)} s) to My motions`);
    } catch (e) {
      notify(`Could not import ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="side-scroll">
      <Target>
        {usable ? <>One-person motions go on <strong>{figure.name}</strong>&apos;s track at the playhead.</> : 'Select a figure to give it a motion.'}
      </Target>
      <div className="library-row">
        <button
          type="button"
          className="btn subtle library-import"
          disabled={reading}
          onClick={() => fileRef.current?.click()}
          data-tip="A BVH, FBX or glTF/GLB animation (motion capture, Mixamo…), fitted to the mannequin"
        >
          <Upload size={14} aria-hidden /> {reading ? 'Importing…' : 'Import motion…'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".bvh,.fbx,.glb,.gltf"
          hidden
          aria-label="Motion file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void read(f);
            e.target.value = '';
          }}
        />
      </div>
      {mine.length > 0 && (
        <ul className="side-list library-list" aria-label="My motions">
          {mine.map((m) => (
            <li key={m.id}>
              <button type="button" disabled={!usable} onClick={() => give(m.id, m.name)}>
                <Film size={14} aria-hidden />
                <span className="side-list-name">{m.name}</span>
                <em>{(m.scene.animation?.duration ?? 0).toFixed(1)} s</em>
              </button>
              <IconButton icon={Trash2} label={`Delete my motion ${m.name}`} className="row-delete" size={13} onClick={() => { deleteMotion(store, m.id); notifyUndo(`Deleted “${m.name}”`); }} />
            </li>
          ))}
        </ul>
      )}
      <ul className="side-list library-list" aria-label="Motions">
        {MOTIONS.map((m) => {
          const solo = m.people === 1;
          return (
            <li key={m.id}>
              <button
                type="button"
                disabled={solo && !usable}
                onClick={() => {
                  if (!solo) { addScene(store, m.build()); return; }
                  give(m.id, m.name);
                }}
              >
                {solo ? <Film size={14} aria-hidden /> : <UsersRound size={14} aria-hidden />}
                <span className="side-list-name">{m.name}</span>
                <em title={solo ? undefined : 'Opens as a new scene'}>{solo ? `${motionLength(m.id).toFixed(1)} s` : `${m.people} people`}</em>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CameraMoves({ notify }: SectionProps) {
  const store = useStore();
  const scene = useScene();
  const selection = useStudio((s) => s.selection);
  const time = useStudio((s) => s.time);
  const a = scene.animation;
  const selected = a && selection?.kind === 'shot' ? shotSpans(a).find((sp) => sp.shot.id === selection.shot) : undefined;
  const span = selected ?? (a ? spanAt(a, time) : undefined);
  return (
    <div className="side-scroll">
      <Target>
        {span ? <>Moves apply to <strong>{span.shot.name}</strong>{a && shotSpans(a).length > 1 ? ' (select another shot in the Scene outline)' : ''}.</> : 'A move animates this still scene and films it.'}
      </Target>
      <ul className="side-list library-list" aria-label="Camera moves">
        {CAMERA_MOVES.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              title={m.description}
              onClick={() => {
                if (!store.scene.animation) startAnimation(store);
                if (span) store.setTime(span.start);
                applyCameraMove(store, m.id);
                notify(`${m.name}: ${m.description}`);
              }}
            >
              <Video size={14} aria-hidden />
              <span className="side-list-name">{m.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
