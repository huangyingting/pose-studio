# 0004. Every operation is a command

- **Status**: Accepted
- **Date**: 2026-11-01

## Context

An operation the user can do shows up in many places: a toolbar button, a right-click menu, an inspector button, a keyboard shortcut, *Find a command* (`Ctrl K`), the shortcuts help (`?`) and a tooltip. Written separately, these drift: a menu item and its toolbar button get different names or different keys, and an operation is missing from the palette.

## Decision

Each operation is defined once in `components/commands.ts` as a `Command`: its id, title (which can depend on the context), icon, keys, `when` it applies, `checked` state if it is a toggle, and `run`. A command receives a context (`Ctx`): the store and what it acts on (a figure, a joint, an action, a camera, the floor spot…).

From that one list:

- menus are lists of command ids per kind of thing (`menu('figure', ctx)`), and a menu shows only the commands whose `when` holds;
- toolbar and inspector buttons are `CommandButton`s, which take the title, icon, shortcut and enabled state from the command;
- the keyboard maps a key to the command bound to it, on the selection (`components/shortcuts.ts`);
- the palette and the shortcuts help list the commands.

## Consequences

- An operation has one name and one key everywhere, and adding it to the list puts it in the palette and the help.
- A command's `run` calls `lib/actions` (ADR 0003); a command does not contain the edit itself.
- `commands.ts` is long by design: it is a registry, read as a list. Its entries stay one or a few lines each, and the logic they call lives elsewhere.
