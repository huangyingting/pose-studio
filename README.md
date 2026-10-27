# Pose Studio

A posable 3D art mannequin for drawing reference, in the spirit of Magic Poser / Design Doll / PoseMy.Art. Pose figures by dragging hands, feet and hips, then export clean line-art pose sheets such as the 4 × 5 `Pose.jpg` grid.

It comes in two editions built from the same code:

| | Static edition | Server edition |
| --- | --- | --- |
| Where | GitHub Pages or any static host (`npm run build:static`) | Node server / Docker (`npm run build`) |
| Posing, animation, storyboard, export | ✓ (everything runs in the browser) | ✓ |
| Accounts (Google, Microsoft Entra ID) | | ✓ NextAuth |
| Library synced across devices | | ✓ Prisma + SQLite |
| AI assistant | | ✓ Azure OpenAI or OpenAI, with the server's key |

The static build leaves the account, sync and AI code out entirely.

## Workflow

The app follows how a scene is made, and the layout follows the app:

1. **Scene**: start one from the scene picker in the top bar (blank, or a set-up with people).
2. **Cast and set**: add figures, stand-ins and props in the **Scene** outline (left), and place them.
3. **Act**: pose each figure by hand, or apply a pose or a motion from the **Library**; every figure has its own track on the timeline.
4. **Shoot**: cut the timeline into shots; select a shot in the outline to name it, caption it and give it a camera move.
5. **Output**: storyboard (the rail), export (sheets, video, keyframe pack).

The inspector on the right shows what is selected: a figure (pose, place, others, movement, hands, body), a prop or a shot; the **Scene** crumb in its header (or the sun button at the top of the Scene outline) shows the scene itself (light, look, reference image).

Everything has a name and a menu: double-click (or F2) renames a figure, prop or shot in the outline or in the inspector's title; right-click a figure or prop on the canvas, any outline row, a scene in the picker or a timeline key for what you can do with it (right-click empty floor to add something there). `Del` and `Ctrl D` delete and duplicate the selection. Both side panels fold away for more canvas (click the open section in the left rail; the panel button at the right of the top bar, or `I`, for the inspector).

On the server edition the AI assistant does any of these from a description ("two people at a café table; she gets up and walks to him; film it in three shots").

## Features

**Posing**
- **Direct manipulation**: the things are the handles. Drag a figure's torso (or a prop, or a stand-in) to move it on the floor, a limb, the neck or the head to swing it from its joint, a hand or a foot to move it with the limb following (two-bone IK), and the ring on the floor under the selected figure or prop to turn it (Shift: 15° steps). A click still selects; dragging empty space (or Alt-drag anywhere) orbits. The dots stay for finer control and keep a usable size on screen at any zoom: drag the purple hip dot to move the body while the feet stay planted (e.g. to drop into a squat), the small elbow and knee dots to point them.
- **Twist and fine-tune**: Shift-drag a part to twist it around itself (turn the head, roll a forearm), or a figure or prop to turn it. Hovering shows what a drag would move. Click any body part (or pick it on the body map) to fine-tune it with labelled sliders ("Swing − forward", "Raise + out", …); click a slider's value to type an exact angle.
- **Joint limits**: optional anatomical ranges keep poses natural (View tab → Joint limits).
- **Fingers**: five three-segment fingers per hand, with presets (relaxed, fist, point, peace, grip, …) and per-finger curl and spread.
- **Pose tools**: mirror, symmetrize left→right / right→left, copy/paste pose, reset, undo/redo (200 steps). Undo and redo switch to the pose they change, and deletions show a toast with an **Undo** button.
- **Figures from a photo** (Cast **+** menu): detects up to four people in a photo (MediaPipe, on-device) and poses figures to match, in a new scene or on the selected figure. The photo can stay on screen as a reference overlay.

