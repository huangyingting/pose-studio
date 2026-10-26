import type { ComponentType } from 'react';
import { Library, ListTree, Sparkles, type LucideIcon } from 'lucide-react';
import { Assistant } from '@edition/server';
import type { SIDE_SECTIONS } from '@/lib/store';
import AssistantSection from './AssistantSection';
import LibrarySection from './LibrarySection';
import OutlineSection from './OutlineSection';

/*
 * The left side panel's sections. A new concept is one entry here: its rail icon and label, and
 * the component that fills the panel. The open section is saved with the settings.
 */

export interface SectionProps {
  notifyUndo(text: string): void;
  notify(text: string): void;
  /** A pose was picked (closes the drawer on small screens). */
  onPick?(): void;
  /** Open "figures from a photo". */
  onPhoto(): void;
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
  // The open scene in workflow order: cast, set, shots.
  { id: 'scene', label: 'Scene', icon: ListTree, Panel: OutlineSection },
  // Ready-made poses, motions, camera moves and scene set-ups, applied to the selection.
  { id: 'library', label: 'Library', icon: Library, Panel: LibrarySection },
  // Describe what you want (server edition only).
  ...(Assistant ? [{ id: 'ai' as const, label: 'AI assistant', icon: Sparkles, Panel: AssistantSection, wide: true }] : []),
];
