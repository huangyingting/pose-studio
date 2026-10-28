import { Circle } from 'lucide-react';
import { command, enabled, iconOf, keyLabel, titleOf, type Ctx } from './commands';
import { IconButton } from './ui';

/** A toolbar button for a command: its icon, title and shortcut, and what it does. */
export function CommandButton({ id, ctx, label, disabled, className, size, tipSide }: {
  id: string;
  ctx: Ctx;
  label?: string;
  disabled?: boolean;
  className?: string;
  size?: number;
  tipSide?: 'top' | 'bottom' | 'right';
}) {
  const cmd = command(id);
  const on = cmd.checked?.(ctx);
  return (
    <IconButton
      icon={iconOf(cmd, ctx) ?? Circle}
      label={label ?? titleOf(cmd, ctx)}
      shortcut={cmd.keys ? keyLabel(cmd.keys[0]) : undefined}
      disabled={disabled ?? !enabled(cmd, ctx)}
      active={on}
      pressed={on}
      className={className}
      size={size}
      tipSide={tipSide}
      onClick={() => cmd.run?.(ctx)}
    />
  );
}
