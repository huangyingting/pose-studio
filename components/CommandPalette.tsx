'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Clapperboard, Search, type LucideIcon } from 'lucide-react';
import { useStore } from './store-context';
import { COMMANDS, applies, enabled, iconOf, keyLabel, selectionCtx, titleOf } from './commands';
import { LIBRARY_CATEGORIES, searchLibrary, type LibraryUi } from './side/libraryItems';
import { useLibraryMotions } from './side/LibrarySection';

interface Entry { key: string; title: string; icon?: LucideIcon; keys?: string; checked?: boolean; disabled?: boolean; run(): void }

/**
 * Find anything to do by name (Ctrl K): every command that applies to the selection (a command's
 * choices as "Copy moves to: Kai"), the project's scenes, and the Library's items, found the way
 * the Library's own search finds them.
 */
export default function CommandPalette({ onClose, ui }: { onClose(): void; ui: LibraryUi }) {
  const store = useStore();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const c = selectionCtx(store);
  // (The Library's motion files found too, once their list has come.)
  useLibraryMotions();

  const all: Entry[] = [];
  for (const cmd of COMMANDS) {
    if (cmd.id === 'app.palette' || !applies(cmd, c)) continue;
    const title = titleOf(cmd, c);
    if (cmd.items) {
      cmd.items(c).forEach((ch, i) => all.push({ key: `${cmd.id}:${i}`, title: `${title}: ${ch.title}`, icon: ch.icon ?? iconOf(cmd, c), checked: ch.checked, disabled: ch.disabled, run: ch.run }));
    } else if (cmd.run) {
      all.push({ key: cmd.id, title, icon: iconOf(cmd, c), keys: cmd.keys && keyLabel(cmd.keys[0]), checked: cmd.checked?.(c), disabled: !enabled(cmd, c), run: () => cmd.run!(c) });
    }
  }
  store.getState().library.scenes.forEach((s, i) => all.push({ key: `scene:${s.id}`, title: `Go to scene: ${s.name}`, icon: Clapperboard, run: () => store.setSceneIndex(i) }));

  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const found = q
    ? [
      ...all.filter((e) => words.every((w) => e.title.toLowerCase().includes(w))),
      ...searchLibrary(store, ui, q).map((it): Entry => ({
        key: it.key,
        title: `${LIBRARY_CATEGORIES.find((x) => x.id === it.tab)!.label}: ${it.name}`,
        icon: it.icon,
        disabled: it.disabled,
        run: it.run,
      })),
    ].sort((a, b) => Number(!a.title.toLowerCase().startsWith(q)) - Number(!b.title.toLowerCase().startsWith(q)))
    : all;
  const shown = found.slice(0, 200);
  const at = Math.min(active, Math.max(0, shown.length - 1));

  const go = (e: Entry | undefined) => {
    if (!e || e.disabled) return;
    onClose();
    e.run();
  };
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [at]);

  return (
    <div className="palette-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <label className="palette-input">
          <Search size={16} aria-hidden />
          <input
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={shown[at] ? `palette-${at}` : undefined}
            aria-label="Find a command"
            placeholder="Find a command, a scene or a Library item…"
            value={query}
            autoFocus
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((at + 1) % Math.max(1, shown.length)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((at - 1 + shown.length) % Math.max(1, shown.length)); }
              else if (e.key === 'Enter') { e.preventDefault(); go(shown[at]); }
              else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
            }}
          />
        </label>
        <ul className="palette-list" id="palette-list" role="listbox" aria-label="Commands" ref={list}>
          {shown.map((e, i) => (
            <li
              key={e.key}
              id={`palette-${i}`}
              role="option"
              aria-selected={i === at}
              aria-disabled={e.disabled || undefined}
              className={i === at ? 'on' : undefined}
              onPointerMove={() => { if (i !== at) setActive(i); }}
              onClick={() => go(e)}
            >
              {e.icon ? <e.icon size={15} aria-hidden /> : <span className="palette-blank" />}
              <span className="palette-title">{e.title}</span>
              {e.checked && <Check size={14} aria-label="On" />}
              {e.keys && <kbd>{e.keys}</kbd>}
            </li>
          ))}
          {!shown.length && <li className="palette-none" role="presentation">Nothing matches “{query.trim()}”</li>}
        </ul>
      </div>
    </div>
  );
}
