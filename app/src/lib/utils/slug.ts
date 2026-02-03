/**
 * Convert a Cloak name to a URL-safe slug.
 * e.g. "DeFi Builders Guild" → "defi-builders-guild"
 */
export function nameToSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
