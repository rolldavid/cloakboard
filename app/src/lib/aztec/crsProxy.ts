/**
 * Intercepts fetch() calls to Aztec CRS endpoints and redirects them
 * through our Next.js API proxy to avoid CORS issues in production.
 *
 * Call installCrsProxy() once, early in app initialization (before PXE starts).
 */

const CRS_REWRITES: [RegExp, string][] = [
  // bb.js 0.82.2: aztec-ignition S3
  [
    /^https:\/\/aztec-ignition\.s3\.amazonaws\.com\/MAIN%20IGNITION\/flat\/g1\.dat$/,
    '/api/crs/g1.dat',
  ],
  [
    /^https:\/\/aztec-ignition\.s3\.amazonaws\.com\/MAIN%20IGNITION\/flat\/g2\.dat$/,
    '/api/crs/g2.dat',
  ],
  [
    /^https:\/\/aztec-ignition\.s3\.amazonaws\.com\/TEST%20GRUMPKIN\/monomial\/transcript00\.dat$/,
    '/api/crs/grumpkin.dat',
  ],
  // bb-prover subdep: crs.aztec.network
  [/^https:\/\/crs\.aztec\.network\/g1\.dat$/, '/api/crs/g1.dat'],
  [/^https:\/\/crs\.aztec\.network\/g2\.dat$/, '/api/crs/g2.dat'],
  [/^https:\/\/crs\.aztec\.network\/grumpkin_g1\.dat$/, '/api/crs/grumpkin.dat'],
];

let installed = false;

export function installCrsProxy() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input instanceof Request
          ? input.url
          : '';

    for (const [pattern, replacement] of CRS_REWRITES) {
      if (pattern.test(url)) {
        const proxyUrl = replacement;
        console.log(`[CRS Proxy] Redirecting ${url} → ${proxyUrl}`);
        return originalFetch(proxyUrl, init);
      }
    }

    return originalFetch(input, init);
  };
}
