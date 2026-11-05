import 'server-only';

/*
 * How often someone may do something (a note left on a review…): so many times a window, per
 * key (a user, or where an anonymous request comes from). Kept in this process: the server
 * edition runs as one (Node or one Docker container); behind several, each keeps its own count.
 */

const seen = new Map<string, number[]>();

/** Whether `key` may do it once more now (and if so, counted), at most `limit` times in `windowMs`. */
export function allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const recent = (seen.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    seen.set(key, recent);
    return false;
  }
  recent.push(now);
  seen.set(key, recent);
  // (Keys gone quiet let go of now and then, so the map does not grow with every caller.)
  if (seen.size > 10_000) for (const [k, ts] of seen) if (!ts.some((t) => now - t < windowMs)) seen.delete(k);
  return true;
}

/** Who a request comes from, without an account: the address the proxy saw, else one key for all. */
export function clientKey(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return `ip:${forwarded || req.headers.get('x-real-ip') || 'unknown'}`;
}