**Figures and scenes**
- **Male and female anatomy**: the sex setting blends real secondary sex characteristics, not just scale. Male figures have broad shoulders over narrow hips, sculpted pectorals, a thicker neck, a squarer jaw, more muscular arms and calves and larger hands. Female figures have shoulders narrower than the hips, a defined waist, breasts, fuller glutes and thighs and a slender neck. Height, build, head size, leg length and chest can be adjusted too, or picked from presets (Female, Male, Athletic, Heroic, Slender, Child).
- **Multi-person scenes**: templates for two and three people (conversation, handshake, hand on shoulder, walking hand in hand, waltz hold, back to back, sparring, group photo), built with the same tools you can use yourself:
  - **Placement**: exact floor position and facing for each figure; the Move tool (`W`) moves whole figures; floor markers show where everyone stands and faces (click one to pick that figure).
  - **Relations** to another figure: turn to it, face each other, look at it (head, neck and if needed chest turn without tilting), stand beside it or back to back, set the distance, and **reach** a hand to its head, shoulder, chest, back, waist or hand (IK; tells you when it is out of reach).
- **Sculpted faces**: brow ridge, eyes, nose, cheekbones, lips, chin and ears are modelled into the head as one smooth surface, finished with a few quiet lines (eyelids, brows, lips), and differ between male and female figures. So you can always tell where a figure faces and looks. Turn them off in the scene's inspector (Look) for a plain construction head with centre and eye lines.
- **Stand-ins**: capsule figures for blocking a scene (extras, a crowd, where people will be), standing, sitting or lying. Place, turn and animate them like figures; turn one into a posable figure when it needs a real pose.
- **Scene outline**: the open scene's cast (figures, stand-ins), set (props) and shots, where you add, select, duplicate, hide and delete them. Hidden figures stay in the scene but are not drawn or exported.
- **Props**: box, ball, cylinder, chair, stool, step, wall and sports gear on the floor (a landing mat, a basketball hoop with its rim at 3.05 m, and high-jump uprights whose bar is at the prop's height: set it with Size Y), and a stick, gym hoop, gymnastics ribbon, phone, cup and book that go into the selected figure's hand (it closes into a grip). Sports gear is put ahead of the selected figure and turned to it: the hoop's board facing it, the bar and the mat across its way. Any small prop can be held (right-click it, or **Held by** in the inspector): it follows the hand through poses and animation, dragging it moves the hand, and **Let go** sets it down on the floor. Drag props to move them, turn them by their floor ring, move them up and down (`W`) and scale them (`R`) with the gizmo, or type X/Y/Z values (drag a field's letter to scrub). Turn off "Stand on the floor" to seat a figure on a prop.
- **A solid, endless floor**: the grid covers the whole floor; nothing goes through it (figures and props are kept on or above it, dragged limbs stop at it) and the view stays above it.
- **Library**: in groups (poses by posture, motions by kind, camera moves by where the camera goes); resting the pointer on an item shows a preview (the pose, the motion playing, the camera move filming your scene). The 20 reference poses from the drawing sheet and your saved poses (applied to the selected figure, where it stands), one-person motions, built in or imported (put on the selected figure's track at the playhead, from where it stands and facing its way), and camera moves (applied to the selected shot). Several-people motions open as new scenes.
- **Figure colours**: tint a figure (inspector swatches) to tell the people in a busy scene apart; the tint shows in every style and export.
- **Scenes**: a project holds any number of scenes; switch, search, reorder (drag or Alt+arrows), duplicate and delete them in the scene picker next to the scene name.

**Animation and camera**
- **Keyframe animation**: press **Animate** (or start from an animation template), move the playhead and pose: every edit is keyed at that time (auto-key). Keys are joined by smooth curves, loops wrap seamlessly, and a grounded figure bobs naturally as its legs bend. Each figure has its own key track: posing one figure keys only that figure, and its keys can be dragged to retime it while the others keep their timing (the timeline shows a row per figure; click a name to pick the figure). `Space` plays (at 1×, ½× or ¼× speed, or repeating just the shot under the playhead), `,` / `.` step a frame, `K` keys the selected figure. Onion skin (in the timeline's ⋯ menu, with looping) shows the previous and next keys as ghosts. The timeline zooms (`Ctrl` + wheel, or its zoom buttons) and scrolls (`Shift` + wheel, or the bar under it); `Shift`-drag a key to move it with all the keys after it (a pause put in or taken out), or drag a walk, run or jump bar to move the whole move. It folds down to its toolbar, and its top edge drags to make it taller; when it is narrow (a phone, or both panels open on a small screen) the less used buttons move into its ⋯ menu.
- **Walking, running and jumping from mark to mark**: with a figure selected, right-click the floor and pick **Walk here**, **Run here**, **Jump here** or **Step here, keeping facing** (side steps and backing up). The figure gets there in a natural time, its steps generated with the feet planted (no sliding), and the playhead waits at the new mark for the next one; marks in a row make one continuous path, shown on the floor with its footprints. Right-click a segment on the timeline to change how the figure gets to that key (glide as keyed, walk, run or jump), and for a jump its height and any turns or flips in the air. Jumps follow gravity and can land on, or start from, the top of a box or step; figures stand on props too. Keys inside a walk or run still pose the upper body (carry, wave, look around), so the generated legs and the posed arms play together.
- **Props over time**: in an animated scene, moving a prop keys it. A held prop rides in the hand; right-click it to **throw** it to a point on the floor (right-click the floor) or into another figure's hand (it flies in a ballistic arc and is caught), **toss it up and catch** it (a gymnast's hoop or ball), or to let it go (it falls). A held ball can be **dribbled** (the arm pumps it down and meets it on the way up; it bounces out to the side of the legs, on the run too) or **shot at a basketball hoop**: the shooter gathers it up in front of the face, the arm goes up to the hoop and follows through, and the ball goes through the rim and bounces on the floor, or off the front of the rim and back out. A **ribbon** trails its stick's tip through the air: where the tip has just been, falling as it goes, four metres long, lying on the floor where it reaches it. Each prop has its own row on the timeline.
- **Eyes on someone or something** (inspector or right-click a figure): a figure keeps its head turned to another figure or a prop as either moves.
- **Copy moves to** (right-click a figure): give another figure the same track, from where it stands. Keys snap to other figures' keys while dragging, to keep people in sync.
- **Motions** (Library): walk, run and jump ahead; dance groove, front kick, jab & cross, block & duck, take a hit, throw overhand, split leap, pirouette, cartwheel, fall & get up, wave hello and bow go on the selected figure's track; waltz turn, boxing exchange and clinch & takedown (two people) go on the selected figure, which leads, and the figure nearest it, which takes its place opposite (walking over first if it is keyed elsewhere; spaced for the bigger of the two), or, with nobody to partner, open as a new scene (the row's button opens one anyway); the high jump (a Fosbury flop: a run-up, a drive off one foot, back first over the bar and onto the mat, with its props) open as scenes with their own camera move.
- **Import motions** (Library → Motions → **Import motion…**): BVH (motion capture), FBX (e.g. Mixamo) or glTF/GLB animations are fitted onto the mannequin: bones are matched by name (Mixamo, CMU, Unreal, 3ds Max Biped, VRM, MakeHuman and similar rigs), the skeleton is stood upright and its travel is scaled to the figure. Imported motions are kept in **My motions** and apply like built-in ones.
- **Director's camera**: a shot camera with its own keys (orbit angle, height, lens, push-in and pan). Look through it with a 16:9 letterbox, frame a view and press the camera key, or pick a ready-made move: locked-off wide, push in, pull out, arc, 360° orbit, crane up, low-angle hero, tracking shot, dolly zoom and hand-held.
- **Camera path**: outside the shot camera, the viewport shows each shot's camera path and a camera at every key. Drag a camera around the figures to change that key's angle and distance.
- **Shots and cuts**: press `C` (or the scissors) to cut the timeline into shots; each shot has its own camera keys and move, a name and a caption (select it in the Scene outline or on the timeline to edit it in the inspector, with its camera move, follow and hand-held options). A shot frames everyone, or one **subject** it follows (shot inspector → Frames). **Cut for** a video model (Veo, Sora, Kling, Runway, Seedance, Hailuo, Luma, Wan) and shots longer than that model's clip limit are flagged.
- **Motion check**: one click plays the animation through and flags feet sliding while planted, figures passing through each other or through props (a leg swung through a bar between two frames too, or a thrown ball through someone), joints bent past their natural range, pops (a joint snapping in a frame) and figures hidden from a shot's camera behind props. Issues are marked on the timeline with a hint each; click one to jump to its frame and select the joint.
- **Shot description** (shot inspector): copy a plain-language description of each shot (framing, angle, lens, camera move, cast, action and length) for AI video tools.
- **Storyboard** (`B`): line poses up as numbered 16:9 panels, each framed by its pose's camera, with a caption and a hold time. Drag to reorder. Export a **board sheet** (PNG) or an **animatic** video in which each panel holds for its time, animated poses play and captions appear as subtitles.

