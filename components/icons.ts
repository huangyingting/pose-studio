import {
  Armchair, BookOpen, Box, BrickWall, Brush, Circle, CircleDashed, Coffee, Cylinder, Disc, Goal, Minus, PenTool, PencilLine, RectangleHorizontal, Rows3,
  Crosshair, Droplets, FlagTriangleRight, Grid2x2, Handbag, Ribbon, Shield, Slash, Smartphone, Smile, SeparatorHorizontal, Sun, Sword, Target, Wand,
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
  pistol: Crosshair,
  rifle: Target,
  sword: Sword,
  shield: Shield,
  bat: Slash,
  club: FlagTriangleRight,
  bag: Handbag,
};

/** Icon per render style (toolbar menu, export / practice pickers). */
export const STYLE_ICONS: Record<Style, LucideIcon> = {
  line: PenTool,
  sketch: PencilLine,
  ink: Brush,
  watercolor: Droplets,
  anime: Smile,
  pixel: Grid2x2,
  render: Box,
  shaded: Sun,
  minimal: Minus,
};
