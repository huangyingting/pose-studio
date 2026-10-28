import type { DragEvent } from 'react';
import type { Vec3 } from '@/lib/types';

/*
 * Dragging something (a Library item, a prop to add) onto what it applies to: a figure or the
 * floor on the canvas, a shot on the timeline. The drag carries what dropping it there does.
 */

export interface DropTarget {
  figure?(id: string): void;
  floor?(at: Vec3): void;
  shot?(id: string): void;
}

let current: DropTarget | null = null;

/** Start dragging something that can be dropped where `target` says. */
export function startDrag(e: DragEvent, target: DropTarget) {
  current = target;
  e.dataTransfer.setData('text/x-pose-studio', '1');
  e.dataTransfer.effectAllowed = 'copy';
}

export function endDrag() {
  current = null;
}

/** What is being dragged, if anything of ours. */
export const dragged = () => current;
