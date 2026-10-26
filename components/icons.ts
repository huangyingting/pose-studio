import {
  Armchair, BookOpen, Box, BrickWall, Brush, Circle, Coffee, Contrast, Cylinder, Disc, Minus, PenTool, PencilLine, Rows3, Smartphone, Sparkles, Sun, Wand,
  type LucideIcon,
} from 'lucide-react';
import type { PropKind, Style } from '@/lib/types';

/** Icon per prop kind (layer list, add menu). */
export const PROP_ICONS: Record<PropKind, LucideIcon> = {
  box: Box,
  sphere: Circle,
  cylinder: Cylinder,
  chair: Armchair,
  stool: Disc,
  step: Rows3,
  wall: BrickWall,
  stick: Wand,
  phone: Smartphone,
  cup: Coffee,
  book: BookOpen,
};

/** Icon per render style (toolbar menu, export / practice pickers). */
export const STYLE_ICONS: Record<Style, LucideIcon> = {
  line: PenTool,
  sketch: PencilLine,
  ink: Brush,
  anime: Sparkles,
  shaded: Sun,
  minimal: Minus,
  silhouette: Contrast,
};
