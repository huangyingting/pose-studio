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

1. **Scene**: start one from the scene picker in the top bar (blank, or from a scene template).
2. **Cast and set**: add figures, stand-ins and props in the **Scene** outline (left), and place them.
3. **Act**: give each figure actions: walk, run or jump to a mark (the **+** on its timeline row, or right-click the floor), a pose or a motion from the **Library**, a prop thrown or carried; every figure has its own track of action blocks on the timeline.
4. **Shoot**: place cameras, cut the timeline into shots and pick the camera each shot films with (a cut or a blend); select a shot in the outline to name it, caption it and give it a camera move.
5. **Output**: storyboard (the rail), export (sheets, video, keyframe pack).

The inspector on the right shows what is selected: a figure (pose, place, others, hands, body), an action (its timing, speed, people, how it gets there), a prop, a shot, a camera or the light; with nothing selected (`Esc`, the **Scene** crumb in its header, or the clapperboard button at the top of the Scene outline) it shows the scene itself (caption, the project's settings, reference image). Every inspector's header has the thing's menu (⋯), the same as its right-click menu.

Everything has a name and a menu: F2 (or the menu's Rename) renames a figure, prop or shot in the outline or in the inspector's title; right-click a figure or prop on the canvas, any outline row, a scene in the picker or a timeline key for what you can do with it (right-click empty floor to add something there); outline rows and timeline actions show the same menu on a ⋯ while the pointer is over them, and an inspector's ⋯ has it too. **Find a command** (`Ctrl K`, or the magnifier in the top bar) finds any command that applies to the selection (with its choices: "Eyes on: Kai"), the project's scenes and the Library's items by name. `Del` and `Ctrl D` delete and duplicate the selection. Both side panels fold away for more canvas (click the open section in the left rail; the panel button at the right of the top bar, or `I`, for the inspector).

On the server edition the AI assistant does any of these from a description ("two people at a café table; she gets up and walks to him; film it in three shots").

## Features

**Posing**
- **Direct manipulation**: the things are the handles (no dots on the body). A click selects a part; a **double-click selects the whole figure**. Drag a selected figure (or a prop, or a stand-in) to move it on the floor, a limb, the neck, the head, the waist or the chest to swing it from its joint (Ctrl: 5° steps), a hand or a foot to move it with the limb following (two-bone IK), the hips to move the body while the feet stay planted (e.g. to drop into a squat), and the ring on the floor under the selected figure or prop to turn it (Ctrl: 15° steps). Dragging empty space (or Alt-drag anywhere) orbits. A selected part has a small card beside its joint: a row per slider (Bend, Twist, Side, in the axes' colours) with − and + (5° a click, Shift 15°, repeating while held) and its value (click to type it); dragging the part itself turns it (Ctrl: 5° steps), and holding X, Y or Z while dragging turns only that slider. The Move gizmo is sized like the model (it shrinks as the view draws back), with thick lines. From the keyboard, with a part selected, hold X, Y or Z and press ← → to step its Bend, Twist or Side 5°; with the whole figure selected, Y with ← → turns it and X or Z with ← → lean it. A prop, or a figure picked as a whole, shows the Move gizmo (also up and down; `R` switches a prop's to scaling). **⟲ and ⟳** beside the selected figure's or prop's floor ring (or a rig camera, or the light's lamp) turn it 15° a click. **From the keyboard**, what is selected moves in steps (the hint lists the keys for it): the arrows move a figure, a prop or several things 5 cm the way the screen shows, Alt + ← → turns them 15°, Page Up / Down raises or lowers a prop (or a figure off the floor); with a joint selected the arrows go between joints (X, Y or Z held: its Bend, Twist or Side 5°); a path camera trucks, dollies and cranes with the arrows and Page keys and pans and tilts with Alt; a rig camera goes round its subject (← →), up and down (Alt ↑ ↓) and closer or wider (Page Up / Down); the light goes round (← →) and up or down (Page keys); looking through a camera, the keys move that camera. Shift takes three steps; in an animated scene a step is keyed at the playhead like a drag. **Tab** (with the focus on the canvas) selects the next thing in the scene (figures, props, cameras, the light), Shift + Tab the one before, bringing it into view if it is out of it; in the panels Tab moves the focus as usual. **A whole performance** moves as one, without a key (a track offset, as in Unity and Unreal): Ctrl + the arrows move everything a figure does (its keys, walks, marks, where its throws land), Ctrl + Alt + ← → turn it about where it is; the inspector's Placement has where it starts (X, Z, facing) to type, and its right-click menu Move the whole performance here / to…; those it shares an action with (a waltz, a bout) come too. **Ctrl** (Cmd on macOS) snaps every drag to steps, as in Blender and Unity: 5° on a joint, 15° on a floor ring, the 25 cm grid when moving (the Move gizmo too), 10 % when scaling; **Shift** drags a joint's slider finely.
- **Twist and fine-tune**: Shift-drag a part to twist it around itself (turn the head, roll a forearm), or a figure or prop to turn it. Hovering shows what a drag would move. Click any body part (or pick it on the body map) to fine-tune it with labelled sliders ("Swing − forward", "Raise + out", …); click a slider's value to type an exact angle.
- **Joint limits**: optional anatomical ranges keep poses natural (the lock in the top bar).
- **Fingers**: five three-segment fingers per hand, with presets (relaxed, fist, point, peace, grip, …) and per-finger curl and spread.
- **Pose tools**: mirror, symmetrize left→right / right→left, copy/paste pose, reset, undo/redo (200 steps). Undo and redo switch to the pose they change, and deletions show a toast with an **Undo** button.
- **Figures from a photo** (Cast **+** menu): detects up to four people in a photo (MediaPipe, on-device) and poses figures to match, in a new scene or on the selected figure (the others beside it, as they stood), keyed like any pose in an animated scene, with a **Photo camera** looking as the photo did. The photo can stay on screen as the scene's reference image.
- **Reference image** (the scene's inspector): a photo or drawing over the canvas to pose against, faded as you like; it is saved with the scene (synced with your account in the server edition) and never filmed or exported.

**Figures and scenes**
- **The mannequin**: Adobe Mixamo's Y Bot (a man) and X Bot (a woman), on the app's skeleton. A figure's body is just a man or a woman and a height (Body & colour in its inspector).
- **Scene templates** (Library → Templates, or the scene picker's New → From a template…): what is filmed, without how. A template is a cast, a set (props around a stage origin), what they do and the light; no coverage or cuts (only a plain camera seeing it), so any template can be filmed with any coverage. Built in: **films** staged beat by beat with the motion library (a wuxia duel, a stand-off, street basketball, a house party: who is where, the light, and what each does when, a block timed to the kick it meets), people standing together (conversation, handshake, hand on shoulder, walking hand in hand, waltz hold, back to back, sparring, group photo), several people's motions (a waltz turn, a group dance, a boxing exchange, a clinch and takedown) and set-ups with their props (the high jump). **Save scene as template** (in Templates, or the scene's ⋯ menu) keeps your own (they sync with your library). **Shoot presets** (Ready to shoot) pair a template with a coverage, by reference: the four films (each filmed its way: the duel as a fight, the stand-off as the officer and the man with the hostage), Interview, Closing the deal, The bout, First dance, Over the bar open as a new scene already filmed, cameras and cuts made. Make your own (**New shoot preset…**: a template, a coverage that fits its cast and, for a still template, a length; or **Save as shoot preset…** in a filmed scene's ⋯ menu, which keeps the scene as a template too): they are listed under My presets, sync with your library and go with their template if it is deleted. Click a template to open it as a new scene, or **put it into this scene**: its first role is taken by the selected figure (where it stands, facing its way), the others by the figures nearest it, new figures for the rest, its actions from the playhead. Templates of people standing together are built with the same tools you can use yourself:
  - **Placement**: exact floor position and facing for each figure; a double-click picks a whole figure to drag, or move up and down with its gizmo; floor markers show where everyone stands and faces (click one to pick that figure).
  - **Relations** to another figure: turn to it, face each other, look at it (head, neck and if needed chest turn without tilting), stand beside it or back to back, set the distance, and **reach** a hand to its head, shoulder, chest, back, waist or hand (IK; tells you when it is out of reach).
- **Stand-ins**: figures for blocking a scene (extras, a crowd, where people will be), standing, sitting or lying. Place, turn and animate them like figures; turn one into a posable figure when it needs a real pose.
- **Scene outline**: the open scene's cast (figures, stand-ins), set (props), cameras and shots, where you add, select, duplicate, hide and delete them. Hidden figures stay in the scene but are not drawn or exported.
- **Props**: box, ball, cylinder, chair, stool, step, wall and sports gear on the floor (a landing mat, a basketball hoop with its rim at 3.05 m, and high-jump uprights whose bar is at the prop's height: set it with Size Y), and a stick, gym hoop, gymnastics ribbon, phone, cup and book that go into the selected figure's hand (it closes into a grip). Sports gear is put ahead of the selected figure and turned to it: the hoop's board facing it, the bar and the mat across its way. Any small prop can be held (right-click it, or **Held by** in the inspector): it follows the hand through poses and animation, dragging it moves the hand, and **Let go** sets it down on the floor. Drag props to move them, turn them by their floor ring, move them up and down with their gizmo and scale them (`R`), or type X/Y/Z values (drag a field's letter to scrub). Turn off **On the floor** (Placement) to seat a figure on a prop.
- **A solid, endless floor**: the grid covers the whole floor; nothing goes through it (figures and props are kept on or above it, dragged limbs stop at it) and the view stays above it.
- **Library**: five categories as icon tabs (Templates, Characters, Poses, Motions, Camera), each in groups that fold (poses by posture, motions by kind, templates, camera moves by where the camera goes); poses and characters as a grid of thumbnails, the rest as rows. One search box finds items in every category (a header per category: click it for only that category's). Resting the pointer on an item shows a preview (the pose, the motion playing, the template, the camera move filming your scene). The 20 reference poses from the drawing sheet and your saved poses (applied to the selected figure, where it stands), motions, built in or imported (only what the people do, no camera or set: put on the selected figure's track at the playhead, from where it stands and facing its way; several people's on it and the nearest), characters to draw figures as, scene templates, and coverage and camera moves (applied to the selected shot).
- **Figure colours**: tint a figure (inspector swatches) to tell the people in a busy scene apart; the tint shows in every style and export.
- **Scenes**: a project holds any number of scenes; switch, search, reorder (drag or Alt+arrows), duplicate and delete them in the scene picker next to the scene name.

**Animation and camera**
- **Animation as actions**: the timeline is always under the canvas. A still scene's is just its bar: its first key (`K`) or first action makes the scene animated. Each figure's row has a **+** just after the playhead (and an empty one an **Add an action** button): a searchable picker of what it does next from there: walk, run, jump or step to a spot (then picked on the floor), a pose or a motion from the Library (with thumbnails), eyes on or holding on to someone, and what it can do with the prop in its hand. A pose or a motion dragged from the Library onto a row goes in at the time it is dropped at (a dashed block shows where, as long as the motion lasts); resting the pointer on one in the Library shows it as a ghost on the selected figure. Each figure's row on the timeline is its actions as blocks, coloured by kind: a walk, run or jump to a mark, a motion (a dance, a kick, a waltz of two), poses keyed by hand, an upper-body motion over another (a wave while walking). Click a block to edit it in the inspector (start, length, blend, speed, mirrored, who is in it, how it gets there); drag it to move it (what that person does after comes along), its right edge to retime it, the ramp before it to blend into it; right-click it for more. Changing one action never moves anyone else. Motions of several people show on each of their rows and move together. Releases and catches of props show as markers, with a line from each throw to where it lands or is caught.
- **Everyday beats**: the Library's Everyday motions now include Talk, Nod, Shake head, Point, Sit down and Stand up (onto a chair or step at about knee height, the feet planted) and Pick up / put down; a row's **+** lists them first.
- **New film** (the main menu, or the scene picker's New): *What are you filming?*: Empty, a shoot preset or a scene template (with thumbnails) and how long (15 s, 30 s, 1 min); it opens as a film of that length (a looping motion carries on, idle life fills the rest), the director filming it.
- **The director**: the timeline's **Director** menu films an animated scene in a style (Conversation, Follow the action, One take, Documentary, Sports, Fight: a wide shot, a low angle on each fighter and close ones, cutting to whoever strikes): its cameras placed on who is in it and its cuts made from what they do, and made again as that changes. A shot taken over by hand (cut, its cut moved, given another camera) is pinned and kept as it is (a pin on the Shots row); its menu's **Hand back to the director** lets it be cut again. **By hand** keeps the cameras and cuts as they are from then on. Its cameras keep out of anyone's reach (one that would stand in someone, or with someone right in front of the lens, swings round its subject).
- **Watching and exporting the film**: playing a scene with cameras plays it through its cuts, as filmed (the shot camera), and the editor's view comes back when it stops; one camera looked through or selected stays as it is. **Export** → **Video** films it.
- **Idle life**: in an animated scene no one stands frozen: in the gaps between what a figure does it breathes, sways a little and now and then looks at the nearest figure (shown faint as *idle* on its row). It plays and exports the same every time; while posing the figure shows the pose as keyed. Placement → **Idle life** turns it off for a figure.
- **Posing over time**: move the playhead and pose: the pose is keyed on that figure's track (auto-key, shown by a red edge on the posed figure's row and a ringed playhead); over a motion or a walk it becomes a correction to it (a badge names what is corrected), so the generated legs and the posed arms play together. Keys are joined by smooth curves, loops wrap seamlessly; a key's right-click menu sets how it **goes on to the next** (smoothly, at an even speed, or held until the next: a hollow diamond or a square on the timeline) and **holds this pose for** ½, 1 or 2 s (a copy of it then; what follows moves on). An action's menu (and the inspector) **repeats** it: a motion 2–4 times, a keyed block's keys copied 2–4 times in all (a keyed cycle walks on each time); **Save as a motion** keeps a keyed block in My motions, to give to any figure. A hand let go on a prop picks it up from the playhead; a selected hand's menu **lets go** of what it holds. `Space` plays (at 1×, ½× or ¼× speed, or repeating just the shot under the playhead), `,` / `.` step a frame, `K` keys the selected figure. Onion skin (in the View menu) shows the previous and next keys as ghosts. The timeline zooms (`Ctrl` + wheel, or its zoom buttons) and scrolls (`Shift` + wheel, or the bar under it); `Shift`-drag a key to move it with all the keys after it; `Shift`-click keys (or `Shift`-drag a box along a row) to pick several, then drag one of them to move them together. A Posed block's right edge retimes it like any block; a correction shows as a thin band of its own under the row, which its right edge retimes. It folds down to its toolbar, and its top edge drags to make it taller. **The timeline grows** with what is added: it shows a faint stretch of 2 s past the end where the playhead goes, and a key, an action or a motion put there lengthens the animation (up to 5 minutes); each row has a second **+ at the end of all the figure does** (the playhead goes there). Shortening the length field asks first: **Scale** everything into the new length, or **Cut instead** (the timing kept, what is past the new end gone).
- **Walking, running and jumping from mark to mark**: with a figure selected, pick **Move to…** in its inspector (Placement) and then a spot on the floor, or right-click the floor: **Walk here**, **Run here**, **Jump here** or **Step here, keeping facing** (side steps and backing up); with a prop in hand, **Throw to…** the same way, or **Carry** it (the arms keep still as the figure walks). The figure gets there in a natural time, its steps generated with the feet planted (no sliding), and the playhead waits at the new mark for the next one. Marks are numbered discs on the floor with the way the figure faces, joined by its path and footprints; drag one to move it (one of a motion of several people moves them all, as a formation). A motion stretches to reach its mark, up to ±25% and ±30°; further, the mark turns red and offers to move it back or walk the rest. Jumps follow gravity and can land on, or start from, the top of a box or step; figures stand on props too.
- **Contacts held on the actual bodies**: the hands of a waltz stay on the partner's back, a boxer's glove on the other's guard, whatever the bodies' sizes; feet planted in a motion stay planted. Every motion of several people (and a stretcher carried by two) is checked on every pairing of body presets; where two builds cannot do it together (a child leading an adult in a waltz hold), it is declined with the reason. Right-click a figure (or the inspector's **With others**) to **hold on to** someone else (a hand on a shoulder that stays as they walk), and let go later.
- **Props in actions**: a held ball is **passed** (the arms push it out; it flies with physics and is caught if the catcher's hand can reach it then, which the motion check reports otherwise), **shot** at a basketball hoop (through the rim, or off it with "off the rim", rolling away), **dribbled** (bouncing beside the legs, on the run too) or **tossed up and caught** (a gymnast's hoop). Anyone else can **take it**: a relay baton handed on, or a pass cut off in the air. A long box carried by its handles stays level (a stretcher or a bench: one carries it, another **takes the other end**, someone **lies on it**). Throws, bounces and rolls are simulated (Rapier physics, baked once). A **ribbon** trails its stick's tip through the air. Each prop has its own row on the timeline: in whose hand, flying, resting.
- **Eyes on someone or something** (inspector or right-click a figure; **What you click…** picks it on the canvas): a figure keeps its head turned to another figure or a prop as either moves.
- **Relations by pointing**: drag a hand onto someone else (or onto a prop, to pick it up) and let go: it snaps to the nearest point a hand can hold (head, shoulder, chest, back, waist or hand; the hint says which) and holds on there from the playhead (in a still scene it just reaches there). **Hold on to → Where you click…** and a held prop's **Give to → Whom you click…** pick on the canvas the same way.
- **Several things at once**: Shift-click figures and props (on the canvas or in the outline) to select them together; drag one to move them all, Shift-drag to turn them about their middle; `Ctrl D` duplicates them, `Del` deletes them (one undo step each); the inspector says how many and what can be done to all of them.
- **Copy moves to** (right-click a figure): give another figure the same track, from where it stands.
- **Motions** (Library): walk, run and jump ahead; dance groove, front kick, jab & cross, block & duck, take a hit, throw overhand, split leap, pirouette, cartwheel, fall & get up, wave hello, carry and bow go on the selected figure's track; waltz turn, boxing exchange, clinch & takedown and a group dance of four (listed under **Together**) go on the selected figure, which leads, and the figures nearest it, which take their places (walking or running over first if there is time, or else going straight there from where they were headed); the high jump opens as a scene with its own props. A one-person motion can also play from the waist up over what a figure does (the row's layers button).
- **Motion library**: besides the built-in motions, Library → Motions lists 107 motion-capture clips (walks and runs that loop, stairs, fights, sport, dances, idles, sitting, talking, emotions), each one person's, in the same groups; each is fetched the first time it is shown or used. They are files in `public/motions`, made by `npm run motions` from `.clip.json` clips (as **Import motion…** makes them) in `data/library/motions`: each person faces where they look (a captured stance is often turned at the pelvis), the wrists' roll is the forearms', walk and run cycles are levelled and loop, and one that is another mirrored is left out (play it **Mirrored**). People together each get their own motion (a template or film puts them in step).
- **Import motions** (Library → Motions → **Import motion…**): BVH (motion capture), FBX (e.g. Mixamo) or glTF/GLB animations are read bone by bone onto the skeleton (fingers and toes too): bones are matched by name and the rig's shape (Mixamo, CMU, Unreal, 3ds Max Biped, VRM and similar rigs; a dialog matches any it cannot name), the skeleton is stood upright and its travel is scaled to the figure; where the feet are planted is found so they stay planted. A file with several people becomes one motion for them all. Each person faces where they look and the wrists' roll goes to the forearms, as for the Library's. Imported motions are kept in **My motions** and apply like built-in ones.
- **Characters** (Library → **Characters**): fifteen come with the app (a man and a woman, a child; Aoi, an anime girl in her own toon look in the Toon style, Ueda's VRM avatar made one of ours by `scripts/vrm-character.py` (for personal, non-profit use with credit); ten of Adobe's Mixamo characters, named by their roles (a jogger, a businessman, a construction worker, a knight, an archer…), in their own colours, made by `scripts/characters/import.ts`; and one of Sketchfab's, a life model (CC BY), rigged by `scripts/characters/rig.py`; see Credits), each at its own height, fetched the first time a figure is drawn as one; or import a character with a skeleton (VRM, glTF/GLB or FBX: VRoid, Mixamo…) and draw any figure as it (or pick it in the inspector's **Body**). It is posed and animated exactly as the mannequin would be (A-poses and T-poses alike, at the figure's size), its fingers from the hand presets; the mannequin stays, unseen, to pick and pose it by. A **VRM avatar** (VRoid Studio's, and the like) is made our own as it is imported: its skeleton from its humanoid (VRM 1.0 or 0.x), its look from its MToon materials (for the Toon style), and who made it and on what terms, shown with it; it is kept in your own library only. Any other character painted with textures is drawn in its own colours in the Toon style too; choose its texture files with it if they are separate (an FBX or a .gltf with its files is kept as one GLB).
- **Cameras**: the scene's cameras are objects of their own, listed in the Scene outline (Cameras) with an inspector each, still or animated (every scene has at least one; a new scene's frames everyone); shots film with them, as in Unreal's Camera Cuts or Cinemachine. Each camera has a path: points the camera passes through, each with where it looks and its **lens** in millimetres (full frame: 14 mm wide … 50 mm normal … 200 mm telephoto). A path is fixed in the scene (a track, a crane) or **rides along** with the camera's subject (a tracking shot); the camera looks at the subject, at a point, or ahead along the way; it eases through its points or keeps an even pace, steady or hand-held. Or a camera places itself every frame from its subject's body: it **follows** it (moving with it, or turning with it too) or **circles** it, holding its angle (from the subject's front, + from its left, or from the line towards another figure) and its shot size, smoothed over a time window; the shot holds when the blocking or a body changes, and the set-up works in any scene. Ready-made moves to start from: locked-off wide, push in, pull out, arc, 360° orbit, circle the subject, crane up, low-angle hero, tracking shot, follow behind, leading shot, dolly zoom and hand-held.
- **Coverage** (Library → Camera): film the whole animation the way a director plans coverage, with cameras on roles and cuts on what happens. **Conversation** (a master two-shot, over-the-shoulder shots and singles), **Follow the action** (wide, tracking when they set off, close for what they do on the spot, from behind) and **Sports** (wide, cutting to the one who gets the ball as it is let go, tracking a run). A is the selected figure and B the one nearest it; every camera keeps to one side of the line between them. The cameras place themselves, so they keep framing when the blocking changes; apply the coverage again to cut anew (cameras edited by hand since are kept).
- **Shot sizes and lenses**: at the playhead, frame the subject at a shot size (extreme wide, wide, full, medium wide, medium, medium close-up, close-up, extreme close-up), centred or on a third; change the lens keeping the subject's size (the camera moves, as in a dolly zoom) or keeping the camera where it is (a zoom).
- **Editing the path**: outside the shot camera, the viewport shows every camera where it is at the playhead, and each path camera's path with a small camera at each point (click one to select its camera; right-click for its menu). Drag a camera across the floor (Shift: up and down), drag its look point to aim it, double-click the path to add a point; on the timeline, the camera row shows the selected camera (or the one filming at the playhead): drag a point to retime it. **Look through** the shot camera (the cut) or one camera from the View menu, or a camera's menu or inspector; orbit, pan or dolly the view and let go: that becomes that camera's point at the playhead. Turn on **Framing guides** (View menu) for thirds and safe areas.
- **Cameras on the canvas**: the selected camera (and the one the pointer rests on) draws its view cone out to what it looks at, and its picture plays live in the canvas's bottom-right corner (with its name and lens; click it to look through). A path camera that aims at its subject or along its path shows where it looks as a dashed line. A rig camera, selected, has a ring on the floor round its subject (drag it round: "from the front, 30° left"; Ctrl: 15° steps) and a handle above its foot for its height; the wheel over it steps its shot size (Shift + wheel: its lens). Looking through a camera, a red banner says so ("Moving Camera 2 at 1.50 s · Esc to stop": orbiting moves it, `Esc` stops looking through), the shot sizes are chips in the picture, a rig camera's subject is a marker to drag onto a third or the middle, and `C` cuts a new shot here filmed by a new camera as the view is.
- **Shots and cuts**: press `C` (or the scissors) to cut the timeline into shots, and drag a cut to move it; the new shot films on with the same camera until you pick another for it (or a **new camera from the view**) in the shot's inspector or its menu (Film with). A shot **cuts** to its camera, or **blends** in from the one before over a time you set (drag the ramp at its start). Each shot has a name and a caption; its camera frames everyone, or one **subject**. The shot inspector shows its camera as one row (name, size, lens, how it moves): click it for the camera's own inspector, where the camera is set up. All shots share the film's settings (**Project settings** in the main menu): a **frame**: 16:9, 9:16 vertical, 1:1 square or 2.39:1 cinemascope; the letterbox, videos and keyframe packs follow it. **Cut for** a video model (Veo, Sora, Kling, Runway, Seedance, Hailuo, Luma, Wan) and shots longer than that model's clip limit are flagged.
- **Motion check**: one click plays the animation through and flags feet sliding while planted, figures passing through each other or through props (a leg swung through a bar between two frames too, or a thrown ball through someone), joints bent past their natural range, pops (a joint snapping in a frame) and figures hidden from a shot's camera behind props, and the camera going through someone or something. Issues are marked on the timeline with a hint each; click one to jump to its frame and select the joint.
- **Shot description** (shot inspector): copy a plain-language description of each shot (framing, angle, lens, camera move, cast, action and length) for AI video tools.
- **Storyboard** (`B`): the story, shot by shot: the project's scenes in story order (add any of them from the board), an animated scene as a numbered panel per shot (through its camera, with its caption and length), a still scene as one panel held for as long as you set. Drag a panel to move its scene. **Export** opens the Export dialog on the story: a **board sheet**, one **story video** of every scene's shots in order (captions as subtitles), or a **story keyframe pack** with one cut list.
- **The film's settings**, for the whole project: the render style (in the top bar), and in **Project settings** (the main menu, or the link at the top of the scene inspector) the frame shape and the video model it is cut for. The canvas, the storyboard and every export follow them; they sync and travel with the project file (a share link takes the receiving project's).

**Output**
- **Seven render styles**, the project's, picked in the top bar; press `L` to cycle through them (an export can pick another for itself):
  - **Line art**: constant-width ink outlines, lines wherever parts meet, ball joints and contour lines, matching the reference sheet.
  - **Pencil**: graphite outlines with hand-drawn wobble and cross-hatched shading.
  - **Ink wash** (sumi-e): brush outlines of varying width with soft, bleeding ink washes on rice paper.
  - **Anime**: cel shading with a crisp shadow band, a highlight and rim light.
  - **Toon**: toon shading in each character's own colours and textures: a VRM avatar as it was made (its painted face, hair and clothes, its shade colours and where its shadow edge falls, its rim light and outlines, in our own MToon-like shader); the mannequin and props in toon colours.
  - **Clay**: soft studio lighting with cast shadows, for value studies.
  - **Minimal**: flat shapes with a hairline outline.
  - **Silhouette**: solid shapes, for checking gesture and readability.
- **Scene lighting**: each scene has its own key light, for the lit styles (Pencil, Ink wash, Anime, Toon, Clay). Select it from the **Light** row of the Scene outline, or click its lamp on the canvas (drawn as simply as a camera, aimed at the scene): selected, the lamp rides a dome over the scene with its rays towards the middle; drag it (the shadows follow, the readout says "40° from the front-left, 45° high"). **Alt-click** a figure to light it from where you look (or **Light from this view** in the light's menu). Its inspector has presets with a thumbnail each (studio, soft, side, backlit, noon sun, dusk, night), direction, height, brightness and warmth, and shadows where the style casts them; in Line art, Minimal or Silhouette it says where light shows and switches to Clay. Props between the editor's camera and the selected figure turn see-through while you edit (clicks pass through them).
- **Export** (`Ctrl E`; one list of outputs: stills, film, 3D): the current scene, a sheet of all scenes, the **pose library** as a reference sheet, a **turnaround** of the current scene from 4 or 8 evenly spaced angles, a **frame sheet** of an animation (a motion study), a **video** of the animation filmed by its shot camera (MP4 or WebM, 720p, 1080p, square or vertical), or a **keyframe pack** for AI video tools: a zip with the first and last frame of every shot (plus depth and normal passes for ControlNet-style conditioning), each shot's description and the camera's path over it, a greybox clip per shot and an OpenTimelineIO cut list. Single images can be exported as depth or normal passes too, and the scene as a **3D model** (`.glb`) for Blender, game engines and other 3D tools: an animated scene comes with an animation per person, one for the props and one for the shot camera. Sheets are JPG or PNG, in any of the seven styles. Columns, cell size, line weight, padding, captions, same-scale cells and transparent backgrounds are configurable. The pose library sheet reproduces `Pose.jpg` (2400 × 3200, 4 × 5 cells of 600 × 640).
- **Gesture practice** (`P`): a timed full-screen slideshow for figure-drawing warm-ups. 15 s to 10 min per pose (or untimed), shuffle, random camera angles, random mirroring, pause/skip with the keyboard. Practice a single scene from random angles, too (an animated one: its moments, spread over it). Practice has its own style and face-features switch.
- **Exports film through the scene's cameras**: a still is taken by the camera filming at the playhead (a still scene: its first camera), or another camera picked in the Export dialog (with a live preview); "New camera from the editor view" makes the view you are looking from into a camera.
- **Share links** (the scene's ⋯ menu, in the scene picker): one scene, compressed into the URL fragment. Nothing is sent to a server.
- **Save / Add scenes… / Open…** (main menu): the whole project (scenes, storyboard, saved poses, templates, imported motions) as JSON. The save indicator by the scene name says it is saved in this browser and, signed in, synced to your account.

**AI assistant** (server edition)
- An **AI assistant** in the left rail (server edition): describe a pose, a scene or a shot ("two people shaking hands from a low angle", "animate a short jump and check it") and the assistant poses figures, places them, relates them, reaches hands to bodies, adds props and stand-ins, gives figures actions (walks, motions, passes, shots, holds) and edits them as you would on the timeline (retime, move, blend, move a mark), picks camera moves and runs the motion check, using the same tools as you; every change can be undone.
- The model runs on the server with the server's Azure OpenAI or OpenAI key; signed-in users just chat, within a daily limit per user. The tools run in the browser on the open pose.

**Accounts and sync** (server edition)
- Sign in with Google or Microsoft. Your library and storyboard are saved to your account and follow you across devices; the browser copy stays the working copy, so editing works offline and syncs when you are back.
- Edits from two devices are merged pose by pose: a pose changed on one side wins, one changed on both keeps both (the other marked "this device"), and nothing edited is lost.

**App**
- Autosaves to browser storage (with a save-status indicator), flushes when the tab is hidden or closed, and warns you if storage is full. Imported motions and characters are kept apart, in IndexedDB (and, signed in, as files on the server), so a library with dozens of them stays small.
- Several open tabs stay in sync: a tab adopts changes saved by another one instead of overwriting them.
- Works offline once loaded (service worker; production builds only) and can be installed as an app.
- A design-tool layout: on the left a rail with the Scene outline, the Library and the Storyboard workspace (click the open section to fold the panel away); a top bar: on the left the joint-limits lock, the View menu (Frame all, isolate, what to look through and what shows; the angles are on the view widget and keys 1–6) and the project's render style, then the hint, then the scene's name and picker with its save state, and undo, Export and the inspector toggle on the right (on narrower screens the less used ones fold into a ⋯ menu), leaving the canvas clear (on phones the tools float at its bottom); the hint in the top bar says what dragging (Shift-dragging, clicking) what is under the pointer does, a pick in progress, or a next step for where the scene is (add a figure, pose it, make it walk, cut into shots, a second camera, the motion check), with its command as a button (one dismissed does not come back for that scene); an inspector on the right that edits the selection (a figure, a prop, an action, a shot, a camera), or the scene when nothing is selected, in sections that fold (a folded one says what is in it). Both side panels are as wide as you drag their inner edge (each left section keeps its own width; double-click the edge for the panel's own). Icon buttons have tooltips with their shortcuts, and things with a menu say so.
- **Adding is placing**: a figure, stand-in or prop from the Scene outline's + menus, or a template's "put into this scene", follows the pointer as a ghost on the floor: it snaps to the 25 cm grid (Alt: off it) and beside or facing the nearest figure (the hint says which), the wheel or `R` turns it 15° at a time, a click drops it, `Esc` cancels; a hand prop goes into the hand of the figure clicked, a template's first role onto the figure clicked. Chosen from the keyboard, or right-clicking the floor, it is put there at once (and framed if out of view). `F` frames the selection (everything when nothing is selected); double-clicking an outline row frames that thing.
- **The selection on the canvas**: what is selected is named next to it ("Kai · Left forearm"). Its operations are in its right-click menu (on touch, a long press): a joint's menu also resets it, mirrors it to the other side and goes to the joint above or below; a prop's gives it to someone; a camera's sets it from the view, points it here, and picks its shot size and lens. With a joint selected, ↑ ↓ go to the joint above or below and ← → to the other side.
- **The canvas**: the world's axes are red (X), green (Y) and blue (Z) everywhere: on the Move gizmo, on the X / Y / Z fields and on the view widget in the canvas's top-right corner, the axes as the view sees them, whose ends turn the view to look from there (front, back, either side, above; ¾ beside them; as the keys 1–6). While something is dragged, a readout beside the pointer says how far it has moved and where it is (and, for a figure, how far it is from the nearest other one), how far it has turned, a part's slider and value ("Left forearm · Bend −42°"), or how high it is (with a dashed line down to the floor); **Isolate** (`/`, or the View menu) shows only the selected figure or prop until pressed again (the scene, its cameras and exports are not affected). Resting the pointer on a row of the Scene outline outlines that figure, prop or camera on the canvas, and resting it on one on the canvas marks its row. Library items can be dragged onto what they apply to: a pose, a motion or a character onto a figure, a template onto a figure (its first role) or the floor (new figures there), a camera move onto a shot on the timeline; and from the Set's + menu, a prop onto the floor (a handheld one onto a figure).
- **A dark theme**: the chrome goes dark (the canvas keeps its render style's colours); it follows the system setting, or pick it under Theme in the main menu.
- Keyboard shortcuts (press `?`, or the main menu), a responsive layout with drawers on phones and tablets, touch-friendly dragging, accessible dialogs, menus and drop-downs (the app's own, not the system's), and an error screen if something crashes.

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
| `npm run check` | Type-check + lint + unit tests + the slow ones |
| `npm test` | Unit tests (Vitest), without the slow ones |
| `npm run test:related` | The unit tests that import what has changed since the last commit |
| `npm run test:slow` | The slow unit tests: motions on every build and pair of builds, coverages on every build, whole films and scenarios (most of the time; CI runs them on every push) |
| `npm run test:e2e` | Browser tests (Playwright) against the server edition, with a fresh test database, a test sign-in and a mock AI. Builds and starts the app unless `BASE_URL` is set; set `PW_CHANNEL=chrome` to use an installed Chrome |
| `npm run setup:mediapipe` | Re-fetch the pose-detection assets (`-- --force` to re-download the model) |

## Server edition

Copy `.env.example` to `.env` and fill it in:

- `NEXTAUTH_URL` (the public URL) and `NEXTAUTH_SECRET` (e.g. `openssl rand -base64 32`).
- Sign-in: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and/or `AZURE_AD_CLIENT_ID` / `AZURE_AD_CLIENT_SECRET` / `AZURE_AD_TENANT_ID`. Each provider appears when it is configured. Redirect URIs: `{NEXTAUTH_URL}/api/auth/callback/google` and `{NEXTAUTH_URL}/api/auth/callback/azure-ad`.
- AI: `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY` and `AZURE_OPENAI_DEPLOYMENT` (or `OPENAI_API_KEY` and `OPENAI_MODEL`); `AI_DAILY_LIMIT` caps model requests per user per day (default 200). Without these the AI assistant (left rail) says it is not set up.
- `DATABASE_URL`: the SQLite file (default `file:./data/pose-studio.db`).
- `ASSETS_DIR`: where users' imported motions are kept, one file each (default: `assets/` next to the database).

```bash
npm run db:migrate && npm run dev     # local development
docker compose up --build             # or the Docker image, database on a volume
```

`/api/auth/*` (NextAuth), `/api/library` (sync, with optimistic versioning), `/api/assets` (imported motions' frames, synced apart from the library) and `/api/ai` (the model proxy) are named `route.server.ts`, which only server builds include. In the browser, imported motions are kept in IndexedDB, the library in localStorage.

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
  Manipulators.tsx      Direct manipulation: drag figures, props and body parts (IK hands and feet, the hips on planted feet), floor rings to turn
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
  Timeline.tsx, clock.ts  Timeline of action blocks per figure, props' rows, shots, camera; playback clock
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
  actions.ts            All document operations used by the UI and shortcuts
  doc.ts                Factories, mirror/symmetrize, validation of untrusted JSON
  mannequin.ts          Procedural figure: male/female anatomy, fingers, IK, swivel, joint limits, grounding
  props.ts, hold.ts     Prop geometry; props held in a hand (grips, letting go)
  model3d.ts            The scene as a binary glTF model, animated
  sceneview.ts          Keeps three.js objects in sync with a Scene (shared by editor and exporter)
  styles.ts             Render style definitions (outline, rings, interior lines, background, lighting)
  ink.ts, shaders.ts    Outline hulls with brush jitter, per-style materials, pencil / ink-wash / anime shaders
  lineart.ts            Part-ID edge pass for the lines where body parts meet
  lighting.ts           Key light + shadow-catching floor for the lit styles (editor and export)
  render.ts             Camera fitting, off-screen rendering, sheet / turnaround export
  practice.ts           Gesture-practice session building
  relations.ts          Spatial relations between figures: facing, spacing, look-at, reach
  stagings.ts           How several people stand together (for templates and motions)
  templates.ts          Scene templates: cast, set, actions and light; placed into a scene
  animation.ts          Animation documents: frames, prop keys, cameras and shots
  motions.ts            Motion library: what people do, no camera or set
  cameras.ts            Cameras: paths, framing, shot sizes, lenses, camera moves; the camera filming at a time
  shots.ts, otio.ts     Cuts and per-model clip limits; OpenTimelineIO cut list
  coverage.ts           Coverage: cameras on roles (master, singles, over-the-shoulder, tracking) and cutting rules
  qa.ts                 Motion check: foot slide, interpenetration (bone capsules), joint limits, pops, hidden from the camera
  pack.ts, zip.ts       Keyframe pack for AI video tools; a small store-only zip writer
  board.ts, boardExport.ts  The story (scenes in order, shot by shot); board sheet and story video
  film.ts               The project's film settings (frame, video model, style)
  video.ts, prompt.ts   Frame-accurate video export (WebCodecs via Mediabunny); shot descriptions for AI video tools
  retarget.ts, photo.ts MediaPipe detection and landmark → joint retargeting
  locomotion.ts         Generated walking, running and jumping between keys: footstep plan, leg IK, jump arcs
  surfaces.ts           What figures stand on: the tops of props, seen from above
  propmotion.ts         Props over time: held, flying, resting; releases, catches, handoffs, handles
  importmotion.ts       Motion import: BVH/FBX/glTF read bone by bone onto the skeleton (several people: several parts)
  share.ts              Share-link encoding (deflate + base64url in the URL fragment)
  poses.ts, apply.ts    The pose library; applying poses and motions to a figure
  agent/                AI assistant: tool registry and the browser side of a turn (tools run here, the model on the server)
  sync.ts, cloud.ts     Library sync: three-way merge per pose; the client that pulls, pushes and merges
  server/               Server-only: NextAuth options, Prisma client, AI upstream config
app/api/*/route.server.ts  Server edition API: auth, library, assets (imported motions and characters), AI
prisma/                 Database schema and migrations (SQLite)
app/api/health          Liveness endpoint
public/sw.js            Service worker (offline cache)
tests/unit              Vitest: model, IK, limits, retargeting, store/history, share links, export, practice, relations, templates,
                        films, every template × coverage × body, every motion of several people × pairing of builds
tests/e2e               Playwright: real-browser flows incl. IK drags, export/turnaround sizes, photo posing, practice,
                        undo toasts, typed angles, library keyboard reordering, cross-tab sync, mobile
```

### Rotation conventions

The figure faces +Z, and its left is +X. Poses are stored as each bone's turn (a quaternion, glTF order x, y, z, w) relative to the VRM T-pose, local to its parent. The sliders, joint limits and the assistant use each joint's angles in degrees, with the arms hanging down at zero (root `YXZ`, all others `XZY`):

| Joint | X | Y | Z |
| --- | --- | --- | --- |
| root | pitch (+ forward) | turn (+ left) | roll (+ right) |
| spine / chest / neck / head | bend (+ forward) | twist (+ left) | tilt (+ right) |
| shoulder / hip | swing (− forward) | twist | raise / spread (+ out on the left, − on the right) |
| elbow / knee / ankle | bend (− / + / + points toes) | twist | side |

## Limitations

- Pose detection needs photos of real people. Line drawings, including the reference sheet itself, are not recognised.
- Hands are posed with curl/spread controls; per-knuckle rotation comes only from imported motions.

## Credits

The built-in characters (`public/characters`) are Quaternius's [Universal Base Characters](https://quaternius.com/packs/universalbasecharacters.html) (the free Standard version): the male and female base bodies, packed as small GLB files (without their textures). The child was made from MakeHuman's base mesh, targets and rig with [MPFB](https://github.com/makehumancommunity/mpfb2). These are [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain). The life model is "Male body base mesh (highpoly)" by [Mandrake](https://sketchfab.com/mandrake_3d), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), rigged here. See `public/characters/CREDITS.txt` for all of them (Aoi and Mixamo's too).