**Output**
- **Seven render styles**, picked in the top bar; press `L` to cycle through them:
  - **Line art**: constant-width ink outlines, lines wherever parts meet, ball joints and contour lines, matching the reference sheet.
  - **Pencil**: graphite outlines with hand-drawn wobble and cross-hatched shading.
  - **Ink wash** (sumi-e): brush outlines of varying width with soft, bleeding ink washes on rice paper.
  - **Anime**: cel shading with a crisp shadow band, a highlight and rim light.
  - **Clay**: soft studio lighting with cast shadows, for value studies.
  - **Minimal**: flat shapes with a hairline outline.
  - **Silhouette**: solid shapes, for checking gesture and readability.
- **Scene lighting**: each scene has its own key light (the scene's inspector → Light, for the lit styles: Pencil, Ink wash, Anime, Clay): presets (studio, soft, side, backlit, noon sun, dusk, night), direction, height, brightness and warmth, with cast shadows where the style supports them. Props between the editor's camera and the selected figure turn see-through while you edit (clicks pass through them).
- **Export**: the current scene, a sheet of all scenes, the **pose library** as a reference sheet, a **turnaround** of the current scene from 4 or 8 evenly spaced angles, a **frame sheet** of an animation (a motion study), a **video** of the animation filmed by its shot camera (MP4 or WebM, 720p, 1080p, square or vertical), or a **keyframe pack** for AI video tools: a zip with the first and last frame of every shot (plus depth and normal passes for ControlNet-style conditioning), each shot's description and camera keys, a greybox clip per shot and an OpenTimelineIO cut list. Single images can be exported as depth or normal passes too, and the posed scene as a **3D model** (`.glb`) for Blender and other 3D tools. Sheets are JPG or PNG, in any of the seven styles. Columns, cell size, line weight, padding, captions, same-scale cells and transparent backgrounds are configurable. The pose library sheet reproduces `Pose.jpg` (2400 × 3200, 4 × 5 cells of 600 × 640).
- **Gesture practice** (`P`): a timed full-screen slideshow for figure-drawing warm-ups. 15 s to 10 min per pose (or untimed), shuffle, random camera angles, random mirroring, pause/skip with the keyboard. Practice a single pose from random angles, too.
- **Per-scene export camera**: stills of a scene use its own camera; set its angle and lens in the Export dialog (with a live preview), or take the editor's view.
- **Share links** (main menu): one scene, compressed into the URL fragment. Nothing is sent to a server.
- **Save / import** the whole project (scenes, storyboard, saved poses and motions) as JSON.

**AI assistant** (server edition)
- An **AI assistant** in the left rail (server edition): describe a pose, a scene or a shot ("two people shaking hands from a low angle", "animate a short jump and check it") and the assistant poses figures, places them, relates them, reaches hands to bodies, adds props and stand-ins, animates, picks camera moves and runs the motion check, using the same tools as you; every change can be undone.
- The model runs on the server with the server's Azure OpenAI or OpenAI key; signed-in users just chat, within a daily limit per user. The tools run in the browser on the open pose.

**Accounts and sync** (server edition)
- Sign in with Google or Microsoft. Your library and storyboard are saved to your account and follow you across devices; the browser copy stays the working copy, so editing works offline and syncs when you are back.
- Edits from two devices are merged pose by pose: a pose changed on one side wins, one changed on both keeps both (the other marked "this device"), and nothing edited is lost.

**App**
- Autosaves to browser storage (with a save-status indicator), flushes when the tab is hidden or closed, and warns you if storage is full.
- Several open tabs stay in sync: a tab adopts changes saved by another one instead of overwriting them.
- Works offline once loaded (service worker; production builds only) and can be installed as an app.
- A design-tool layout: on the left a rail with the Scene outline, the Library and the Storyboard workspace (click the open section to fold the panel away); the canvas tools (gizmo, View: camera angles, handles and grid, Frame all, render style) and the scene picker in the top bar, leaving the canvas clear (on phones the tools float at its bottom); an inspector on the right that edits the selection (a figure's pose, a prop, a shot) with Body / Render (and AI on the server edition) tabs. Icon buttons have tooltips with their shortcuts.
- First-run tips on the canvas (the core gestures, until dismissed), keyboard shortcuts (press `?`), a responsive layout with drawers on phones and tablets, touch-friendly dragging, accessible dialogs, menus and drop-downs (the app's own, not the system's), and an error screen if something crashes.

## Getting started

```bash
npm install        # also copies the MediaPipe runtime and downloads the pose model (~9 MB) into public/mediapipe
npm run dev        # http://localhost:3000
```

Requires Node 20.9+ and a browser with WebGL.

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Server edition: production build / server (see [Server edition](#server-edition)) |
| `npm run build:static` | Static edition: export to `out/` (see [Static hosting](#static-hosting--github-pages)) |
| `npm run db:migrate` | Apply database migrations (server edition) |
| `npm run check` | Type-check + lint + unit tests |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Browser tests (Playwright) against the server edition, with a fresh test database, a test sign-in and a mock AI. Builds and starts the app unless `BASE_URL` is set; set `PW_CHANNEL=chrome` to use an installed Chrome |
| `npm run setup:mediapipe` | Re-fetch the pose-detection assets (`-- --force` to re-download the model) |

## Server edition

Copy `.env.example` to `.env` and fill it in:

- `NEXTAUTH_URL` (the public URL) and `NEXTAUTH_SECRET` (e.g. `openssl rand -base64 32`).
- Sign-in: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and/or `AZURE_AD_CLIENT_ID` / `AZURE_AD_CLIENT_SECRET` / `AZURE_AD_TENANT_ID`. Each provider appears when it is configured. Redirect URIs: `{NEXTAUTH_URL}/api/auth/callback/google` and `{NEXTAUTH_URL}/api/auth/callback/azure-ad`.
- AI: `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY` and `AZURE_OPENAI_DEPLOYMENT` (or `OPENAI_API_KEY` and `OPENAI_MODEL`); `AI_DAILY_LIMIT` caps model requests per user per day (default 200). Without these the AI assistant (left rail) says it is not set up.
- `DATABASE_URL`: the SQLite file (default `file:./data/pose-studio.db`).

```bash
npm run db:migrate && npm run dev     # local development
docker compose up --build             # or the Docker image, database on a volume
```

`/api/auth/*` (NextAuth), `/api/library` (sync, with optimistic versioning) and `/api/ai` (the model proxy) are named `route.server.ts`, which only server builds include.

## Deployment

```bash
docker build -t pose-studio .
docker run -p 3000:3000 --env-file .env -v pose-studio-data:/data pose-studio
```

The image is the server edition. It applies pending database migrations on start (`scripts/migrate.mjs`, no Prisma CLI needed), keeps the SQLite database on the `/data` volume, uses Next.js standalone output, runs as a non-root user and has a `HEALTHCHECK` against `GET /api/health` (also usable as a liveness probe elsewhere). The pose model and WASM runtime are served from the app itself, so photo detection makes no third-party requests. If they are missing, it falls back to the jsDelivr / Google CDN. Responses carry a Content-Security-Policy and other security headers (see `next.config.ts`).

### Static hosting / GitHub Pages

The static edition is fully client-side: poses live in browser storage, share links live in the URL fragment and photo detection runs on-device. It needs no backend, so it can be exported as static files:

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
  Viewport.tsx          React Three Fiber canvas: selection, gizmo, line-art render loop
  Manipulators.tsx      Direct manipulation: drag figures, props and body parts, floor rings to turn, IK dots
  Inspector.tsx         The inspector: what is selected (figure, prop, shot) or the scene itself (light, look)
  side/                 Left side panel: the section rail and registry (sections.ts: add a section there), the Scene outline and the Library
  ScenePicker.tsx       The project's scenes, from the top bar
  menus.ts, ContextMenu.tsx  Right-click menus (one definition per kind of thing) and the host that shows them
  ShotInspector.tsx     Inspector for a selected shot
  BodyMap.tsx           Clickable body schematic for picking joints
  ui.tsx, icons.ts      Design-system components (icon buttons, menus, sections, fields) and icon mapping
  dialogs.tsx           Export, pose-from-photo and help dialogs
  Board.tsx             Storyboard workspace
  server/               Server edition only (imported as '@edition/server'; static builds get server/none.ts): account menu, sync, AI assistant
  Practice.tsx          Gesture-practice slideshow
  Timeline.tsx, clock.ts  Animation timeline and playback clock
lib/
  types.ts              Document model: Library → Scene → Figure / Prop
  store.ts              App state, undo/redo history, persistence
  actions.ts            All document operations used by the UI and shortcuts
  doc.ts                Factories, mirror/symmetrize, validation of untrusted JSON
  mannequin.ts          Procedural figure: male/female anatomy, fingers, IK, swivel, joint limits, grounding
  props.ts, hold.ts     Prop geometry; props held in a hand (grips, letting go)
  model3d.ts            The posed scene as a binary glTF model
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
  motions.ts            Motion library (animation templates)
  shot.ts               Shot camera: framing, camera keys, camera moves
  shots.ts, otio.ts     Cuts and per-model clip limits; OpenTimelineIO cut list
  qa.ts                 Motion check: foot slide, interpenetration (bone capsules), joint limits, pops, hidden from the camera
  pack.ts, zip.ts       Keyframe pack for AI video tools; a small store-only zip writer
  board.ts, boardExport.ts  Storyboard panels; board sheet and animatic export
  video.ts, prompt.ts   Frame-accurate video export (WebCodecs via Mediabunny); shot descriptions for AI video tools
  retarget.ts, photo.ts MediaPipe detection and landmark → joint retargeting
  locomotion.ts         Generated walking, running and jumping between keys: footstep plan, leg IK, jump arcs
  surfaces.ts           What figures stand on: the tops of props, seen from above
  propmotion.ts         Props over time: held, gliding, thrown (ballistic), falling
  importmotion.ts       Motion import: BVH/FBX/glTF bones matched by name and retargeted per frame
  share.ts              Share-link encoding (deflate + base64url in the URL fragment)
  poses.ts, apply.ts    The pose library; applying poses and motions to a figure
  agent/                AI assistant: tool registry and the browser side of a turn (tools run here, the model on the server)
  sync.ts, cloud.ts     Library sync: three-way merge per pose; the client that pulls, pushes and merges
  server/               Server-only: NextAuth options, Prisma client, AI upstream config
app/api/*/route.server.ts  Server edition API: auth, library, AI
prisma/                 Database schema and migrations (SQLite)
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
