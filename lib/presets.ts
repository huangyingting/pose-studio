import { HAND_PRESETS } from './hands';
import { newFigure, uid } from './doc';
import type { Figure, Hand, Scene, View } from './types';

interface RawPose {
  name: string;
  view: View;
  joints: Figure['joints'];
}

const v = (yaw: number, pitch: number): View => ({ yaw, pitch, fov: 20 });

/** Approximations of the 20 poses in the original Pose.jpg sheet, in reading order. */
const RAW: RawPose[] = [
  {
    name: 'Hand on head', view: v(0, 4), joints: {
      root: [0, 0, -3], spine: [0, -4, 3], chest: [0, -6, -6], neck: [0, 0, 4], head: [6, 8, 10],
      shoulderL: [-10, 90, 150], elbowL: [-135, 0, 0], shoulderR: [10, 90, -40], elbowR: [-100, 0, 0],
      hipL: [-12, -10, 4], kneeL: [22, 0, 0], ankleL: [35, 0, 0], hipR: [2, 0, -7], kneeR: [3, 0, 0],
    },
  },
  {
    name: 'Hands behind head', view: v(0, 4), joints: {
      chest: [-5, 0, 0], head: [-5, 0, 0],
      shoulderL: [5, 90, 145], elbowL: [-150, 0, 0], shoulderR: [5, -90, -145], elbowR: [-150, 0, 0],
      hipL: [0, 0, 5], hipR: [0, 0, -5],
    },
  },
  {
    name: 'Back view, hand on hip', view: v(180, 4), joints: {
      root: [0, 0, -3], chest: [0, 15, 0], neck: [0, 10, 0], head: [5, 35, -5],
      shoulderR: [10, 90, -40], elbowR: [-100, 0, 0], shoulderL: [5, 0, 12], elbowL: [-8, 0, 0],
      hipL: [-8, -10, 8], kneeL: [18, 0, 0], ankleL: [30, 0, 0], hipR: [2, 0, -6],
    },
  },
  {
    name: 'Leaning, hands on knees', view: v(0, 4), joints: {
      root: [25, 0, 0], spine: [8, 0, 0], chest: [5, 0, 0], neck: [-15, 0, 0], head: [-20, 0, 0],
      shoulderL: [-40, 0, 10], elbowL: [-10, 0, 0], shoulderR: [-40, 0, -10], elbowR: [-10, 0, 0],
      hipL: [-32, 0, 12], kneeL: [18, 0, 0], ankleL: [-11, 0, 0], hipR: [-32, 0, -12], kneeR: [18, 0, 0], ankleR: [-11, 0, 0],
    },
  },
  {
    name: 'Side sit, leaning on arm', view: v(0, 8), joints: {
      root: [0, 20, 8], spine: [0, 0, 6], chest: [0, -10, 4], head: [0, -20, -8],
      shoulderR: [0, 0, -30], shoulderL: [-30, 0, 10], elbowL: [-50, 0, 0],
      hipL: [-85, -60, 10], kneeL: [140, 0, 0], ankleL: [40, 0, 0], hipR: [-75, -70, -5], kneeR: [150, 0, 0], ankleR: [40, 0, 0],
    },
  },
  {
    name: 'Kneeling, hands on knees', view: v(0, 15), joints: {
      head: [5, 0, 0],
      shoulderL: [-25, 0, 12], elbowL: [-25, 0, 0], shoulderR: [-25, 0, -12], elbowR: [-25, 0, 0],
      hipL: [-35, 0, 10], kneeL: [125, 0, 0], ankleL: [70, 0, 0], hipR: [-35, 0, -10], kneeR: [125, 0, 0], ankleR: [70, 0, 0],
    },
  },
  {
    name: 'Kneeling, hands behind head', view: v(0, 6), joints: {
      root: [0, 0, -4], spine: [0, 0, -6], chest: [0, 0, 6], head: [-5, 0, -5],
      shoulderL: [5, 90, 145], elbowL: [-150, 0, 0], shoulderR: [5, -90, -145], elbowR: [-150, 0, 0],
      hipL: [-5, 0, 12], kneeL: [95, 0, 0], ankleL: [75, 0, 0], hipR: [-5, 0, -12], kneeR: [95, 0, 0], ankleR: [75, 0, 0],
    },
  },
  {
    name: 'Crouch, hands on floor', view: v(0, 10), joints: {
      root: [35, 0, 0], spine: [10, 0, 0], neck: [-25, 0, 0], head: [-25, 0, 0],
      shoulderL: [-65, 0, 18], shoulderR: [-65, 0, -18],
      hipL: [-95, 0, 18], kneeL: [140, 0, 0], ankleL: [-10, 0, 0], hipR: [-60, 0, -15], kneeR: [125, 0, 0], ankleR: [40, 0, 0],
    },
  },
  {
    name: 'Lying, head propped', view: v(0, 15), joints: {
      root: [-35, 0, 90], spine: [0, 0, -10], chest: [0, 0, -10], neck: [0, 0, -10],
      shoulderR: [-30, 0, -160], elbowR: [-130, 0, 0], shoulderL: [-10, -90, 40], elbowL: [-100, 0, 0],
      hipL: [-70, 0, 0], kneeL: [100, 0, 0], hipR: [-15, 0, 0], kneeR: [30, 0, 0],
    },
  },
  {
    name: 'Prone, chin in hands', view: v(0, 25), joints: {
      root: [90, 0, 0], spine: [-25, 0, 0], chest: [-25, 0, 0], neck: [-20, 0, 0], head: [-25, 0, 0],
      shoulderL: [-60, 0, 15], elbowL: [-120, 0, 0], shoulderR: [-60, 0, -15], elbowR: [-120, 0, 0],
      hipL: [0, 0, 6], kneeL: [100, 0, 0], ankleL: [30, 0, 0], hipR: [0, 0, -6], kneeR: [100, 0, 0], ankleR: [30, 0, 0],
    },
  },
  {
    name: 'Cobra', view: v(30, 5), joints: {
      root: [90, 90, 0], spine: [-30, 0, 0], chest: [-30, 0, 0], neck: [-10, 0, 0], head: [-15, 0, 0],
      shoulderL: [-40, 0, 8], elbowL: [-5, 0, 0], shoulderR: [-40, 0, -8], elbowR: [-5, 0, 0],
      hipL: [0, 0, 3], kneeL: [5, 0, 0], ankleL: [60, 0, 0], hipR: [0, 0, -3], kneeR: [5, 0, 0], ankleR: [60, 0, 0],
    },
  },
  {
    name: 'Sitting, knees up', view: v(0, 12), joints: {
      root: [-10, 0, 0],
      shoulderL: [25, 0, 25], shoulderR: [25, 0, -25],
      hipL: [-110, 0, 38], kneeL: [115, 0, 0], hipR: [-110, 0, -38], kneeR: [115, 0, 0],
    },
  },
  {
    name: 'Deep squat', view: v(0, 8), joints: {
      root: [15, 0, 0], spine: [5, 0, 0], head: [-15, 0, 0],
      shoulderL: [-35, 0, 28], elbowL: [-45, 0, 0], shoulderR: [-35, 0, -28], elbowR: [-45, 0, 0],
      hipL: [-115, 0, 32], kneeL: [145, 0, 0], ankleL: [-25, 0, 0], hipR: [-115, 0, -32], kneeR: [145, 0, 0], ankleR: [-25, 0, 0],
    },
  },
  {
    name: 'Sitting, legs wide', view: v(0, 35), joints: {
      root: [-28, 0, 0], spine: [8, 0, 0], head: [10, 0, 0],
      shoulderL: [30, 0, 30], shoulderR: [30, 0, -30],
      hipL: [-62, 0, 32], ankleL: [20, 0, 0], hipR: [-62, 0, -32], ankleR: [20, 0, 0],
    },
  },
  {
    name: 'Table-top', view: v(70, 10), joints: {
      root: [-68, 0, 0], neck: [-20, 0, 0], head: [-20, 0, 0],
      shoulderL: [68, 0, 10], shoulderR: [68, 0, -10],
      hipL: [-22, 0, 8], kneeL: [90, 0, 0], hipR: [-22, 0, -8], kneeR: [90, 0, 0],
    },
  },
  {
    name: 'Standing, hugging knee', view: v(0, 4), joints: {
      root: [0, -15, 0], chest: [12, 0, 0], head: [8, 0, 0],
      shoulderL: [-50, 0, 5], elbowL: [-80, 0, 0], shoulderR: [-45, 0, -5], elbowR: [-90, 0, 0],
      hipL: [-105, 0, 5], kneeL: [125, 0, 0], ankleL: [30, 0, 0], hipR: [0, 0, -3],
    },
  },
  {
    name: 'Kneeling wide, sitting back', view: v(0, 10), joints: {
      root: [-5, 0, 0], head: [-15, 0, 0],
      shoulderL: [-20, 0, 15], elbowL: [-20, 0, 0], shoulderR: [-20, 0, -15], elbowR: [-20, 0, 0],
      hipL: [-25, 0, 22], kneeL: [140, 0, 0], ankleL: [70, 0, 0], hipR: [-25, 0, -22], kneeR: [140, 0, 0], ankleR: [70, 0, 0],
    },
  },
  {
    name: 'Lying, leg raised', view: v(0, 15), joints: {
      root: [-90, 0, 90], spine: [-5, 0, 0], head: [10, 0, 0],
      shoulderL: [-170, 0, 15], shoulderR: [-170, 0, -15],
      hipL: [-90, 0, 0], ankleL: [40, 0, 0], hipR: [-50, 0, 0], kneeR: [100, 0, 0],
    },
  },
  {
    name: 'Sitting, holding leg up', view: v(0, 8), joints: {
      root: [-15, 0, 0], spine: [5, 0, 0], head: [0, 15, 0],
      shoulderL: [-150, 0, 8], elbowL: [-20, 0, 0], shoulderR: [25, 0, -30],
      hipL: [-150, 0, 8], ankleL: [40, 0, 0], hipR: [-80, -70, -15], kneeR: [140, 0, 0],
    },
  },
  {
    name: 'Lunge, pushing', view: v(0, 4), joints: {
      root: [0, 60, 0], spine: [10, 0, 0], chest: [10, 0, 0],
      shoulderL: [-80, 0, 5], elbowL: [-8, 0, 0], shoulderR: [-80, 0, -5], elbowR: [-8, 0, 0],
      hipL: [-45, 0, 5], kneeL: [55, 0, 0], ankleL: [-10, 0, 0], hipR: [20, 0, -5], kneeR: [15, 0, 0], ankleR: [10, 0, 0],
    },
  },
];

