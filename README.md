# Pose Studio

A posable 3D art mannequin for drawing reference, in the spirit of Magic Poser / Design Doll / PoseMy.Art. Pose figures by dragging hands, feet and hips, then export clean line-art pose sheets such as the 4 × 5 `Pose.jpg` grid.

## Features

**Posing**
- **Direct manipulation**: drag the orange (hands) and green (feet) dots and the limb follows (two-bone IK). Drag the purple hip dot to move the body while the feet stay planted, e.g. to drop into a squat. Drag the small dots on the elbows and knees to point them.
- **Joint gizmo and sliders**: click any body part in the viewport or on the body map in the Pose panel, then rotate it in 3D or fine-tune it with labelled sliders ("Swing − forward", "Raise + out", …). Click a slider's value to type an exact angle.
- **Joint limits**: optional anatomical ranges keep poses natural (View tab → Joint limits).
- **Fingers**: five three-segment fingers per hand, with presets (relaxed, fist, point, peace, grip, …) and per-finger curl and spread.
- **Pose tools**: mirror, symmetrize left→right / right→left, copy/paste pose, reset, undo/redo (200 steps). Undo and redo switch to the pose they change, and deletions show a toast with an **Undo** button.
- **Pose from photo**: detects up to four people in a photo (MediaPipe, on-device) and poses figures to match. The photo can stay on screen as a reference overlay.

**Figures and scenes**
- **Male and female anatomy**: the sex setting blends real secondary sex characteristics, not just scale. Male figures have broad shoulders over narrow hips, sculpted pectorals, a thicker neck, a squarer jaw, more muscular arms and calves and larger hands. Female figures have shoulders narrower than the hips, a defined waist, breasts, fuller glutes and thighs and a slender neck. Height, build, head size, leg length and chest can be adjusted too, or picked from presets (Female, Male, Athletic, Heroic, Slender, Child).
- **Multi-person scenes**: templates for two and three people (conversation, handshake, hand on shoulder, walking hand in hand, waltz hold, back to back, sparring, group photo), built with the same tools you can use yourself:
  - **Placement**: exact floor position and facing for each figure; the Move tool (`W`) moves whole figures; floor markers show where everyone stands and faces (click one to pick that figure).
  - **Relations** to another figure: turn to it, face each other, look at it (head, neck and if needed chest turn without tilting), stand beside it or back to back, set the distance, and **reach** a hand to its head, shoulder, chest, back, waist or hand (IK; tells you when it is out of reach).
