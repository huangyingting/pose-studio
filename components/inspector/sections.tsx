import type { ComponentType } from 'react';
import { HOLDABLE } from '@/lib/hold';
import { physicsOf } from '@/lib/propmotion';
import type { HeaderChrome } from '../ui';
import {
  ActionHeader, ActionPropPanel, GettingPanel, MotionPanel, PeoplePanel, PosedPanel, TimingPanel,
  actionPropSummary, actionPropTitle, gettingSummary, motionInfo, motionSummary, peopleSummary, posedInfo, posedSummary, posedTitle, timingSummary,
} from './action';
import { CameraHeader, FilmsPanel, FramingPanel, LensPanel, MovesPanel, filmsInfo, filmsSummary, framingSummary, lensSummary, movesInfo, movesSummary } from './camera';
import {
  BodyPanel, FigureHeader, HandsPanel, JointActions, JointPanel, JointsPanel, OthersPanel, PlacementPanel, POSTURE_LABELS, PosePanel, StandInPanel,
  bodySummary, handsSummary, hasOthers, jointSummary, jointTitle, othersSummary, placementSummary,
} from './figure';
import { HeldByPanel, PhysicsActions, PhysicsPanel, PropHeader, TransformPanel, transformInfo } from './prop';
import { CaptionPanel, ReferenceActions, ReferencePanel, SceneHeader, referenceSummary } from './scene';
import { LightHeader, LightPanel, LightingPanel, lightInfo, lightSummary, lightTitle, lightingInfo, lightingSummary } from './light';
import { ManyHeader, ManyPanel, manySummary } from './many';
import { FilmedByPanel, ShotHeader, ShotPanel, filmedBySummary, shotSummary } from './shot';
import type { Target } from './target';

/*
 * The inspector's sections, in the order they show: a new group of properties is one entry. Each
 * says when it shows (for what is selected), what it is called, whether it starts open, and what
 * its header says while folded. The primary ones start open.
 */

export interface InspectorSection {
  id: string;
  title: string | ((t: Target) => string);
  when(t: Target): boolean;
  Panel: ComponentType<{ t: Target }>;
  defaultOpen?: boolean;
  /** What a folded section's header says about what is inside. */
  summary?(t: Target): string | undefined;
  /** What the section is about, behind an ⓘ. */
  info?(t: Target): string | undefined;
  /** Buttons in its header. */
  Actions?: ComponentType<{ t: Target }>;
}

const posable = (t: Target) => !!t.figure && !t.figure.proxy;
const isScene = (t: Target) => !t.figure && !t.prop && !t.span && !t.camera && !t.action && !t.light && !t.many;

