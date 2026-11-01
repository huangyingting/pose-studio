# Pose Studio UI guide

How the interface is built, so that what comes next looks and works like what is there. Each rule
comes from a decision already made (the issue it came from is given where there is one). When a
new case is not covered, follow the nearest one here; when a rule has to change, change it here
first, then everywhere it applies.

## 1. Where things go

- **One home per feature.** Each thing is in exactly one place along the workflow: scene → cast
  and set → act → shoot → output. Before adding a control, find out whether it already has a home;
  remove a duplicate rather than adding an option. (Dev principles, #11.)
- **Every operation is a command** in `components/commands.ts` (`Command`: title, icon, keys,
  `when`, `run`, `checked`, `items` for choices, `help`). Menus, the command palette, keyboard
  shortcuts, tooltips (`tipOf`) and the help dialog all come from it. A new operation is a new
  command, never a handler on one button only. Menus are lists of command ids (`MENUS`), built
  when they open (`items={() => menu(...)}`).
- **Library categories and their items are data** in `components/side/libraryItems.ts` (one
  entry in `LIBRARY_CATEGORIES`; its bar in `LibraryBars.tsx`). One search (`searchLibrary`) serves
  the Library and the palette.
- **Inspector sections are one list** in `components/inspector/sections.tsx`: when a section
  shows, its title, whether it starts open, and the summary its header shows while folded. A new
  group of properties is one entry; its panel lives with its kind (`inspector/figure.tsx`,
  `action.tsx`, `camera.tsx`, `light.tsx`, …).
- **Layout:** the left rail switches the side panel's sections (the scene's outline, each Library
  category); the right side is the outline over the inspector; the top bar holds the project's
  settings (frame shape, render style) and Export; the timeline is always under the canvas.

## 2. Words

- **One name per thing, everywhere** (UI text and code): **Project** (the file), **Scene**,
  **Storyboard** (the scenes' order); **key**, never "keyframe" (the export "Keyframe pack" is a
  product name); no "film" as a noun. Before adding or renaming any text, search for the term
  already used and reuse it. (Naming, 2026-10-29.)
- **Short labels, the long text in the tooltip** or the `help`/`info` text. Labels are a word or
  two; a tooltip says what it does in one plain sentence.
- **Sentence case** ("Walk here", "Over the whole motion"), British spelling (colour, centre).
- **"…"** ends a label that opens a dialog, a prompt or a picker before anything happens
  ("Import motion…", "Rename…").
- **Plain words for what people do**, not engine terms: "Plays on the arms", "Fades over",
  "Between repeats", not "mask", "falloff", "seam". Code names may differ; what is shown may not.
