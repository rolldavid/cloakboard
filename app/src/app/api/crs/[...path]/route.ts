import { NextRequest, NextResponse } from 'next/server';

/**
 * CRS proxy — bypasses CORS restrictions on aztec-ignition.s3.amazonaws.com
 * and crs.aztec.network by proxying requests through our own origin.
 *
 * Routes:
 *   /api/crs/g1.dat        → s3 MAIN IGNITION g1.dat
 *   /api/crs/g2.dat        → s3 MAIN IGNITION g2.dat
 *   /api/crs/grumpkin.dat  → s3 TEST GRUMPKIN transcript00.dat
 */

const UPSTREAM: Record<string, string> = {
  'g1.dat': 'https://aztec-ignition.s3.amazonaws.com/MAIN%20IGNITION/flat/g1.dat',
  'g2.dat': 'https://aztec-ignition.s3.amazonaws.com/MAIN%20IGNITION/flat/g2.dat',
  'grumpkin.dat': 'https://aztec-ignition.s3.amazonaws.com/TEST%20GRUMPKIN/monomial/transcript00.dat',
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const file = path.join('/');
  const upstream = UPSTREAM[file];

  if (!upstream) {
    return NextResponse.json({ error: 'Unknown CRS file' }, { status: 404 });
  }

  // Forward Range header if present (SDK uses Range requests for g1/grumpkin)
  const headers: Record<string, string> = {};
  const range = request.headers.get('Range');
  if (range) {
    headers['Range'] = range;
  }

  const upstreamResponse = await fetch(upstream, { headers });

  // Build response headers
  const responseHeaders = new Headers();

  // Forward content headers from upstream
  for (const key of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges']) {
    const value = upstreamResponse.headers.get(key);
    if (value) responseHeaders.set(key, value);
  }

  // Cache aggressively — CRS data is immutable
  responseHeaders.set('Cache-Control', 'public, max-age=31536000, immutable');
  // Allow cross-origin (in case any sub-workers need it)
  responseHeaders.set('Access-Control-Allow-Origin', '*');

  return new NextResponse(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}