const HAND_HINTS: Record<string, [string, string]> = {
  'Leaning, hands on knees': ['Grip', 'Grip'],
  'Kneeling, hands on knees': ['Grip', 'Grip'],
  'Crouch, hands on floor': ['Open', 'Open'],
  'Side sit, leaning on arm': ['Relaxed', 'Open'],
  'Prone, chin in hands': ['Grip', 'Grip'],
  'Cobra': ['Flat', 'Flat'],
  'Sitting, knees up': ['Open', 'Open'],
  'Deep squat': ['Grip', 'Grip'],
  'Sitting, legs wide': ['Open', 'Open'],
  'Table-top': ['Open', 'Open'],
  'Standing, hugging knee': ['Grip', 'Grip'],
  'Sitting, holding leg up': ['Grip', 'Open'],
  'Lunge, pushing': ['Open', 'Open'],
};

const hand = (name: string): Hand => {
  const h = (HAND_PRESETS.find((p) => p.name === name) ?? HAND_PRESETS[0]).hand;
  return { curl: [...h.curl] as Hand['curl'], spread: h.spread };
};

export function presetScenes(): Scene[] {
  return RAW.map((p) => {
    const [l, r] = HAND_HINTS[p.name] ?? ['Relaxed', 'Relaxed'];
    const figure = newFigure({ name: 'Figure', joints: structuredClone(p.joints), hands: { L: hand(l), R: hand(r) } });
    return { id: uid('s'), name: p.name, figures: [figure], props: [], view: { ...p.view } };
  });
}
