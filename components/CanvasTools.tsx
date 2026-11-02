'use client';

import { CommandButton } from './CommandButton';
import { useStore, useStudio } from './store-context';

/**
 * The canvas's tools (#38), in the top bar's canvas group (its keys are the group's): the scene alone,
 * then the tools for what is selected, and only those, as icon buttons whose tips say what a drag
 * does. A figure (a part of one, several, or nothing): Pose, Move, Rotate (Q W E) and whether the
 * body follows a reaching hand; a prop: its gizmo's moving or scaling (W, R); a camera, a light, a
 * shot or a block: none (their own handles and inspector edit them), nor looking through a camera.
 */
export default function CanvasTools() {
  const store = useStore();
  // (Drawn again as the tool, the switch, the gizmo or the selection changes, from the keys or the palette too.)
  const tool = useStudio((s) => s.tool);
  useStudio((s) => s.settings.bodyFollows);
  useStudio((s) => s.settings.gizmo);
  const kind = useStudio((s) => s.selection?.kind);
  const through = useStudio((s) => !!s.through);
  const c = { store };
  const figure = !through && (!kind || kind === 'figure' || kind === 'joint' || kind === 'many');
  const prop = !through && kind === 'prop';
  return (
    <>
      <span className="tb-sep" />
      <CommandButton id="view.stageOnly" ctx={c} />
      {(figure || prop) && (
        <div className="canvas-tools" role="group" aria-label="Tools">
          {figure ? (
            <>
              <CommandButton id="tool.pose" ctx={c} />
              <CommandButton id="tool.move" ctx={c} />
              <CommandButton id="tool.rotate" ctx={c} />
              <CommandButton id="tool.bodyFollows" ctx={c} disabled={tool !== 'pose'} />
            </>
          ) : (
            <>
              <CommandButton id="tool.moveProp" ctx={c} />
              <CommandButton id="tool.scale" ctx={c} />
            </>
          )}
        </div>
      )}
    </>
  );
}
