# Architecture

How the code is laid out, and the conventions it keeps. The decisions behind it, and why, are in the [architecture decision records](adr/README.md); the interface's rules are in [UI.md](UI.md).

## In short

- **The document** (`lib/types.ts`) is plain data: a `Library` of `Scene`s, each with figures, props, cameras, lights, a set and an optional animation. It is kept in **one store** (`lib/store.ts`) with undo, saved in the browser and synced on the server edition (ADR [0002](adr/0002-document-model-and-store.md)).
- **Every change** is a function in `lib/actions/` ([0003](adr/0003-actions-are-the-only-writers.md)). The UI, the commands and the AI assistant all call these.
- **Every operation the user sees** is a command in `components/commands.ts` ([0004](adr/0004-every-operation-is-a-command.md)). Menus, buttons, keys, the palette and the help come from it.
- **The rules** (posing, animation, cameras, sets) are pure modules under `lib/` that take a document and return a new one, tested without a browser.
- **Drawing** goes through one `SceneView` (`lib/sceneview.ts`) for the editor and every export; render styles are data in `lib/styles.ts` ([0007](adr/0007-one-scene-view-styles-as-data.md)).
- **Two editions** come from one codebase: everything server-only is behind `@edition/server` and `route.server.ts` ([0001](adr/0001-two-editions-one-codebase.md)).

## Modules

```
app/                    Next.js App Router shell (page loads the studio client-side only)
components/
  Studio.tsx            Layout, top bar, canvas toolbar, share-link import, cross-tab sync, dialogs, toasts
  shortcuts.ts          The keyboard's routing: a key to what has the focus when it uses it, else to its command
  Viewport.tsx          React Three Fiber canvas: selection, gizmo, line-art render loop
  CameraRig.tsx, CameraHandles.tsx  The cameras on the canvas: their paths and points; the selected one's handles (framing, a rig's angle and move)
  Manipulators.tsx      Direct manipulation: drag figures, props and body parts (IK hands and feet, the hips on planted feet), floor rings to turn
  CanvasTools.tsx       The canvas's tool bar: Pose, Move, Rotate, Body follows
  Inspector.tsx         The inspector: what is selected (a figure, prop, shot, camera or action) or the scene itself
  inspector/            Its sections, one list (sections.tsx: a new group of properties is one entry), and their panels
  BoneMapDialog.tsx     Matching a file's bones to the skeleton by hand, when an import cannot name them
  side/                 Left side panel: the section rail and registry (sections.ts: add a section there), the Scene outline and the Library (libraryItems.ts: its categories and items, one entry per category, searched by the Library and the command palette)
  ScenePicker.tsx       The project's scenes, from the top bar
  commands.ts           Every operation once (title, icon, keys, when it applies, what it does): keys, menus, toolbars, the palette and the help come from it
  CommandPalette.tsx, ContextMenu.tsx  Find a command (Ctrl K) and the host that shows right-click menus
  BodyMap.tsx           Clickable body schematic for picking joints
  ui.tsx, icons.ts      Design-system components (icon buttons, menus, sections, fields) and icon mapping
  dialogs.tsx           Export, pose-from-photo and help dialogs
  Board.tsx             Storyboard workspace
  server/               Server edition only (imported as '@edition/server'; static builds get server/none.ts): account menu, sync, AI assistant
  Practice.tsx          Gesture-practice slideshow
  Timeline.tsx, clock.ts  Timeline (its bar, zoom, picks, keys); playback clock
  timeline/             Its rows (ruler, shots, people, props, path camera) and its drags
lib/
  types.ts              Document model: Library → Scene → Figure / Prop / Animation (actions on tracks, constraints, prop keys)
  skeleton.ts, pose.ts  The VRM humanoid skeleton (bone turns as quaternions on the T-pose); joint angles for people
  clip.ts               Clips: motion of one or more people as glTF-style tracks, sampled at any time
  evaluate.ts           The evaluation pipeline: a figure's actions placed and blended, upper body, corrections, holds
  track.ts              Editing tracks: keys, travels, clips put in, actions moved, retimed and recast
  constraints.ts        Contacts solved for the actual bodies (feet planted, hands on partners, holds)
  physics.ts            Free props: Rapier simulation, baked per flight
  assets.ts, assetstore.ts  Clips by id (built-in and imported); imported clips and characters kept in IndexedDB
  model.ts              Rigs from other tools fitted to the skeleton; characters drawn as figures
  store.ts              App state, undo/redo history, persistence
  actions/              All document operations (the UI, the commands and the assistant), by part: scenes, figures,
                        lights, props, motion, timeline, cameras, library, selection
  doc.ts                Factories, mirror/symmetrize, validation of untrusted JSON
  mannequin.ts          Procedural figure: male/female anatomy, fingers, IK, swivel, joint limits, grounding
  props.ts, hold.ts     Prop geometry; props held in a hand (grips, letting go)
  model3d.ts            The scene as a binary glTF model, animated
  sceneview.ts          Keeps three.js objects in sync with a Scene (shared by editor and exporter)
  styles.ts             Render style definitions (outline, rings, interior lines, background, lighting)
  ink.ts, shaders.ts    Outline hulls with brush jitter, per-style materials, pencil / ink-wash / anime shaders
  lineart.ts            Part-ID edge pass for the lines where body parts meet
  lighting.ts           Key light, and a shadow-catching floor on the bare stage (a set takes its own shadows)
  sets.ts, setassets.ts The sets: their pieces, tops and seats, cut-away; the asset list `npm run sets` prepares
  render.ts             Camera fitting, off-screen rendering, sheet / turnaround export
  practice.ts           Gesture-practice session building
  relations.ts          Spatial relations between figures: facing, spacing, look-at, reach
  stagings.ts           How several people stand together (for templates and motions)
  templates.ts          Scene templates: cast, set, actions and light; placed into a scene
  animation.ts          Animation documents: frames, keyed actions, prop keys, cameras and shots
  motions.ts            Motion library: what people do, no camera or set
  cameras.ts            Cameras: paths, framing, shot sizes, lenses, camera moves; the camera filming at a time
  shots.ts, otio.ts     Cuts and per-model clip limits; OpenTimelineIO cut list
  coverage.ts           Coverage: cameras on roles (master, singles, over-the-shoulder, tracking) and cutting rules
  qa.ts                 Motion check: foot slide, interpenetration (bone capsules), joint limits, pops, hidden from the camera
  pack.ts, zip.ts       AI video pack (first and last frames per shot) for AI video tools; a small store-only zip writer
  board.ts, boardExport.ts  The story (the scenes in order, shot by shot); storyboard image and video
  project.ts            The project's settings (frame, style)
  video.ts, prompt.ts   Frame-accurate video export (WebCodecs via Mediabunny); shot descriptions for AI video tools
  retarget.ts, photo.ts MediaPipe detection and landmark → joint retargeting
  locomotion.ts         Generated walking, running and jumping between keys: footstep plan, leg IK, jump arcs
  surfaces.ts           What figures stand on: the tops of props, seen from above
  propmotion.ts         Props over time: held, flying, resting; releases, catches, handoffs, handles
  importmotion.ts       Motion import: BVH/FBX/glTF read bone by bone onto the skeleton (several people: several parts)
  share.ts              Share-link encoding (deflate + base64url in the URL fragment)
  poses.ts              The pose library: the reference poses and the user's (applied by actions/library)
  agent/                AI assistant: tool registry and the browser side of a turn (tools run here, the model on the server)
  sync.ts, cloud.ts     Library sync: three-way merge per pose; the client that pulls, pushes and merges
  server/               Server-only: NextAuth options, Prisma client, AI upstream config
app/api/*/route.server.ts  Server edition API: auth, library, assets (imported motions and characters), AI
prisma/                 Database schema and migrations (SQLite)
app/api/health          Liveness endpoint
public/sw.js            Service worker (offline cache)
scripts/                Asset preparation (sets, motions, characters, thumbnails) and the guide's screenshots
tests/unit              Vitest: the lib modules (model, IK, limits, retargeting, store/history, export, relations,
                        templates, films; every template × coverage × body, every motion of several people × pairing of builds)
tests/e2e               Playwright: the app in a browser, a test for every component
```

