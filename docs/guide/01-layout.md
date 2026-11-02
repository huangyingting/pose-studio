# 1. Finding your way around

![The studio with a scene open](images/layout.png)

1. **Main menu**: new scene, open and save the project, add scenes from a file, the theme, keyboard shortcuts.
2. **View, Frame and Render style**, then the canvas's tools (7):
   - **View** has framing (frame all, isolate), what to look through, what shows, onion skin and joint limits.
   - **Frame** is the project's picture shape: 16:9, 9:16, 1:1 or 2.39:1.
   - **Render style** is the project's look, from Line art to 3D (`L` cycles through them).
3. **The scene**: its name (click to rename), the scene picker (▾: switch, search, reorder, duplicate, share) and whether it is saved.
4. **Undo, redo, Find a command (`Ctrl K`), Export (`Ctrl E`)**, and the button that shows or hides the inspector (`I`).
5. **The rail**: the side panel's sections. From the top, they are:
   - the **Scene** outline;
   - the Library's **Characters**, **Poses**, **Motions**, **Sets** and **Lighting**;
   - the **AI assistant** (server edition);
   - the **Storyboard**.
   Clicking the open section folds the panel away.
6. **The side panel**: here the **Scene** outline, which lists what is in the scene: cast, set, cameras, lights and shots. Each heading's **+** adds one; right-click a row for its menu; double-click a row to frame it on the canvas.
7. **The canvas's tools**, icon buttons in the top bar (rest the pointer on one for its name, what a drag does and its key): **Scene only** (the scene filling the window; `Esc` or the button in its corner to come back), then the tools for what is selected. A figure has **Pose** (`Q`), **Move** (`W`), **Rotate** (`E`) and **Body follows**; see [Posing](02-posing.md). A prop has **Move** and **Scale** (`R`). A camera or a light has no tools here; its own handles and its inspector edit it.
8. **The view gizmo**: the world's axes in 3D as the view sees them, always the same size. **Drag it** to turn the view; **click an axis end** to look from there (the end under the pointer grows). The keys `1`–`6` do the same, `6` giving a three-quarter view. Dragging empty space on the canvas also turns the view, and the wheel zooms. On the floor, the red line is the X axis and the blue line the Z axis, so you can tell which way is which.
9. **The inspector**: what is selected, with everything about it in sections that fold. A folded section says what is in it. With nothing selected (`Esc`), the inspector shows the scene itself. Its header has the thing's menu (⋯), the same as its right-click menu.
10. **The timeline**: always under the canvas. A still scene's is only its bar; the first key or action makes the scene animated. See [Animation](06-animation.md).
11. **The hint**: what a click or drag on what is under the pointer would do, a pick in progress ("Click a spot…"), or the next step for where the scene is, with a button for it. **×** dismisses a next step for this scene.

## Selecting

- **Click** a figure to pick it, and click again on a part to pick that part. **Double-click** picks the whole figure.
- **Shift-click** adds to the selection; several picked things move together.
- **Right-click** picks what it is on, as a click would, then shows its menu. On touch, use a long press.
- `Esc` goes back up a level: from a part to its figure, from the figure to nothing.
- `Tab` goes from thing to thing in the scene when the canvas has the focus.
- Picking something opens the inspector on it. `F` frames the selection (everything, with nothing picked).
