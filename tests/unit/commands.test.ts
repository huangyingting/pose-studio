import { describe, expect, it } from 'vitest';
import { addFigure, addProp, addStandIn, placeTemplate, startAnimation } from '@/lib/actions';
import { Store } from '@/lib/store';
import { COMMANDS, command, commandForKey, keyLabel, matchesKey, menu, selectionCtx } from '@/components/commands';
import { LIBRARY_CATEGORIES, searchLibrary } from '@/components/side/libraryItems';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

const key = (k: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) =>
  ({ key: k, ctrlKey: !!mods.ctrl, metaKey: false, shiftKey: !!mods.shift, altKey: !!mods.alt }) as KeyboardEvent;

describe('commands: one list for keys, menus, toolbars and the palette', () => {
  it('has unique ids, and one command per key for each kind of selection', () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(keyLabel('mod+shift+z')).toBe('Ctrl Shift Z');
    expect(keyLabel('?')).toBe('?');
    expect(keyLabel('delete')).toBe('Del');
    // Ctrl Z is not Ctrl Shift Z; a symbol's Shift is the symbol's.
    expect(matchesKey('mod+z', key('z', { ctrl: true }))).toBe(true);
    expect(matchesKey('mod+z', key('Z', { ctrl: true, shift: true }))).toBe(false);
    expect(matchesKey('mod+shift+z', key('Z', { ctrl: true, shift: true }))).toBe(true);
    expect(matchesKey('?', key('?', { shift: true }))).toBe(true);
    expect(matchesKey('space', key(' '))).toBe(true);
    expect(matchesKey('w', key('w', { alt: true }))).toBe(false);
  });

  it('runs the key on what is selected: Del deletes the selected prop, not the figure', () => {
    const store = new Store(new MemoryStorage());
    addProp(store, 'box', [1, 0, 1]);
    const prop = store.scene.props[0].id;
    store.select({ kind: 'prop', prop });
    const c = selectionCtx(store);
    const del = commandForKey(key('Delete'), c);
    expect(del?.id).toBe('prop.delete');
    del!.run!(c);
    expect(store.scene.props).toHaveLength(0);
    expect(store.scene.figures).toHaveLength(1);
    // With nothing selected, Del has nothing to delete.
    store.select(null);
    expect(commandForKey(key('Delete'), selectionCtx(store))).toBeUndefined();
  });

  it('builds menus from command ids: a command with choices shows them under its title', () => {
    const store = new Store(new MemoryStorage());
    addFigure(store, [1, 0, 0]);
    const [a, b] = store.scene.figures;
    const items = menu('figure', { store, figure: b.id });
    const labels = items.map((it) => (it === '-' ? '-' : 'group' in it ? `[${it.group}]` : it.label));
    expect(labels).toContain('Rename');
    expect(labels).toContain('[Eyes on]');
    expect(labels).toContain(a.name);
    // No divider at either end, none twice in a row.
    expect(labels[0]).not.toBe('-');
    expect(labels.at(-1)).not.toBe('-');
    expect(labels.some((l, i) => l === '-' && labels[i + 1] === '-')).toBe(false);
    // Deleting the only other figure is fine; the last one is kept.
    expect(command('figure.delete').enabled!({ store, figure: b.id })).toBe(true);
  });

  it('leaves out a heading whose commands do not apply (a stand-in cannot be sent anywhere)', () => {
    const store = new Store(new MemoryStorage());
    addStandIn(store);
    const proxy = store.scene.figures.find((f) => f.proxy)!;
    const items = menu('figure', { store, figure: proxy.id });
    expect(items.some((it) => typeof it === 'object' && 'group' in it && it.group === 'Move to')).toBe(false);
    expect(items.filter((it, i) => it === '-' && items[i + 1] === '-')).toHaveLength(0);
  });

  it('the timeline commands apply only to an animated scene', () => {
    const store = new Store(new MemoryStorage());
    expect(menu('timeline', { store })).toHaveLength(0);
    startAnimation(store);
    expect(menu('timeline', { store }).length).toBeGreaterThan(0);
  });
});

describe('the Library: categories as data, one search', () => {
  it('finds items in every category by name, and puts a template in at a spot on the floor', () => {
    const store = new Store(new MemoryStorage());
    const ui = { notify: () => {}, notifyUndo: () => {} };
    const found = searchLibrary(store, ui, 'walk');
    expect(new Set(found.map((it) => it.tab))).toEqual(new Set(['templates', 'motions']));
    expect(searchLibrary(store, ui, 'walk', 'motions').every((it) => it.tab === 'motions')).toBe(true);
    // Every category's items say where they are listed.
    for (const c of LIBRARY_CATEGORIES) for (const it of c.items(store, ui)) expect(it.tab).toBe(c.id);

    const before = store.scene.figures.length;
    const cast = placeTemplate(store, 'handshake', null, [3, 0, -2])!;
    expect(store.scene.figures.length).toBe(before + 2);
    const lead = store.scene.figures.find((f) => f.id === cast[0])!;
    expect(lead.position[0]).toBeCloseTo(3, 5);
    expect(lead.position[2]).toBeCloseTo(-2, 5);
  });
});
