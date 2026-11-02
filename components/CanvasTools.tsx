'use client';

import { useRef } from 'react';
import { Circle, type LucideIcon } from 'lucide-react';
import { CommandButton } from './CommandButton';
import { command, iconOf, tipOf, type Ctx } from './commands';
import { rovingKey, useRoving, type Roving } from './roving';
import { useStore, useStudio } from './store-context';

/** Its buttons one Tab stop, the arrows between them (#20). */
const KEYS: Roving = { items: 'button', orientation: 'horizontal' };

/** A tool, named beside its icon (Pose and Rotate are not told apart by an icon), lit when in use; its tip what a drag does, and its key. */
function Tool({ id, name, c }: { id: string; name: string; c: Ctx }) {
  const cmd = command(id);
  const on = !!cmd.checked?.(c);
  return (
    <button type="button" className={`tool-btn${on ? ' on' : ''}`} aria-pressed={on} aria-label={name} data-tip={tipOf(id, cmd.help)} data-tip-side="bottom" onClick={() => cmd.run?.(c)}>
      <ToolIcon icon={iconOf(cmd, c) ?? Circle} /> {name}
    </button>
  );
}

const ToolIcon = ({ icon: Icon }: { icon: LucideIcon }) => <Icon size={16} aria-hidden />;

/**
 * The canvas's tools (#38), in its bar at the top left: those for what is selected, and only those.
 * A figure (a part of one, several, or nothing): what a drag on it does (Pose, Move, Rotate: Q W E)
 * and whether the body follows a reaching hand; a prop: its gizmo's moving or scaling (W, R); a
 * camera, a light, a shot or a block: none (their own handles and inspector edit them). The one in
 * use is lit; its gestures are the canvas hint's.
 */
export default function CanvasTools() {
  const store = useStore();
  // (Drawn again as the tool, the switch, the gizmo or the selection changes, from the keys or the palette too.)
  const tool = useStudio((s) => s.tool);
  useStudio((s) => s.settings.bodyFollows);
  useStudio((s) => s.settings.gizmo);
  const kind = useStudio((s) => s.selection?.kind);
  const bar = useRef<HTMLDivElement>(null);
  useRoving(bar, KEYS);
  const c = { store };
  const figure = !kind || kind === 'figure' || kind === 'joint' || kind === 'many';
  if (!figure && kind !== 'prop') return null;
  return (
    <div className="canvas-tools" role="toolbar" aria-label="Tools" aria-orientation="horizontal" ref={bar} onKeyDown={(e) => rovingKey(e, KEYS)}>
      {figure ? (
        <>
          <Tool id="tool.pose" name="Pose" c={c} />
          <Tool id="tool.move" name="Move" c={c} />
          <Tool id="tool.rotate" name="Rotate" c={c} />
          <span className="canvas-tools-sep" aria-hidden />
          <CommandButton id="tool.bodyFollows" ctx={c} tipSide="bottom" disabled={tool !== 'pose'} />
        </>
      ) : (
        <>
          <Tool id="tool.moveProp" name="Move" c={c} />
          <Tool id="tool.scale" name="Scale" c={c} />
        </>
      )}
    </div>
  );
}
