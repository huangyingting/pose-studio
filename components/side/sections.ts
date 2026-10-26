import type { ComponentType } from 'react';
import { Film, Images, Layers, type LucideIcon } from 'lucide-react';
import type { SIDE_SECTIONS } from '@/lib/store';
import AnimateSection from './AnimateSection';
import LayersSection from './LayersSection';
import PosesSection from './PosesSection';

/*
 * The left side panel's sections. A new concept is one entry here: its rail icon and label, and
 * the component that fills the panel. The open section is saved with the settings.
 */

export interface SectionProps {
  notifyUndo(text: string): void;
  notify(text: string): void;
  /** A pose was picked (closes the drawer on small screens). */
  onPick?(): void;
}

export interface SideSectionDef {
  id: (typeof SIDE_SECTIONS)[number];
  label: string;
  icon: LucideIcon;
  Panel: ComponentType<SectionProps>;
}

export const SECTIONS: SideSectionDef[] = [
  { id: 'poses', label: 'Poses', icon: Images, Panel: PosesSection },
  { id: 'layers', label: 'Layers', icon: Layers, Panel: LayersSection },
  { id: 'animate', label: 'Animate', icon: Film, Panel: AnimateSection },
];
