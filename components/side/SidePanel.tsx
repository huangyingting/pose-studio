'use client';

import { useRef, type CSSProperties } from 'react';
import { rovingKey, useRoving, type Roving } from '../roving';
import type { LucideIcon } from 'lucide-react';
import type { SideSection } from '@/lib/store';
import { useStore, useStudio } from '../store-context';
import { IconButton, PanelEdge } from '../ui';
import { SECTIONS, type SectionProps } from './sections';

export interface RailAction {
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  onSelect(): void;
}

/**
 * The left side: what is in the scene and what can go in it, a rail of sections (the scene's outline, the library's categories, the AI assistant) with the open one's panel next
 * to it, and below a divider, workspaces that open on their own (Storyboard). Clicking the open
 * section's icon folds the panel away for more canvas.
 */
export default function SidePanel({ actions, drawer, ...props }: SectionProps & { actions: RailAction[]; drawer: boolean }) {
  const store = useStore();
  const saved = useStudio((s) => s.settings.side);
  const widths = useStudio((s) => s.settings.widths);
  // As a drawer (small screens) a section is always shown.
  const side: SideSection = saved === 'none' && drawer ? 'scene' : saved;
  const open = SECTIONS.find((s) => s.id === side);
  const pick = (id: SideSection) => store.setSettings({ side: id === side ? 'none' : id });

  // (One Tab stop for the tabs, ↑ ↓ between them, the panel following: #20.)
  const rail = useRef<HTMLElement>(null);
  useRoving(rail, RAIL_KEYS);
  return (
    <aside className={`side${open ? '' : ' collapsed'}`} aria-label="Side panel">
      <nav className="rail" role="tablist" aria-orientation="vertical" aria-label="Sections" ref={rail} onKeyDown={(e) => rovingKey(e, RAIL_KEYS)}>
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
            <s.icon size={19} strokeWidth={1.75} aria-hidden />
            <span className="rail-label">{s.label}</span>
          </button>
        ))}
        <span className="rail-sep" />
        {actions.map((a) => (
          <IconButton key={a.label} icon={a.icon} label={a.label} shortcut={a.shortcut} tipSide="right" className="rail-btn" onClick={a.onSelect} />
        ))}
      </nav>
      {open && (
        <div
          className={`side-panel${open.wide ? ' wide' : ''}`}
          id="side-panel"
          role="tabpanel"
          aria-labelledby={`side-tab-${open.id}`}
          // Each section keeps the width it was dragged to.
          style={widths[open.id] ? ({ '--side-w': `${widths[open.id]}px` } as CSSProperties) : undefined}
        >
          <open.Panel {...props} section={open.id} />
          <PanelEdge
            label="Resize the side panel"
            side="right"
            width={() => document.getElementById('side-panel')?.getBoundingClientRect().width ?? 240}
            onWidth={(w) => {
              const next = { ...store.getState().settings.widths };
              if (w === null) delete next[open.id];
              else next[open.id] = w;
              store.setSettings({ widths: next });
            }}
          />
        </div>
      )}
    </aside>
  );
}

const RAIL_KEYS: Roving = { items: '[role="tab"]', orientation: 'vertical', chosen: '[aria-selected="true"]', activate: (el) => el.click() };
