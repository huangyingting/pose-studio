import * as THREE from 'three';
import { Ink, type Ghost } from './ink';
import { Mannequin } from './mannequin';
import { PropObject } from './props';
import { groundOf } from './surfaces';
import type { JointName, Scene, Selection, Style } from './types';

/** What the pointer would move: (some joints of) a figure, a prop, or a held prop and the arm holding it. */
export type Hover = { figure?: string; joints?: JointName[]; prop?: string } | null;

/**
 * Keeps three.js objects in sync with a document Scene. Used by both the interactive
 * editor and the off-screen exporter, each with their own instance.
 */
export class SceneView {
  readonly ink: Ink;
  readonly root = new THREE.Group();
  readonly figures = new Map<string, Mannequin>();
  readonly props = new Map<string, PropObject>();
  /** Bumped whenever objects are created/destroyed/rebuilt (joint references change). */
  version = 0;
  private style: Style = 'line';
  private faces = true;
  private selection: Selection = null;
  private hover: Hover = null;
  private listeners = new Set<() => void>();

  /** React can subscribe to object replacement (useSyncExternalStore). */
  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getVersion = () => this.version;

  /** A ghost view (onion skin) is translucent and cannot be clicked. */
  constructor(ghost: Ghost | null = null) {
    this.ink = new Ink(ghost);
    if (ghost) {
      this.faces = false;
      this.style = 'minimal';
      this.ink.setStyle('minimal');
    }
  }

  /** Returns true if any three.js objects were replaced. */
  sync(scene: Scene): boolean {
    let changed = false;

    const shown = scene.figures.filter((f) => !f.hidden);
    const ground = groundOf(scene.props);
    const figureIds = new Set(shown.map((f) => f.id));
    for (const [id, m] of this.figures) {
      if (figureIds.has(id)) continue;
      this.root.remove(m.object);
      m.dispose();
      this.figures.delete(id);
      changed = true;
    }
    for (const f of shown) {
      let m = this.figures.get(f.id);
      if (!m) {
        m = new Mannequin(this.ink, f.body, f.id, !!f.proxy);
        m.setStyle(this.style);
        m.setFaceFeatures(this.faces);
        this.figures.set(f.id, m);
        this.root.add(m.object);
        changed = true;
      } else if (m.setBody(f.body, !!f.proxy)) {
        changed = true;
      }
      m.setGround(ground);
      m.apply(f);
    }

    const propIds = new Set(scene.props.map((p) => p.id));
    for (const [id, p] of this.props) {
      const doc = scene.props.find((x) => x.id === id);
      if (propIds.has(id) && doc?.kind === p.kind) continue;
      p.object.removeFromParent();
      p.dispose();
      this.props.delete(id);
      changed = true;
    }
    for (const p of scene.props) {
      let o = this.props.get(p.id);
      if (!o) {
        o = new PropObject(this.ink, p.kind, p.id);
        o.setStyle(this.style);
        this.props.set(p.id, o);
        changed = true;
      }
      // A held prop rides on its holder's wrist (re-attached when the figure is rebuilt), hidden with it.
      const holder = p.hold ? this.figures.get(p.hold.figure) : undefined;
      const parent = holder && p.hold ? holder.joints[p.hold.hand === 'L' ? 'wristL' : 'wristR'] : this.root;
      if (o.object.parent !== parent) {
        parent.add(o.object);
        changed = true;
      }
      o.object.visible = !p.hold || !!holder;
      o.apply(p);
      if (!p.hold) o.liftAboveFloor();
    }

    this.root.updateMatrixWorld(true);
    if (changed && this.ink.ghost) this.root.traverse((o) => { o.raycast = () => {}; });
    if (changed) {
      this.version++;
      this.applySelection();
      this.applyHover();
      for (const l of this.listeners) l();
    }
    return changed;
  }

  setStyle(style: Style) {
    this.style = style;
    this.ink.setStyle(style);
    for (const m of this.figures.values()) m.setStyle(style);
    for (const p of this.props.values()) p.setStyle(style);
  }

  /** Show or hide the simple face details on every figure. */
  setFaces(on: boolean) {
    this.faces = on;
    for (const m of this.figures.values()) m.setFaceFeatures(on);
  }

  setSelection(sel: Selection) {
    this.selection = sel;
    this.applySelection();
  }

  private applySelection() {
    const sel = this.selection;
    for (const [id, m] of this.figures) m.setSelected(sel?.kind === 'joint' && sel.figure === id ? sel.joint : null, sel?.kind === 'figure' && sel.figure === id);
    for (const [id, p] of this.props) p.setSelected(sel?.kind === 'prop' && sel.prop === id);
  }

  /** Tint what a drag would move (the editor shows it under the pointer). */
  setHover(hover: Hover) {
    this.hover = hover;
    this.applyHover();
  }

  private applyHover() {
    const h = this.hover;
    for (const [id, m] of this.figures) m.setHover(h?.figure === id ? h.joints ?? 'all' : null);
    for (const [id, p] of this.props) p.setHover(h?.prop === id);
  }

  /** Give every part a unique flat colour for the line-art ID pass. */
  setIdMode(on: boolean) {
    let id = 0;
    for (const m of this.figures.values()) id = m.setIdMode(on, id);
    for (const p of this.props.values()) id = p.setIdMode(on, id);
  }

  forEachPoint(cb: (p: THREE.Vector3) => void, figuresOnly = false) {
    for (const m of this.figures.values()) m.forEachPoint(cb);
    if (!figuresOnly) for (const p of this.props.values()) p.forEachPoint(cb);
  }

  bounds(figuresOnly = false) {
    const box = new THREE.Box3();
    this.forEachPoint((p) => box.expandByPoint(p), figuresOnly);
    return box;
  }

  dispose() {
    for (const m of this.figures.values()) m.dispose();
    for (const p of this.props.values()) p.dispose();
    this.figures.clear();
    this.props.clear();
    this.root.clear();
    this.ink.dispose();
  }
}