- Empty states say what goes there and how ("Motions you import, or save from a Posed block,
  show here.").

## 3. Look: tokens only

- **Every colour is a token** in `app/globals.css` (`:root`, and `:root[data-theme='dark']` for
  the dark theme). Never write a colour literal outside the token block. Text: `--text`,
  `--text-2` (secondary), `--text-3` (tertiary); surfaces `--panel`, `--panel-2`, `--well`
  (sunken), `--raised`; `--accent` (and `-hover`, `-soft`, `-ring`); `--danger`, `--warn`, `--ok`;
  the axes `--axis-x/y/z`; the timeline's kinds `--walk`, `--run`, `--jump`, `--clip`, `--fix`.
- **Type:** Inter Tight; sizes only from `--fs-2xs … --fs-display` (10/11/12/13/14/16/19/25 px):
  `s` captions, hints and labels; `m` the body and controls; `l` panel and list titles. Weights:
  540 for the body, 600 for headings, titles and what is chosen; no others.
- **Sizes:** control heights `--control-s/m/l` (24/28/32 px); radii `--radius-xs/s/(base)/l/xl`
  (marks · controls · cards and menus · panels and dialogs · sheets); spacing in 4 · 8 · 12 · 16 ·
  24. Layers only from the `--z-*` list (its comment says what goes over what).
- **Icons:** lucide, 15–17 px at stroke 1.75 (CSS sets one stroke for all). An icon with no
  text always has an `aria-label` and a tooltip.
- **Chosen** is shown the same way everywhere: the raised white tile on a well (segmented,
  tabs), or the accent tint in toolbars.

## 4. Controls: which one

| For | Use (components/ui.tsx) | Notes |
|---|---|---|
| A yes/no property | `Toggle` | label + `hint`; on the right of its row |
| One of 2–4 short choices | `Segmented` | a radio group (one Tab stop, ← →); `full` to fill the row; `iconOnly` with labels as tips |
| One of more choices | `Select` | its list in a portal |
| A number | `NumberField` / `NumberInput` | prefix (unit or axis letter) scrubs when dragged; typed values clamp; every change is one undo step (`key`) |
| An amount 0–100 % | `Slider` | `display` shows the value as read ("50%") |
| A labelled property | `PropertyRow` (with `info`) | the label left, the control right |
| A group of properties | `Section` (from `sections.tsx`) | folds, remembers it; its header shows a summary while folded |
| A note under properties | `Hint` | `--fs-s`, `--text-3` |
| An action with an icon | `IconButton` / `CommandButton` | `CommandButton` takes a command id (its icon, title and keys) |
| A list of things to apply | the Library's rows or tiles | grid for things known by their shape (poses, sets), rows for things known by name (motions) |
| A choice of a few at once | a menu with `radio` items | `checked` shows the chosen |
| Something destructive | a menu item with `danger`, last, after a separator | |
| A dialog | `Modal` | for what needs several fields; not for one value (that goes inline or in a prompt) |

## 5. Tabs

- **A category's tabs** (Library → Motions: Mocap, Generated, Imported) are icon tabs: an icon
  each; **the chosen tab shows its icon and its name** and takes the room left; the others show
  their icon only. The row is as wide as the search above it, on the `--well` background with the
  chosen tab raised (`.lib-tabs`, `.lib-tab`). Each tab has a tooltip saying what it holds;
  `role="tablist"`/`role="tab"`, `aria-selected`, ← → between them. The chosen tab is remembered.
  A search looks in all the tabs. (2026-10-31.)
- **Choosing a property's value** is not a tab: use `Segmented`.

## 6. Menus, tooltips, popups

- **Everything on the canvas, in the outline and on the timeline has a right-click menu** (a
  long press on touch; Shift + F10 or the menu key from the keyboard). Its items are commands.
  A right-click selects what it is on, as a click would, so the inspector shows what the menu is for.
  Menus scroll with the wheel and show ▲ ▼ when they do not fit. A menu closes on a choice, a
  click elsewhere, Escape, or the focus gone elsewhere (a dialog a key opened is never under one).
- **A set is the floor where it stands**: its furniture or a wall right-clicked has the floor's
  menu for the spot at its foot, never the floor beyond it; a seat (met from any view, its back or
  its front as much as its top) has Sit here.
- **Tooltips** come from `data-tip` (with `data-tip-side`), shown by `components/Tooltip.tsx`; a
  command's tooltip is `tipOf(id)` (its title and its key). Every icon-only control has one; a
  disabled control's tooltip says why.
- **Menus and select lists open in a portal** placed by `placePopup` (on the screen, flipping to
  the side with room). Anything that closes on an outside click must ignore clicks `inPopup()`.

## 7. Keyboard and focus

- **Tab moves between areas and controls; arrows move inside a composite** (a list, a grid, a
  tab bar, a radio group, a toolbar), one Tab stop each (roving tabindex: `components/roving.ts`,
  `useRoving`, `rovingKey`, `menuKey`). Never a Tab stop per item. In the Library, moving only
  focuses; Enter applies. (#20.)
- **One focus ring:** `box-shadow: var(--focus)` (1.5 px, inset, following the radius); outline
  rows ring the row, Library tiles ring outside.
- **Keys follow the industry where it has an answer** (Ctrl snaps; Shift adds; Delete;
  Ctrl + C / V / D; Space plays; I / O range; S split; M marker), and Pose Studio's own quick
  edits stay too (arrow steps on any selection, X/Y/Z + ← →). When proposing something new, say
  which tool does it that way, and mark Pose Studio's own additions as such. (#13, #22.)
- **Keys act where the focus is:** the timeline's keys while it has the focus, the canvas's
  otherwise; a text field keeps its own keys.

## 8. Feedback and undo

- **Everything can be undone**, so things happen at once, without asking. Ask first only when
  what would be lost cannot be undone (shortening the animation: scale or cut).
- **Say what happened** with a toast: `notify` (an error is `'error'`), `notifyUndo` with an
  Undo button for what removes or replaces something ("Deleted “Wave”").
- **What is refused says why** (a locked row: "…row is locked"), as a toast, not silence.
- **While dragging, say what the drag does** next to what is dragged (the timeline's
  "Trim end · plays 0.00–2.10 s of …", the canvas's drag readout) and show the result live.
- **Things that take time** show that they are working (a button's busy state), and things that
  arrive later (a character, a set's models and textures) draw a stand-in until they do.

## 9. The canvas

- A hint for what is selected sits at the foot of the canvas (what a click and a drag do, a
  button for the next step); only its buttons take the pointer, so a handle under its words is
  still dragged. The selected thing has a label above it; dragging it is the main way to change it; its inspector has the exact values.
- Handles and gizmos are sized with the model (they shrink as the view zooms out), with thick
  lines; lines use `components/Line.tsx` (never drei's `<Line>`).
- **Tools** (#38): what a drag on a figure does is the tool's, shown in the bar at the canvas's top
  left and in the hint: **Pose** (Q, the default: a hand or foot reaches, the limb following, and with
  **Body follows** the shoulder and chest too; any other part swings from its joint; the hips sink or
  shift on planted feet), **Move** (W: any part places the whole figure on the floor, in an animated
  scene all it does, as Starts at; Shift turns it),
  **Rotate** (E: any part turns at its joint, hands and feet too). Props move in every tool. A new
  gesture goes into a tool, not into a new modifier. A hand or foot can be **Pinned** (its menu, its
  joint card): it stays where it is while the rest is posed, a blue mark on it.
- Picking something opens the inspector (a wide screen; on a phone it is a drawer, opened by hand).
- A figure's first click picks it, the next (it picked) the part under the pointer; a right-click
  does the same, its menu with that part's commands too (a stand-in, or with Move, the whole figure).
- What is not picked through the canvas (sets) is not selected by a click: it is where the floor
  is (see §6).
- Styles: a new render style is one entry in `lib/styles.ts`; what is drawn reads `styleDef`.

## 10. Tests

- e2e tests find things by role and name (`getByRole('tab', { name: 'Imported' })`): labels and
  `aria-label`s are part of the interface. Changing one means changing its tests.
- Locally: typecheck, lint, the related unit tests; e2e only to check what changed. CI runs
  everything on push.
