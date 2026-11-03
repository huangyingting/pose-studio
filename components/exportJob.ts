/*
 * An export going on with its dialog closed (a video, an AI pack): what it is, how far it has got,
 * and how to stop it. The header's hint shows it until it is done; the work goes on as the user does.
 */

interface ExportJob {
  label: string;
  /** 0 to 1. */
  progress: number;
  cancel(): void;
}

let job: ExportJob | null = null;
const listeners = new Set<() => void>();

/** The export going on, if any. */
export const exportJob = () => job;

/** It starts (or null: it is over), or has got further. */
export function setExportJob(next: ExportJob | null) {
  job = next;
  listeners.forEach((f) => f());
}

/** Call `f` whenever the export going on changes. Returns a function that stops it. */
export function onExportJob(f: () => void) {
  listeners.add(f);
  return () => { listeners.delete(f); };
}
