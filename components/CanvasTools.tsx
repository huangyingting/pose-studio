'use client';

import { useRef } from 'react';
import { CommandButton } from './CommandButton';
import { rovingKey, useRoving, type Roving } from './roving';
import { useStore, useStudio } from './store-context';

/** Its buttons one Tab stop, the arrows between them (#20). */
const KEYS: Roving = { items: 'button', orientation: 'vertical' };

/**
 * The canvas's tools (#38), at its top left: what a drag on a figure does (Pose, Move, Rotate: Q W
 * E), and whether the body follows a reaching hand while posing. The one in use is lit; its
 * gestures are the canvas hint's.
 */
export default function CanvasTools() {
  const store = useStore();
  // (Drawn again as the tool or the switch changes, from the keys or the palette too.)
  useStudio((s) => s.tool);
  useStudio((s) => s.settings.bodyFollows);
  const bar = useRef<HTMLDivElement>(null);
  useRoving(bar, KEYS);
  const c = { store };
  return (
    <div className="canvas-tools" role="toolbar" aria-label="Tools" aria-orientation="vertical" ref={bar} onKeyDown={(e) => rovingKey(e, KEYS)}>
      <CommandButton id="tool.pose" ctx={c} tipSide="right" />
      <CommandButton id="tool.move" ctx={c} tipSide="right" />
      <CommandButton id="tool.rotate" ctx={c} tipSide="right" />
      <span className="canvas-tools-sep" aria-hidden />
      <CommandButton id="tool.bodyFollows" ctx={c} tipSide="right" disabled={store.getState().tool !== 'pose'} />
    </div>
  );
}