export const INSPECTOR_SECTIONS: InspectorSection[] = [
  // A figure (a stand-in has a posture instead of a pose).
  {
    id: 'standin', title: 'Stand-in', when: (t) => !!t.figure?.proxy, Panel: StandInPanel,
    summary: (t) => POSTURE_LABELS[t.figure!.proxy!], info: () => 'A simple shape for blocking a scene: place it, turn it and key it like a figure.',
  },
  {
    id: 'joint', title: jointTitle, when: (t) => posable(t) && !!t.joint, Panel: JointPanel, Actions: JointActions, summary: jointSummary,
    info: (t) => (t.joint === 'hips' ? 'To move the whole figure, drag its torso; to turn it, the ring on the floor.' : undefined),
  },
  { id: 'pose', title: 'Pose', when: posable, Panel: PosePanel, summary: () => 'Mirror, copy, reset' },
  {
    id: 'joints', title: 'Joints', when: (t) => posable(t) && !t.joint, Panel: JointsPanel, defaultOpen: false,
    summary: () => 'Pick a part', info: () => 'Pick a part here, or click it on the canvas, to fine-tune it with sliders.',
  },
  { id: 'placement', title: 'Placement', when: (t) => !!t.figure, Panel: PlacementPanel, summary: placementSummary },
  { id: 'others', title: 'With others', when: (t) => !!t.figure && hasOthers(t), Panel: OthersPanel, defaultOpen: false, summary: othersSummary },
  { id: 'hands', title: 'Hands', when: posable, Panel: HandsPanel, defaultOpen: false, summary: handsSummary },
  { id: 'body', title: 'Body & colour', when: posable, Panel: BodyPanel, defaultOpen: false, summary: bodySummary },

  // A prop.
  {
    id: 'transform', title: 'Transform', when: (t) => !!t.prop, Panel: TransformPanel, info: transformInfo,
    summary: (t) => `${t.prop!.position.map((n) => n.toFixed(1)).join(', ')}${t.prop!.hold ? ' · in the hand' : ''}`,
  },
  {
    id: 'heldby', title: 'Held by', when: (t) => !!t.prop && (HOLDABLE.includes(t.prop.kind) || !!t.prop.hold), Panel: HeldByPanel, defaultOpen: false,
    summary: (t) => (t.prop!.hold ? t.scene.figures.find((f) => f.id === t.prop!.hold!.figure)?.name ?? 'Someone' : 'Nobody'),
  },
  {
    id: 'physics', title: 'Physics', when: (t) => !!t.prop && (HOLDABLE.includes(t.prop.kind) || !!t.prop.physics), Panel: PhysicsPanel, Actions: PhysicsActions, defaultOpen: false,
    summary: (t) => `Bounce ${Math.round(physicsOf(t.prop!).bounce * 100)}% · grip ${Math.round(physicsOf(t.prop!).friction * 100)}%`,
    info: () => 'How it bounces off the floor and grips it when it flies free: thrown, passed, dropped or let go.',
  },

  // A shot.
  { id: 'shot', title: 'Shot', when: (t) => !!t.span, Panel: ShotPanel, summary: shotSummary },
  { id: 'filmedby', title: 'Filmed by', when: (t) => !!t.span, Panel: FilmedByPanel, summary: filmedBySummary },

  // A camera.
  { id: 'films', title: 'Shots', when: (t) => !!t.camera, Panel: FilmsPanel, defaultOpen: false, summary: filmsSummary, info: filmsInfo },
  { id: 'framing', title: 'Framing', when: (t) => !!t.camera, Panel: FramingPanel, summary: framingSummary },
  { id: 'lens', title: 'Lens', when: (t) => !!t.camera, Panel: LensPanel, summary: lensSummary },
  { id: 'moves', title: 'Moves', when: (t) => !!t.camera, Panel: MovesPanel, defaultOpen: false, summary: movesSummary, info: movesInfo },

  // An action on a track: its timing, and the section for its kind.
  {
    id: 'timing', title: 'Timing', when: (t) => !!t.action, Panel: TimingPanel, summary: timingSummary,
    info: () => 'Drag it on the timeline to move it, its right edge to retime it, the ramp before it to blend into it. What follows moves along.',
  },
  { id: 'motion', title: 'Motion', when: (t) => t.action?.source.kind === 'clip', Panel: MotionPanel, summary: motionSummary, info: motionInfo },
  {
    id: 'people', title: 'People', when: (t) => t.action?.source.kind === 'clip' && t.action.roles.length > 1, Panel: PeoplePanel, summary: peopleSummary,
    info: () => 'Dragging one of their marks moves them all, as a formation.',
  },
  { id: 'actionprop', title: actionPropTitle, when: (t) => t.action?.source.kind === 'clip' && !!t.action.prop && !!t.action.target, Panel: ActionPropPanel, summary: actionPropSummary },
  {
    id: 'getting', title: 'Getting there', when: (t) => t.action?.source.kind === 'travel', Panel: GettingPanel, summary: gettingSummary,
    info: () => 'Its steps are generated between the marks. Drag its mark on the floor to change where it goes; Glide moves it there as posed instead.',
  },
  { id: 'posed', title: posedTitle, when: (t) => t.action?.source.kind === 'keys', Panel: PosedPanel, summary: posedSummary, info: posedInfo },

  // Several things at once.
  { id: 'many', title: 'Selected', when: (t) => !!t.many, Panel: ManyPanel, summary: manySummary },

  // A light, and the scene's lighting (its scheme and ambient light: with a light, or the scene).
  { id: 'light', title: lightTitle, when: (t) => !!t.light, Panel: LightPanel, summary: lightSummary, info: lightInfo },
  { id: 'lighting', title: 'Lighting', when: (t) => !!t.light || isScene(t), Panel: LightingPanel, summary: lightingSummary, info: lightingInfo },

  // The scene itself (nothing selected).
  { id: 'caption', title: 'Scene', when: (t) => isScene(t) && !t.scene.animation, Panel: CaptionPanel, defaultOpen: false, summary: (t) => t.scene.caption || 'No caption' },
  {
    id: 'reference', title: 'Reference image', when: isScene, Panel: ReferencePanel, Actions: ReferenceActions, defaultOpen: false,
    summary: referenceSummary, info: () => 'Saved with the scene; it is not filmed or exported.',
  },
];

/** The header for what is selected: its name, its menu. */
export function Header({ t, chrome }: { t: Target; chrome: HeaderChrome }) {
  if (t.figure) return <FigureHeader t={t} chrome={chrome} />;
  if (t.prop) return <PropHeader t={t} chrome={chrome} />;
  if (t.span) return <ShotHeader t={t} chrome={chrome} />;
  if (t.camera) return <CameraHeader t={t} chrome={chrome} />;
  if (t.action) return <ActionHeader t={t} chrome={chrome} />;
  if (t.light) return <LightHeader t={t} chrome={chrome} />;
  if (t.many) return <ManyHeader t={t} chrome={chrome} />;
  return <SceneHeader t={t} chrome={chrome} />;
}
