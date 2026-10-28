import { useEffect, useState } from 'react';

/**
 * `value`, once it has stopped changing for `ms`: for what is costly to work out again on every
 * step of a drag (a route sampled over the whole animation, camera trails), which then catches up
 * when the drag rests.
 */
export function useSettled<T>(value: T, ms = 150): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}
