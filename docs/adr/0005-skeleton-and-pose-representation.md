# 0005. The VRM humanoid skeleton; poses as turns on the T-pose

- **Status**: Accepted
- **Date**: 2026-11-01

## Context

Poses come from many places: posing by hand, the built-in library, photos (MediaPipe landmarks), motion files (BVH, FBX, glTF) and characters with their own rigs (Mixamo, VRoid/VRM, Unreal, Biped). Every source names its bones and orients its rest pose differently. If poses were stored in any one source's terms, every other source would need its own conversion, and a pose made on one character would not fit another.

## Decision

- The app has one skeleton: the **VRM humanoid** (`lib/skeleton.ts`), 52 bones (22 body joints and 30 finger bones; no eyes or jaw).
- A pose stores each bone's turn as a quaternion **relative to the VRM T-pose**, local to its parent. That does not depend on any rig's rest pose or bone lengths.
- People-facing values (sliders, joint limits, the assistant) are angles in degrees with the arms hanging at zero, converted in `lib/pose.ts` (root `YXZ`, others `XZY`; the table is in the guide's architecture page).
- Everything that comes in is mapped onto this skeleton on the way in: imported rigs by bone name and shape (`lib/model.ts`, with a dialog to match any bone it cannot name), motions bone by bone (`lib/importmotion.ts`), photos from landmarks (`lib/retarget.ts`).

## Consequences

- Any pose plays on any figure or character, at any size; a character is posed exactly as the mannequin is.
- Every importer converts once, onto one target; nothing downstream knows where a pose came from.
- Rigs missing a bone (no upper chest, shoulders or toes) are fine: those bones stay at rest and their turn goes to the bones below.
- Finger detail is curl and spread presets for posing by hand; per-knuckle turns come only from imported motions.
