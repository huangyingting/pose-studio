# 0008. Cameras are objects; shots film with them; the director re-cuts

- **Status**: Accepted
- **Date**: 2026-11-01

## Context

A scene is filmed as shots. A camera can stand still, follow someone, or move along a path, and when the blocking changes the framing should still hold. Filming by hand (cameras placed and cut one by one) is slow, yet planned coverage must not overwrite what the user cut by hand.

## Decision

- **Cameras are objects of the scene** (`lib/cameras.ts`), listed in the outline with an inspector each, as in Unreal's Camera Cuts or Cinemachine. A camera is **Fixed** (a tripod, aim locked or on a subject), **Path** (points it passes through, fixed in the scene or riding with its subject) or **Follows**, a rig that places itself every frame from its subject's body (an angle, a shot size, smoothed). Framing is set as intent: who, what size, where in the frame, the lens. The aim is worked out from that.
- **Shots** cut the timeline (`lib/shots.ts`) and each films with a camera; a shot cuts or blends in from the one before. `cameraAt(scene, t)` gives the view at any time, and both playback and exports use it.
- **The director** (`lib/coverage.ts`) films a scene in a style (Conversation, Follow the action, Sports, Fight…): it puts cameras on roles and cuts from what the people do. The store runs it again after every change to the scene (`store.directed`), so the cuts follow the action. A shot the user takes over (cuts, moves, re-films) is **pinned** and kept.

## Consequences

- Framing survives re-blocking, because rigs and directed cuts are worked out from the people, not stored as positions.
- Hand edits and the director live together: pinned shots stay, and the rest is re-cut.
- What is filmed and how it is filmed are separate, so any scene template can be filmed with any coverage, and shoot presets pair them by reference.
