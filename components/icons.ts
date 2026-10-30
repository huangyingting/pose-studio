import {
  Armchair, BookOpen, Box, BrickWall, Brush, Circle, CircleDashed, Coffee, Cylinder, Disc, Goal, Minus, PenTool, PencilLine, RectangleHorizontal, Rows3,
  Ribbon, Smartphone, Smile, SeparatorHorizontal, Sun, Wand,
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
  mat: RectangleHorizontal,
  hoop: Goal,
  bar: SeparatorHorizontal,
  ring: CircleDashed,
  ribbon: Ribbon,
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
  anime: Smile,
  render: Box,
  shaded: Sun,
  minimal: Minus,
};
