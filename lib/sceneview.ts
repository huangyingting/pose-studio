import * as THREE from 'three';
import { Ink, type Ghost } from './ink';
import { Mannequin } from './mannequin';
import { ModelRig, modelInfo, modelTemplate } from './model';
import { PropObject } from './props';
import { groundOf } from './surfaces';
import type { JointName, Scene, Selection, Style, Vec3 } from './types';
import { SetObject } from './sets';

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
  /** Figures drawn as imported characters (the mannequin stays, unseen, to pick and pose them by). */
  readonly models = new Map<string, ModelRig>();
  /** The set the scene is played in (lib/sets.ts), if it has one. */
  set: SetObject | null = null;
  /** Each figure's colour (characters are tinted with it too). */
  private tints = new Map<string, string | null>();
  /** Bumped whenever objects are created/destroyed/rebuilt (joint references change). */
  version = 0;
  private style: Style = 'line';
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
        m = new Mannequin(this.ink, f.body, f.id);
        m.setStyle(this.style);
        this.figures.set(f.id, m);
        this.root.add(m.object);
        changed = true;
      } else if (m.setBody(f.body)) {
        changed = true;
      }
      m.setGround(ground);
      m.apply(f);
      m.setTint(f.color ?? null);
      // Drawn as a character, once its file has been read.
      const template = f.model && !f.proxy ? modelTemplate(f.model) : null;
      let rig = this.models.get(f.id);
      if (rig && (!template || rig.info.id !== f.model)) {
        this.root.remove(rig.object);
        rig.dispose();
        this.models.delete(f.id);
        rig = undefined;
        changed = true;
      }
      if (template && !rig) {
        rig = new ModelRig(template, modelInfo(f.model!)!, this.ink);
        this.models.set(f.id, rig);
        this.root.add(rig.object);
        changed = true;
      }
      m.object.visible = !rig;
      this.tints.set(f.id, f.color ?? null);
      rig?.setLook(this.style, f.color ?? null);
      rig?.apply(f, m.joints.hips.getWorldPosition(new THREE.Vector3()));
    }
    for (const [id, rig] of this.models) {
      if (figureIds.has(id)) continue;
      this.root.remove(rig.object);
      rig.dispose();
      this.models.delete(id);
    }

    if (this.set?.id !== scene.set) {
      if (this.set) { this.set.object.removeFromParent(); this.set.dispose(); }
      this.set = scene.set ? new SetObject(this.ink, scene.set) : null;
      if (this.set) { this.set.setStyle(this.style); this.root.add(this.set.object); }
      changed = true;
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
      const parent = holder && p.hold ? holder.joints[p.hold.hand === 'L' ? 'leftHand' : 'rightHand'] : this.root;
      if (o.object.parent !== parent) {
        parent.add(o.object);
        changed = true;
      }
      o.object.visible = !p.hold || !!holder;
      o.apply(p);
      if (!p.hold) o.liftAboveFloor();
    }

    this.root.updateMatrixWorld(true);
    // A ribbon is laid along its line once its stick is in place.
    for (const p of scene.props) if (p.kind === 'ribbon') this.props.get(p.id)?.setTrail(p.trail ?? null);
    // Eyes on someone or something: turn the head to it (after everything is placed).
    const eyes = new THREE.Vector3();
    const box = new THREE.Box3();
    for (const f of shown) {
      if (!f.gaze || f.proxy) continue;
      const m = this.figures.get(f.id)!;
      if ('figure' in f.gaze) {
        const other = this.figures.get(f.gaze.figure);
        if (!other || other === m) continue;
        other.joints.head.getWorldPosition(eyes);
      } else {
        const p = this.props.get(f.gaze.prop);
        if (!p) continue;
        box.setFromObject(p.object).getCenter(eyes);
      }
      m.lookAt(eyes);
    }
    if (changed && this.ink.ghost) this.root.traverse((o) => { o.raycast = () => {}; });
    if (changed) {
      this.version++;
      this.applySelection();
      this.applyHover();
      this.applyLinked();
      for (const l of this.listeners) l();
    }
    return changed;
  }

  setStyle(style: Style) {
    this.style = style;
    this.ink.setStyle(style);
    for (const m of this.figures.values()) m.setStyle(style);
    for (const p of this.props.values()) p.setStyle(style);
    this.set?.setStyle(style);
    for (const [id, r] of this.models) r.setLook(style, this.tints.get(id) ?? null);
  }

  setSelection(sel: Selection) {
    this.selection = sel;
    this.applySelection();
  }

  private applySelection() {
    const sel = this.selection;
    for (const [id, m] of this.figures) m.setSelected(sel?.kind === 'joint' && sel.figure === id ? sel.joint : null, (sel?.kind === 'figure' && sel.figure === id) || (sel?.kind === 'many' && sel.figures.includes(id)));
    for (const [id, p] of this.props) p.setSelected((sel?.kind === 'prop' && sel.prop === id) || (sel?.kind === 'many' && sel.props.includes(id)));
  }

  /** Outline a whole figure or prop: the pointer is on it elsewhere (its row in the outline). */
  setLinked(id: string | null) {
    this.linkedId = id;
    this.applyLinked();
  }

  private linkedId: string | null = null;
  private applyLinked() {
    for (const [id, m] of this.figures) m.setLinked(id === this.linkedId);
    for (const [id, r] of this.models) r.setLinked(id === this.linkedId);
    for (const [id, p] of this.props) p.setLinked(id === this.linkedId);
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
    for (const r of this.models.values()) id = r.setIdMode(on, id);
    if (this.set) id = this.set.parts.setIdMode(on, id);
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

  /** Where a light aims (lib/lighting.ts AimAt): a figure's chest, or a point. */
  aimAt = (aim: { figure: string } | { point: Vec3 }) => ('figure' in aim
    ? this.figures.get(aim.figure)?.joints.chest.getWorldPosition(new THREE.Vector3()) ?? null
    : new THREE.Vector3(...aim.point));

  /** The set's bounds (empty without one): the lights stand above and outside it. */
  setBounds() {
    return this.set ? this.set.bounds() : new THREE.Box3();
  }

  dispose() {
    for (const m of this.figures.values()) m.dispose();
    for (const r of this.models.values()) r.dispose();
    this.models.clear();
    for (const p of this.props.values()) p.dispose();
    this.figures.clear();
    this.props.clear();
    this.root.clear();
    this.ink.dispose();
  }
}
