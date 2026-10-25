import type { Hand } from './types';

export const HAND_PRESETS: { name: string; hand: Hand }[] = [
  { name: 'Relaxed', hand: { curl: [0.2, 0.22, 0.28, 0.34, 0.4], spread: 0.15 } },
  { name: 'Flat', hand: { curl: [0, 0, 0, 0, 0], spread: 0 } },
  { name: 'Open', hand: { curl: [0, 0, 0, 0, 0], spread: 0.9 } },
  { name: 'Fist', hand: { curl: [0.75, 1, 1, 1, 1], spread: 0 } },
  { name: 'Point', hand: { curl: [0.7, 0, 1, 1, 1], spread: 0.1 } },
  { name: 'Peace', hand: { curl: [0.75, 0, 0, 1, 1], spread: 0.6 } },
  { name: 'Grip', hand: { curl: [0.45, 0.55, 0.6, 0.62, 0.65], spread: 0.1 } },
  { name: 'Thumbs up', hand: { curl: [0, 1, 1, 1, 1], spread: 0 } },
  { name: 'Claw', hand: { curl: [0.35, 0.5, 0.5, 0.5, 0.5], spread: 0.8 } },
];

export const RELAXED_HAND: Hand = HAND_PRESETS[0].hand;

export function cloneHand(h: Hand): Hand {
  return { curl: [...h.curl], spread: h.spread };
}
