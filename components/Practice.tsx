'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  COUNTS, DURATIONS, buildSession, durationLabel, formatTime, parsePracticeOptions, sessionLength, type PracticeOptions, type Slide,
} from '@/lib/practice';
import { sharedRenderer } from '@/lib/thumbnails';
import type { Style } from '@/lib/types';
import { useScene, useStudio } from './store-context';
import { CircleCheck, Pause, Play, SkipBack, SkipForward, Timer, X } from 'lucide-react';
import { STYLE_LIST } from '@/lib/styles';
import { Field, Segmented, Select, Toggle } from './ui';

const PRACTICE_KEY = 'pose-studio-practice-v1';

function loadOptions(): PracticeOptions {
  try {
    return parsePracticeOptions(JSON.parse(localStorage.getItem(PRACTICE_KEY) ?? 'null'));
  } catch {
    return parsePracticeOptions(null);
  }
}

/** Gesture-drawing practice: a timed slideshow of poses (see lib/practice.ts). */
export function PracticeMode({ onClose }: { onClose(): void }) {
  const [slides, setSlides] = useState<Slide[] | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [style, setStyle] = useState<Style>('line');
  return (
    <div className="practice" role="dialog" aria-modal="true" aria-label="Gesture practice">
      {slides ? (
        <Session slides={slides} seconds={seconds} style={style} onExit={onClose} onRestart={() => setSlides(null)} />
      ) : (
        <Setup
          onCancel={onClose}
          onStart={(s, o) => { setSeconds(o.seconds); setStyle(o.style); setSlides(s); }}
        />
      )}
    </div>
  );
}