- **Sculpted faces**: brow ridge, eyes, nose, cheekbones, lips, chin and ears are modelled into the head as one smooth surface, finished with a few quiet lines (eyelids, brows, lips), and differ between male and female figures. So you can always tell where a figure faces and looks. Turn them off in the Render panel for a plain construction head with centre and eye lines.
- **Layers**: multiple figures and props per pose, listed in the Layers panel, where you can add, duplicate, hide and delete them. Hidden figures stay in the pose but are not drawn or exported.
- **Props**: box, ball, cylinder, chair, stool, step and wall. Move, rotate and scale them with the gizmo or with X/Y/Z fields (drag a field's letter to scrub the value). Turn off "Stand on the floor" to seat a figure on a prop.
- **Pose library**: 20 built-in poses taken from the reference sheet. You can search, reorder by drag and drop or with Alt+arrow keys, and duplicate or delete poses. Arrow keys move between thumbnails. Thumbnails update live.

**Animation and camera**
- **Keyframe animation**: press **Animate** (or start from an animation template), move the playhead and pose: every edit is keyed at that time (auto-key). Keys are joined by smooth curves, loops wrap seamlessly, and a grounded figure bobs naturally as its legs bend. Drag keys along the timeline to retime them; `Space` plays, `,` / `.` step a frame, `K` sets a key. Onion skin shows the previous and next keys as ghosts.
- **Animation templates**: walk cycle, run cycle, jump, dance groove, waltz turn (two people), boxing exchange (two people), front kick, wave hello and bow. Each comes with a camera move.
- **Director's camera**: a shot camera with its own keys (orbit angle, height, lens, push-in and pan). Look through it with a 16:9 letterbox, frame a view and press the camera key, or pick a ready-made move: locked-off wide, push in, pull out, arc, 360° orbit, crane up, low-angle hero, tracking shot, dolly zoom and hand-held.
- **Shots and cuts**: press `C` (or the scissors) to cut the timeline into shots; each shot has its own camera keys and move, a name and a caption (double-click it). **Cut for** a video model (Veo, Sora, Kling, Runway, Seedance, Hailuo, Luma, Wan) and shots longer than that model's clip limit are flagged.
- **Motion check**: one click plays the animation through and flags feet sliding while planted, bodies below the floor, figures passing through each other or through props, joints bent past their natural range and pops (a joint snapping in a frame). Issues are marked on the timeline with a hint each; click one to jump to its frame and select the joint.
- **Shot description**: copy a plain-language description of each shot (framing, angle, lens, camera move, cast, action and length) for AI video tools.
- **Storyboard** (`B`): line poses up as numbered 16:9 panels, each framed by its pose's camera, with a caption and a hold time. Drag to reorder. Export a **board sheet** (PNG) or an **animatic** video in which each panel holds for its time, animated poses play and captions appear as subtitles.

**Output**
- **Seven render styles**, each with a live preview in the Render panel; press `L` to cycle through them:
  - **Line art**: constant-width ink outlines, lines wherever parts meet, ball joints and contour lines, matching the reference sheet.
  - **Pencil**: graphite outlines with hand-drawn wobble and cross-hatched shading.
  - **Ink wash** (sumi-e): brush outlines of varying width with soft, bleeding ink washes on rice paper.
  - **Anime**: cel shading with a crisp shadow band, a highlight and rim light.
  - **Clay**: soft studio lighting with cast shadows, for value studies.
  - **Minimal**: flat shapes with a hairline outline.
  - **Silhouette**: solid shapes, for checking gesture and readability.
- **Key light**: direction, height and presets for the lit styles (Pencil, Ink wash, Anime, Clay), with cast shadows where the style supports them.
- **Export**: a sheet of all poses, just the current pose, a **turnaround** of the current pose from 4 or 8 evenly spaced angles, a **frame sheet** of an animation (a motion study), a **video** of the animation filmed by its shot camera (MP4 or WebM, 720p, 1080p, square or vertical), or a **keyframe pack** for AI video tools: a zip with the first and last frame of every shot (plus depth and normal passes for ControlNet-style conditioning), each shot's description and camera keys, a greybox clip per shot and an OpenTimelineIO cut list. Single images can be exported as depth or normal passes too. Sheets are JPG or PNG, in any of the seven styles. Columns, cell size, line weight, padding, captions, same-scale cells and transparent backgrounds are configurable. The default layout reproduces `Pose.jpg` (2400 × 3200, 4 × 5 cells of 600 × 640).
- **Gesture practice** (`P`): a timed full-screen slideshow for figure-drawing warm-ups. 15 s to 10 min per pose (or untimed), shuffle, random camera angles, random mirroring, pause/skip with the keyboard. Practice a single pose from random angles, too.
- **Per-pose export camera**: set the angle and lens for each pose, or use "Use current view".
- **Share links**: one pose, compressed into the URL fragment. Nothing is sent to a server.
- **Save / import** the whole library as JSON. Files from the earlier MVP format are migrated automatically.

**App**
- Autosaves to browser storage (with a save-status indicator), flushes when the tab is hidden or closed, and warns you if storage is full.
- Several open tabs stay in sync: a tab adopts changes saved by another one instead of overwriting them.
- Works offline once loaded (service worker; production builds only) and can be installed as an app.
- A design-tool layout: pose library and layers on the left, a contextual inspector (Pose / Body / Render) on the right and a floating canvas toolbar. Icon buttons have tooltips with their shortcuts.
- Keyboard shortcuts (press `?`), a responsive layout with drawers on phones and tablets, touch-friendly dragging, accessible dialogs and menus, and an error screen if something crashes.

## Getting started

```bash
npm install        # also copies the MediaPipe runtime and downloads the pose model (~9 MB) into public/mediapipe
npm run dev        # http://localhost:3000
```

Requires Node 20.9+ and a browser with WebGL.

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run build:static` | Static export to `out/` (see [Static hosting](#static-hosting--github-pages)) |
| `npm run check` | Type-check + lint + unit tests |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Browser tests (Playwright). Builds and starts the app unless `BASE_URL` is set; set `PW_CHANNEL=chrome` to use an installed Chrome |
| `npm run setup:mediapipe` | Re-fetch the pose-detection assets (`-- --force` to re-download the model) |

## Deployment

```bash
docker build -t pose-studio .
docker run -p 3000:3000 pose-studio
```

The image uses Next.js standalone output, runs as a non-root user and has a `HEALTHCHECK` against `GET /api/health` (also usable as a liveness probe elsewhere). The pose model and WASM runtime are served from the app itself, so photo detection makes no third-party requests. If they are missing, it falls back to the jsDelivr / Google CDN. Responses carry a Content-Security-Policy and other security headers (see `next.config.ts`).

### Static hosting / GitHub Pages

The app is fully client-side: poses live in browser storage, share links live in the URL fragment and photo detection runs on-device. It needs no backend, so it can be exported as static files:

```bash
npm run build:static                                   # → out/
NEXT_PUBLIC_BASE_PATH=/pose-studio npm run build:static # when served from a sub-path
```

Pushing to `main` deploys to GitHub Pages via `.github/workflows/pages.yml`, which sets the base path for you (enable it once under *Settings → Pages → Source: GitHub Actions*). Static hosts cannot send response headers, so the static build carries its Content-Security-Policy in a `<meta>` tag, and the other headers (HSTS, `X-Frame-Options`, …) are only sent by the Node server. `/api/health` becomes a static file.

## Architecture

```
app/                    Next.js App Router shell (page loads the studio client-side only)
components/
  Studio.tsx            Layout, top bar, canvas toolbar, shortcuts, share-link import, cross-tab sync, dialogs, toasts
  Viewport.tsx          React Three Fiber canvas: selection, gizmo, IK handles, line-art render loop
  Inspector.tsx         Contextual Pose / Body / Render panel (joint, prop and style editors)
  LibraryPanel.tsx      Pose library with thumbnails, and the layers list
  BodyMap.tsx           Clickable body schematic for picking joints
  ui.tsx, icons.ts      Design-system components (icon buttons, menus, sections, fields) and icon mapping
  dialogs.tsx           Export, pose-from-photo and help dialogs
  Board.tsx             Storyboard workspace
  Practice.tsx          Gesture-practice slideshow
  Timeline.tsx, clock.ts  Animation timeline and playback clock
lib/
  types.ts              Document model: Library → Scene → Figure / Prop
  store.ts              App state, undo/redo history, persistence
  actions.ts            All document operations used by the UI and shortcuts
  doc.ts                Factories, mirror/symmetrize, validation and migration of untrusted JSON
  mannequin.ts          Procedural figure: male/female anatomy, fingers, IK, swivel, joint limits, grounding
  props.ts              Prop geometry
  sceneview.ts          Keeps three.js objects in sync with a Scene (shared by editor and exporter)
  styles.ts             Render style definitions (outline, rings, interior lines, background, lighting)
  ink.ts, shaders.ts    Outline hulls with brush jitter, per-style materials, pencil / ink-wash / anime shaders
  lineart.ts            Part-ID edge pass for the lines where body parts meet
  lighting.ts           Key light + shadow-catching floor for the lit styles (editor and export)
  render.ts             Camera fitting, off-screen rendering, sheet / turnaround export
  practice.ts           Gesture-practice session building
  relations.ts          Spatial relations between figures: facing, spacing, look-at, reach
  templates.ts          Multi-person scene templates
  animation.ts          Keyframes, cubic interpolation, auto-key helpers
  motions.ts            Animation templates
  shot.ts               Shot camera: framing, camera keys, camera moves
  shots.ts, otio.ts     Cuts and per-model clip limits; OpenTimelineIO cut list
  qa.ts                 Motion check: foot slide, floor, interpenetration (bone capsules), joint limits, pops
  pack.ts, zip.ts       Keyframe pack for AI video tools; a small store-only zip writer
  board.ts, boardExport.ts  Storyboard panels; board sheet and animatic export
  video.ts, prompt.ts   Frame-accurate video export (WebCodecs via Mediabunny); shot descriptions for AI video tools
  retarget.ts, photo.ts MediaPipe detection and landmark → joint retargeting
  share.ts              Share-link encoding (deflate + base64url in the URL fragment)
app/api/health          Liveness endpoint
public/sw.js            Service worker (offline cache)
tests/unit              Vitest: model, IK, limits, retargeting, store/history, share links, export, practice, relations, templates
tests/e2e               Playwright: real-browser flows incl. IK drags, export/turnaround sizes, photo posing, practice,
                        undo toasts, typed angles, library keyboard reordering, cross-tab sync, mobile
```

### Rotation conventions

The figure faces +Z, and its left is +X. Joints store Euler angles in degrees (root `YXZ`, all others `XZY`):

| Joint | X | Y | Z |
| --- | --- | --- | --- |
| root | pitch (+ forward) | turn (+ left) | roll (+ right) |
| spine / chest / neck / head | bend (+ forward) | twist (+ left) | tilt (+ right) |
| shoulder / hip | swing (− forward) | twist | raise / spread (+ out on the left, − on the right) |
| elbow / knee / ankle | bend (− / + / + points toes) | twist | side |

## Limitations

- Pose detection needs photos of real people. Line drawings, including the reference sheet itself, are not recognised.
- Hands are posed with curl/spread controls rather than per-knuckle rotation.
- The reference-image overlay is not saved with the pose.
