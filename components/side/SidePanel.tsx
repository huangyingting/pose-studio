'use client';

import type { LucideIcon } from 'lucide-react';
import type { SideSection } from '@/lib/store';
import { useStore, useStudio } from '../store-context';
import { IconButton } from '../ui';
import { SECTIONS, type SectionProps } from './sections';

export interface RailAction {
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  onSelect(): void;
}

/**
 * The left side: a rail of sections (Scene, Library, …) with the open one's panel next
 * to it, and below a divider, workspaces that open on their own (Storyboard). Clicking the open
 * section's icon folds the panel away for more canvas.
 */
export default function SidePanel({ actions, drawer, ...props }: SectionProps & { actions: RailAction[]; drawer: boolean }) {
  const store = useStore();
  const saved = useStudio((s) => s.settings.side);
  // As a drawer (small screens) a section is always shown.
  const side: SideSection = saved === 'none' && drawer ? 'scene' : saved;
  const open = SECTIONS.find((s) => s.id === side);
  const pick = (id: SideSection) => store.setSettings({ side: id === side ? 'none' : id });

  return (
    <aside className={`side${open ? '' : ' collapsed'}`} aria-label="Side panel">
      <nav className="rail" role="tablist" aria-orientation="vertical" aria-label="Sections">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            id={`side-tab-${s.id}`}
            aria-selected={s.id === side}
            aria-controls={s.id === side ? 'side-panel' : undefined}
            className={`rail-btn${s.id === side ? ' on' : ''}`}
            data-tip={s.id === side ? `${s.label} (click to hide)` : s.label}
            data-tip-side="right"
            onClick={() => pick(s.id)}
          >
            <s.icon size={18} strokeWidth={1.75} aria-hidden />
            <span className="rail-label">{s.label}</span>
          </button>
        ))}
        <span className="rail-sep" />
        {actions.map((a) => (
          <IconButton key={a.label} icon={a.icon} label={a.label} shortcut={a.shortcut} tipSide="right" className="rail-btn" onClick={a.onSelect} />
        ))}
      </nav>
      {open && (
        <div className="side-panel" id="side-panel" role="tabpanel" aria-labelledby={`side-tab-${open.id}`}>
          <open.Panel {...props} />
        </div>
      )}
    </aside>
  );
}
