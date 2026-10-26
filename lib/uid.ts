let counter = 0;

/** Short unique id with a type prefix (e.g. "f…" figure, "s…" scene). */
export function uid(prefix: string) {
  counter = (counter + 1) % 1296;
  return `${prefix}${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 6)}${counter.toString(36)}`;
}
