/**
 * POST /api/auth/oprf/evaluate
 *
 * OPRF server evaluation endpoint.
 * Receives a blinded ristretto255 point and returns k * Blinded,
 * where k is the server's permanent OPRF key.
 *
 * The server never sees the email — only the blinded point.
 * The session token proves the client verified their email via magic link.
 */

import { NextResponse } from 'next/server';
import { RistrettoPoint } from '@noble/curves/ed25519';
import { verifySessionToken } from '@/lib/auth/email/sessionToken';

function getOprfKey(): bigint {
  const hex = process.env.OPRF_SERVER_KEY;
  if (!hex) throw new Error('OPRF_SERVER_KEY not configured');
  // Reduce to valid scalar mod L
  const L = BigInt('7237005577332262213973186563042994240857116359379907606001950938285454250989');
  const raw = BigInt('0x' + hex);
  const reduced = (raw % (L - BigInt(1))) + BigInt(1); // ensure non-zero
  return reduced;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { blindedPoint, sessionToken } = body;

    if (!blindedPoint || typeof blindedPoint !== 'string') {
      return NextResponse.json({ error: 'Missing blindedPoint' }, { status: 400 });
    }

    if (!sessionToken || typeof sessionToken !== 'string') {
      return NextResponse.json({ error: 'Missing sessionToken' }, { status: 400 });
    }

    // Verify session token
    const session = verifySessionToken(sessionToken);
    if (!session) {
      return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
    }

    // Decode blinded point
    const blindedBytes = new Uint8Array(blindedPoint.length / 2);
    for (let i = 0; i < blindedPoint.length; i += 2) {
      blindedBytes[i / 2] = parseInt(blindedPoint.substring(i, i + 2), 16);
    }

    // Validate it's a valid ristretto255 point
    let point: InstanceType<typeof RistrettoPoint>;
    try {
      point = RistrettoPoint.fromHex(blindedBytes);
    } catch {
      return NextResponse.json({ error: 'Invalid ristretto255 point' }, { status: 400 });
    }

    // Evaluate: result = k * blindedPoint
    const k = getOprfKey();
    const evaluated = point.multiply(k);
    const evaluatedBytes = evaluated.toRawBytes();

    // Encode as hex
    const evaluatedHex = Array.from(evaluatedBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return NextResponse.json({ ok: true, evaluatedPoint: evaluatedHex });
  } catch (error: any) {
    console.error('[oprf/evaluate] Error:', error);
    return NextResponse.json(
      { error: 'OPRF evaluation failed' },
      { status: 500 },
    );
  }
}
