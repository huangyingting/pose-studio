// Liveness probe for container orchestrators and uptime checks (see the Dockerfile HEALTHCHECK).
// Static so it also builds with `output: 'export'`; answering at all is what matters.
export const dynamic = 'force-static';

export function GET() {
  return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
}
