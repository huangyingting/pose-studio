import { withBase } from './paths';
import type { ModelInfo } from './types';

/*
 * Characters that come with the app (public/characters, CC0: see CREDITS.txt there): listed
 * with the mannequin, their files fetched the first time a figure is drawn as one (or one is
 * previewed). Scenes refer to them by a stable id, as built-in motions are, so a scene drawn with
 * one opens anywhere without carrying the file.
 */

const PREFIX = 'character:';

// Their skeleton (Unreal-style names), found by mapBones without help.
const side = (s: 'l' | 'r', L: 'left' | 'right') => ({
  [`${L}Shoulder`]: `clavicle_${s}`, [`${L}UpperArm`]: `upperarm_${s}`, [`${L}LowerArm`]: `lowerarm_${s}`, [`${L}Hand`]: `hand_${s}`,
  [`${L}UpperLeg`]: `thigh_${s}`, [`${L}LowerLeg`]: `calf_${s}`, [`${L}Foot`]: `foot_${s}`, [`${L}Toes`]: `ball_${s}`,
  ...Object.fromEntries((['Index', 'Middle', 'Ring', 'Little'] as const).flatMap((f) => {
    const n = { Index: 'index', Middle: 'middle', Ring: 'ring', Little: 'pinky' }[f];
    return [[`${L}${f}Proximal`, `${n}_01_${s}`], [`${L}${f}Intermediate`, `${n}_02_${s}`], [`${L}${f}Distal`, `${n}_03_${s}`]];
  })),
  [`${L}ThumbMetacarpal`]: `thumb_01_${s}`, [`${L}ThumbProximal`]: `thumb_02_${s}`, [`${L}ThumbDistal`]: `thumb_03_${s}`,
});
const BONES: ModelInfo['bones'] = {
  hips: 'pelvis', spine: 'spine_01', chest: 'spine_02', upperChest: 'spine_03', neck: 'neck_01', head: 'Head',
  ...side('l', 'left'), ...side('r', 'right'),
};

/** The built-in characters (Quaternius, Universal Base Characters: a man and a woman). */
export const BUILT_IN_CHARACTERS: ModelInfo[] = [
  { id: `${PREFIX}woman`, name: 'Woman', format: 'glb', bones: BONES, proportions: { legs: 0.5077, head: 0.1279, shoulders: 0.1787 } },
  { id: `${PREFIX}man`, name: 'Man', format: 'glb', bones: BONES, proportions: { legs: 0.5005, head: 0.122, shoulders: 0.246 } },
];

export const isBuiltInCharacter = (id: string) => id.startsWith(PREFIX);

/** Where a built-in character's file is. */
export const characterFile = (id: string) => withBase(`/characters/${id.slice(PREFIX.length)}.glb`);
