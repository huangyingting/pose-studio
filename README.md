# Pose Studio

A posable 3D art mannequin for drawing reference, in the spirit of Magic Poser / Design Doll / PoseMy.Art. Pose figures by dragging hands, feet and hips, then export clean line-art pose sheets such as the 4 × 5 `Pose.jpg` grid.

## Features

**Posing**
- **Direct manipulation**: drag the orange (hands) and green (feet) dots and the limb follows (two-bone IK). Drag the purple hip dot to move the body while the feet stay planted, e.g. to drop into a squat. Drag the small dots on the elbows and knees to point them.
- **Joint gizmo and sliders**: click any body part to rotate it in 3D, or fine-tune it with labelled sliders ("Swing − forward", "Raise + out", …). Click a slider's value to type an exact angle.
- **Joint limits**: optional anatomical ranges keep poses natural (View tab → Joint limits).
- **Fingers**: five three-segment fingers per hand, with presets (relaxed, fist, point, peace, grip, …) and per-finger curl and spread.
- **Pose tools**: mirror, symmetrize left→right / right→left, copy/paste pose, reset, undo/redo (200 steps). Undo and redo switch to the pose they change, and deletions show a toast with an **Undo** button.
- **Pose from photo**: detects up to four people in a photo (MediaPipe, on-device) and poses figures to match. The photo can stay on screen as a reference overlay.

**Figures and scenes**
- **Body proportions**: male↔female blend, height, build, head size, leg length and chest, plus presets (Female, Male, Athletic, Heroic, Slender, Child).
- **Multiple figures** per pose, each with its own body and pose. Figures can be hidden (kept in the pose but not drawn or exported).
- **Props**: box, ball, cylinder, chair, stool, step and wall, which you can move, rotate, scale and duplicate. Turn off "Stand on the floor" to seat a figure on a prop.
- **Pose library**: 20 built-in poses taken from the reference sheet. You can search, reorder by drag and drop or with Alt+arrow keys, and duplicate or delete poses. Arrow keys move between thumbnails. Thumbnails update live.

**Output**
- **Three styles**: line art (constant-width ink outlines, lines wherever parts meet, ball joints and contour lines, matching the reference sheet), **shaded** with an adjustable key light and cast shadows for value studies, and **silhouette** for gesture and readability checks. Press `L` to cycle.
- **Export**: a sheet of all poses, just the current pose, or a **turnaround** of the current pose from 4 or 8 evenly spaced angles, as JPG or PNG, in any of the three styles. Columns, cell size, line weight, padding, captions, same-scale cells and transparent backgrounds are configurable. The default layout reproduces `Pose.jpg` (2400 × 3200, 4 × 5 cells of 600 × 640).
- **Gesture practice** (`P`): a timed full-screen slideshow for figure-drawing warm-ups. 15 s to 10 min per pose (or untimed), shuffle, random camera angles, random mirroring, pause/skip with the keyboard. Practice a single pose from random angles, too.
- **Per-pose export camera**: set the angle and lens for each pose, or use "Use current view".
- **Share links**: one pose, compressed into the URL fragment. Nothing is sent to a server.
- **Save / import** the whole library as JSON. Files from the earlier MVP format are migrated automatically.

**App**
- Autosaves to browser storage (with a save-status indicator), flushes when the tab is hidden or closed, and warns you if storage is full.
- Several open tabs stay in sync: a tab adopts changes saved by another one instead of overwriting them.
- Works offline once loaded (service worker; production builds only) and can be installed as an app.
- Keyboard shortcuts (press `?`), a responsive layout with drawers on phones and tablets, touch-friendly dragging, accessible dialogs, and an error screen if something crashes.

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
  Studio.tsx            Layout, top bar, shortcuts, share-link import, cross-tab sync, dialogs, toasts
  Viewport.tsx          React Three Fiber canvas: selection, gizmo, IK handles, line-art render loop
  Inspector.tsx         Pose / Body / Scene / View tabs
  LibraryPanel.tsx      Pose library with thumbnails
  dialogs.tsx           Export, pose-from-photo and help dialogs
  Practice.tsx          Gesture-practice slideshow
lib/
  types.ts              Document model: Library → Scene → Figure / Prop
  store.ts              App state, undo/redo history, persistence
  actions.ts            All document operations used by the UI and shortcuts
  doc.ts                Factories, mirror/symmetrize, validation and migration of untrusted JSON
  mannequin.ts          Procedural figure: proportions, fingers, IK, swivel, joint limits, grounding
  props.ts              Prop geometry
  sceneview.ts          Keeps three.js objects in sync with a Scene (shared by editor and exporter)
  ink.ts, lineart.ts    Outline hulls + part-ID edge pass that produce the line-art look; style materials
  lighting.ts           Key light + shadow-catching floor for the shaded style (editor and export)
  render.ts             Camera fitting, off-screen rendering, sheet / turnaround export
  practice.ts           Gesture-practice session building
  retarget.ts, photo.ts MediaPipe detection and landmark → joint retargeting
  share.ts              Share-link encoding (deflate + base64url in the URL fragment)
app/api/health          Liveness endpoint
public/sw.js            Service worker (offline cache)
tests/unit              Vitest: model, IK, limits, retargeting, store/history, share links, export, practice
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
