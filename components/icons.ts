import {
  Armchair, BookOpen, BowArrow, Box, BrickWall, Brush, Car, Circle, CircleDashed, Coffee, Cylinder, Disc, Goal, Minus, PenTool, PencilLine, RectangleHorizontal, Rows3,
  Crosshair, Droplets, Dumbbell, FlagTriangleRight, Grid2x2, Handbag, PocketKnife, Ribbon, Shield, Slash, Smartphone, Smile, SeparatorHorizontal, Sun, Sword, Target, Wand, Waves, Weight, WeightTilde,
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
  knife: PocketKnife,
  shield: Shield,
  bat: Slash,
  club: FlagTriangleRight,
  bag: Handbag,
  bow: BowArrow,
  dumbbell: Dumbbell,
  kettlebell: Weight,
  barbell: WeightTilde,
  car: Car,
  water: Waves,
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
