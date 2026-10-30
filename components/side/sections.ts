import type { ComponentType } from 'react';
import { ListTree, Sparkles, type LucideIcon } from 'lucide-react';
import { Assistant } from '@edition/server';
import type { SIDE_SECTIONS } from '@/lib/store';
import AssistantSection from './AssistantSection';
import LibrarySection from './LibrarySection';
import { LIBRARY_CATEGORIES } from './libraryItems';
import OutlineSection from './OutlineSection';

/*
 * The left side panel's sections: what is in the scene (its outline), what can go in it (the
 * library's categories, each its own) and the assistant. A new
 * one is an entry here: its rail icon and label, and the component that fills the panel. The open
 * section is saved with the settings.
 */

export interface SectionProps {
  notifyUndo(text: string): void;
  notify(text: string): void;
  /** Something from the library was used (closes the drawer on small screens, to show it). */
  onPick?(): void;
  /** Open "figures from a photo". */
  onPhoto(): void;
  /** The section shown (a library category's). */
  section?: SideSectionDef['id'];
}

export interface SideSectionDef {
  id: (typeof SIDE_SECTIONS)[number];
  label: string;
  icon: LucideIcon;
  Panel: ComponentType<SectionProps>;
  /** A wider panel (a chat). */
  wide?: boolean;
}

export const SECTIONS: SideSectionDef[] = [
  // What is in the open scene, in workflow order: cast, set, cameras, lights, shots.
  { id: 'scene', label: 'Scene', icon: ListTree, Panel: OutlineSection },
  // What can go in it: the library, a category each (characters, poses, motions, sets and lighting; a camera's moves are in its inspector, the director on the timeline), applied to the selection.
  ...LIBRARY_CATEGORIES.map((c) => ({ id: c.id, label: c.label, icon: c.icon, Panel: LibrarySection })),
  // Describe what you want (server edition only).
  ...(Assistant ? [{ id: 'ai' as const, label: 'AI assistant', icon: Sparkles, Panel: AssistantSection, wide: true }] : []),
];