function Setup({ onStart, onCancel }: { onStart(slides: Slide[], o: PracticeOptions): void; onCancel(): void }) {
  const scenes = useStudio((s) => s.library.scenes);
  const scene = useScene();
  const [o, setO] = useState<PracticeOptions>(loadOptions);
  const set = (patch: Partial<PracticeOptions>) => setO((prev) => ({ ...prev, ...patch }));
  const start = useCallback(() => {
    try {
      localStorage.setItem(PRACTICE_KEY, JSON.stringify(o));
    } catch {
      // ignore
    }
    onStart(buildSession(scenes, scene, o), o);
  }, [o, scenes, scene, onStart]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const total = o.seconds * sessionLength(o, scenes.length);

  return (
    <div className="practice-setup">
      <h2><Timer size={18} aria-hidden /> Gesture practice</h2>
      <p className="muted">A timed slideshow of poses to draw from. Keys: <kbd>Space</kbd> pause, <kbd>←</kbd> <kbd>→</kbd> previous / next, <kbd>Esc</kbd> stop.</p>
      <div className="form">
        <Field label="Poses">
          <Segmented<PracticeOptions['source']> label="Poses"
            value={o.source}
            onChange={(source) => set({ source })}
            options={[{ value: 'all', label: `Library (${scenes.length})` }, { value: 'current', label: 'This pose, random angles' }]}
          />
        </Field>
        <Field label="Time per pose">
          <Segmented<string> label="Time per pose"
            value={String(o.seconds)}
            onChange={(v) => set({ seconds: Number(v) })}
            options={DURATIONS.map((d) => ({ value: String(d), label: durationLabel(d) }))}
          />
        </Field>
        <Field label="How many">
          <Segmented<string> label="How many"
            value={String(o.count)}
            onChange={(v) => set({ count: Number(v) })}
            options={COUNTS.map((c) => ({ value: String(c), label: c === 0 ? (o.source === 'all' ? 'All' : '10') : String(c) }))}
          />
        </Field>
        <label>Style
          <Select<Style> label="Style" value={o.style} onChange={(style) => set({ style })} options={STYLE_LIST.map((st) => ({ value: st.id, label: st.label }))} />
        </label>
        {o.source === 'all' && <Toggle label="Shuffle" checked={o.shuffle} onChange={(shuffle) => set({ shuffle })} />}
        {o.source === 'all' && <Toggle label="Random camera angles" checked={o.randomAngle} onChange={(randomAngle) => set({ randomAngle })} />}
        <Toggle label="Randomly mirror poses" checked={o.mirror} onChange={(mirror) => set({ mirror })} />
      </div>
      <div className="row practice-actions">
        <span className="muted">{total ? `About ${formatTime(total)} in total` : 'Advance with → or the Next button'}</span>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn primary" onClick={start} autoFocus>Start</button>
      </div>
    </div>
  );
}

function Session({ slides, seconds, style, onExit, onRestart }: {
  slides: Slide[];
  seconds: number;
  style: Style;
  onExit(): void;
  onRestart(): void;
}) {
  const light = useStudio((s) => s.settings.light);
  const faces = useStudio((s) => s.settings.faces);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [done, setDone] = useState(false);
  const [left, setLeft] = useState(seconds);
  const remaining = useRef(seconds);
  const [elapsed, setElapsed] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const slide = slides[index];

  const go = useCallback((i: number) => {
    if (i >= slides.length) { setDone(true); return; }
    setIndex(Math.max(0, i));
    remaining.current = seconds;
    setLeft(seconds);
  }, [slides.length, seconds]);

  // Draw the current pose at the stage's size (and again when the window resizes).
  useLayoutEffect(() => {
    if (done) return;
    const draw = () => {
      const el = stage.current;
      const c = canvas.current;
      if (!el || !c) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const scale = Math.min(1, 2048 / Math.max(el.clientWidth * dpr, el.clientHeight * dpr));
      const w = Math.max(64, Math.round(el.clientWidth * dpr * scale));
      const h = Math.max(64, Math.round(el.clientHeight * dpr * scale));
      const src = sharedRenderer().render(slide.scene, w, h, 2 * dpr * scale, { style, light, faces, margin: 0.08 });
      c.width = w;
      c.height = h;
      c.getContext('2d')!.drawImage(src, 0, 0);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(stage.current!);
    return () => ro.disconnect();
  }, [slide, style, light, faces, done]);

  // Countdown. Time only runs while the page is visible and not paused.
  useEffect(() => {
    if (done || paused) return;
    let last = performance.now();
    const t = setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      if (document.hidden) return;
      setElapsed((e) => e + dt);
      if (!seconds) return;
      remaining.current -= dt;
      if (remaining.current <= 0) go(index + 1);
      else setLeft(remaining.current);
    }, 200);
    return () => clearInterval(t);
  }, [done, paused, seconds, go, index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onExit(); return; }
      if (done) return;
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); setPaused((p) => !p); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [done, go, index, onExit]);

  if (done) {
    return (
      <div className="practice-setup">
        <h2><CircleCheck size={18} aria-hidden /> Session complete</h2>
        <p className="muted">{slides.length} {slides.length === 1 ? 'pose' : 'poses'} in {formatTime(elapsed)}. Nice work.</p>
        <div className="row practice-actions">
          <button type="button" className="btn ghost" onClick={onExit}>Close</button>
            <button type="button" className="btn primary" onClick={onRestart} autoFocus>New session</button>
        </div>
      </div>
    );
  }

  const progress = seconds ? Math.min(1, 1 - left / seconds) : 0;
  return (
    <div className="practice-session">
      <header>
        <span className="practice-count">{index + 1} / {slides.length}</span>
        <span className="practice-name">{slide.scene.name}</span>
        <span className={`practice-timer${seconds && left <= 5 ? ' ending' : ''}`} aria-live="off">
          {seconds ? formatTime(left) : formatTime(elapsed)}
        </span>
      </header>
      <div className="practice-progress" aria-hidden><i style={{ width: `${progress * 100}%` }} /></div>
      <div className="practice-stage" ref={stage}>
        <canvas ref={canvas} className={slide.mirrored ? 'mirrored' : ''} aria-label={`Pose: ${slide.scene.name}`} />
        {paused && <div className="practice-paused">Paused</div>}
      </div>
      <footer>
        <button type="button" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous pose" title="Previous  ←">
          <SkipBack size={18} aria-hidden />
        </button>
        <button type="button" onClick={() => setPaused((p) => !p)} className="play" aria-label={paused ? 'Resume' : 'Pause'} title="Pause / resume  Space">
          {paused ? <Play size={18} aria-hidden /> : <Pause size={18} aria-hidden />}
        </button>
        <button type="button" onClick={() => go(index + 1)} aria-label={index === slides.length - 1 ? 'Finish' : 'Next pose'} title="Next  →">
          <SkipForward size={18} aria-hidden />
        </button>
        <button type="button" onClick={onExit} aria-label="Stop" title="Stop  Esc">
          <X size={18} aria-hidden /> <span>Stop</span>
        </button>
      </footer>
    </div>
  );
}
