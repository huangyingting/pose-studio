# 1. Finding your way around

![The studio with a scene open](images/layout.png)

1. **Main menu**: new scene, open and save the project, add scenes from a file, the theme, keyboard shortcuts.
2. **View, Frame and Render style**:
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
7. **The canvas tools**: **Pose** (`Q`), **Move** (`W`) and **Rotate** (`E`), and **Body follows**. See [Posing](02-posing.md).
8. **The view widget**: the world's axes as the view sees them. Click an axis end to look from there; `1`–`6` do the same from the keyboard. Drag empty space on the canvas to orbit, the wheel zooms.
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
