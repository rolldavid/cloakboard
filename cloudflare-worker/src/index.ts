/**
 * Cloudflare Worker — OG proxy for social media crawlers.
 *
 * Routes: cloakboard.com/d/*
 *
 * Bot user agents (Twitterbot, etc.) get proxied to the server's /share/d/:slug
 * endpoint which returns HTML with OG meta tags + R2-hosted image URL.
 * All other traffic passes through to the SPA origin unchanged.
 */

interface Env {
  SERVER_SHARE_BASE: string;
}

const BOT_PATTERN = /Twitterbot|facebookexternalhit|LinkedInBot|Slackbot|Discordbot|WhatsApp|Googlebot|bingbot|Embedly|Quora Link Preview|Showyoubot|outbrain|pinterest|vkShare|Pinterestbot/i;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const ua = request.headers.get('user-agent') || '';
    const url = new URL(request.url);

    // Only intercept /d/:slug paths
    const match = url.pathname.match(/^\/d\/([a-z0-9][a-z0-9-]*[a-z0-9])$/);
    if (!match) {
      // Not a duel path — pass through to origin
      return fetch(request);
    }

    if (!BOT_PATTERN.test(ua)) {
      // Human visitor — pass through to SPA origin
      return fetch(request);
    }

    // Bot detected — proxy to server share page for OG meta tags
    const slug = match[1];
    const shareUrl = `${env.SERVER_SHARE_BASE}/share/d/${slug}`;

    try {
      const shareResponse = await fetch(shareUrl, {
        headers: {
          'User-Agent': ua,
          'Accept': 'text/html',
        },
      });

      if (!shareResponse.ok) {
        // Server error — fall back to origin
        return fetch(request);
      }

      // Return the OG HTML to the crawler (don't follow the meta refresh redirect)
      const html = await shareResponse.text();
      return new Response(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
        },
      });
    } catch {
      // Network error — fall back to origin
      return fetch(request);
    }
  },
};