Dependencies go one way: `components/` uses `lib/`, never the reverse; within `lib/actions/`, `timeline` ← `motion` ← `cameras` ← `library`. The one cycle left is between `lib/assets.ts` and `lib/evaluate.ts`, and it is inherent: a built-in motion is baked by playing it, and playing reads clips.

## Rotation conventions

The figure faces +Z, and its left is +X. A pose is 22 joints (the hips, spine, chest, upper chest, neck and head; each arm's shoulder, upper arm, forearm and hand; each leg's thigh, shin, foot and toes) and 30 finger bones: 52 bones, the VRM humanoid's but the eyes and jaw. Poses are stored as each bone's turn (a quaternion, glTF order x, y, z, w) relative to the VRM T-pose, local to its parent in the body (`lib/skeleton.ts`: the neck and shoulders hang from the upper chest, each upper arm from its shoulder, the toes from their foot). The sliders, joint limits, the mannequin and the assistant use each joint's turn as angles in degrees, with the arms hanging down at zero (root `YXZ`, all others `XZY`):

| Joint | X | Y | Z |
| --- | --- | --- | --- |
| root | pitch (+ forward) | turn (+ left) | roll (+ right) |
| spine / chest / upper chest / neck / head | bend (+ forward) | twist (+ left) | tilt (+ right) |
| shoulder (collarbone) | roll | forward (− on the left, + on the right) | raise, a shrug (+ on the left, − on the right) |
| upper arm / hip | swing (− forward) | twist | raise / spread (+ out on the left, − on the right) |
| elbow / knee / ankle | bend (− / + / + points toes) | twist | side |
| toes | curl (+ down, − up as the heel rises) | twist | side |

A rig or a motion without an upper chest, shoulders or toes is fine: they stay at rest, their turn in the bones below them.

## Assets

Prepared assets are made by scripts and committed; the app fetches them the first time they are used and keeps them for offline use.

| What | Made by | Where |
| --- | --- | --- |
| Sets (models, surfaces, skies, the index of tops and seats) | `npm run sets` (`scripts/sets.ts`, from `lib/setassets.ts`) | `public/sets` |
| Sets' Library thumbnails | `npm run set-thumbs` (with `npm run dev` going) | `public/sets/thumbs` |
| The motion library (Mocap clips) | `npm run motions` (from `.clip.json` clips in `data/library/motions`) | `public/motions` |
| Characters | `scripts/characters/` | `public/characters` |
| The pose model for photos | `npm run setup:mediapipe` (run on install) | `public/mediapipe` |
| The guide's screenshots | `npm run doc-shots` (with `npm run dev` going) | `docs/guide/images` |

## Limitations

- Pose detection needs photos of real people. Line drawings, including the reference sheet itself, are not recognised.
- Hands are posed with curl and spread controls; per-knuckle rotation comes only from imported motions.
