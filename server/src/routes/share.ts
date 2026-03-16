/**
 * Social sharing endpoints:
 *
 * GET  /api/duels/:idOrSlug/og-image   — generates a PNG chart image for Twitter Cards
 * GET  /api/duels/:idOrSlug/share-text — simple template share message
 * GET  /share/d/:slug                  — HTML page with Twitter Card meta tags, redirects to SPA
 */

import { Router, type Request, type Response } from 'express';
import sharp from 'sharp';
import { pool } from '../lib/db/pool.js';

const router = Router();

// --- Helpers ---

async function lookupDuel(idOrSlug: string) {
  const isNumeric = /^\d+$/.test(idOrSlug);
  const result = await pool.query(
    isNumeric
      ? `SELECT d.id, d.slug, d.title, d.description, d.duel_type, d.status,
                d.agree_count, d.disagree_count, d.total_votes,
                d.is_breaking
         FROM duels d WHERE d.id = $1`
      : `SELECT d.id, d.slug, d.title, d.description, d.duel_type, d.status,
                d.agree_count, d.disagree_count, d.total_votes,
                d.is_breaking
         FROM duels d WHERE d.slug = $1`,
    [isNumeric ? parseInt(idOrSlug, 10) : idOrSlug],
  );
  return result.rows[0] || null;
}

async function lookupOptions(duelId: number) {
  const result = await pool.query(
    `SELECT label, vote_count FROM duel_options WHERE duel_id = $1 ORDER BY vote_count DESC`,
    [duelId],
  );
  return result.rows;
}

async function lookupLevels(duelId: number) {
  const result = await pool.query(
    `SELECT level, vote_count FROM duel_levels WHERE duel_id = $1 ORDER BY level`,
    [duelId],
  );
  return result.rows;
}

// --- OG Image Generation ---

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '\u2026';
}

function generateBinarySvg(title: string, agreeCount: number, disagreeCount: number, totalVotes: number): string {
  const w = 1200, h = 630;
  const agreePct = totalVotes > 0 ? Math.round((agreeCount / totalVotes) * 100) : 50;
  const disagreePct = 100 - agreePct;
  const barY = 340, barH = 80;
  const barX = 80, barW = w - 160;
  const agreeW = Math.max(totalVotes > 0 ? (agreeCount / totalVotes) * barW : barW / 2, 4);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <rect width="${w}" height="${h}" fill="#0f1117"/>
    <text x="600" y="80" text-anchor="middle" fill="#8b8fa3" font-family="system-ui,sans-serif" font-size="20" font-weight="500">CLOAKBOARD</text>
    <text x="600" y="200" text-anchor="middle" fill="#e4e6ed" font-family="system-ui,sans-serif" font-size="36" font-weight="700">
      ${escapeXml(truncate(title, 60))}
    </text>
    <text x="600" y="250" text-anchor="middle" fill="#8b8fa3" font-family="system-ui,sans-serif" font-size="22">${totalVotes} vote${totalVotes !== 1 ? 's' : ''}</text>
    <rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="16" fill="#1e2030"/>
    <rect x="${barX}" y="${barY}" width="${agreeW}" height="${barH}" rx="16" fill="#22c55e"/>
    ${agreeW < barW ? `<rect x="${barX + agreeW}" y="${barY}" width="${barW - agreeW}" height="${barH}" rx="16" fill="#ef4444"/>` : ''}
    <text x="${barX + 24}" y="${barY + 50}" fill="#fff" font-family="system-ui,sans-serif" font-size="28" font-weight="700">${agreePct}% Agree</text>
    <text x="${barX + barW - 24}" y="${barY + 50}" text-anchor="end" fill="#fff" font-family="system-ui,sans-serif" font-size="28" font-weight="700">${disagreePct}% Disagree</text>
    <text x="600" y="530" text-anchor="middle" fill="#6366f1" font-family="system-ui,sans-serif" font-size="24" font-weight="600">What do you think? Vote anonymously</text>
    <text x="600" y="580" text-anchor="middle" fill="#8b8fa3" font-family="system-ui,sans-serif" font-size="18">cloakboard.xyz</text>
  </svg>`;
}

function generateMultiSvg(title: string, options: Array<{label: string; vote_count: number}>, totalVotes: number): string {
  const w = 1200, h = 630;
  const top5 = options.slice(0, 5);
  const barX = 80, barW = w - 160;
  const startY = 260, rowH = 56;

  const bars = top5.map((opt, i) => {
    const y = startY + i * rowH;
    const pct = totalVotes > 0 ? Math.round((opt.vote_count / totalVotes) * 100) : 0;
    const fillW = Math.max(totalVotes > 0 ? (opt.vote_count / totalVotes) * barW : 0, 4);
    return `
      <rect x="${barX}" y="${y}" width="${barW}" height="40" rx="8" fill="#1e2030"/>
      <rect x="${barX}" y="${y}" width="${fillW}" height="40" rx="8" fill="#6366f1" opacity="0.8"/>
      <text x="${barX + 12}" y="${y + 27}" fill="#e4e6ed" font-family="system-ui,sans-serif" font-size="18" font-weight="500">${escapeXml(truncate(opt.label, 40))}</text>
      <text x="${barX + barW - 12}" y="${y + 27}" text-anchor="end" fill="#a5b4fc" font-family="system-ui,sans-serif" font-size="18" font-weight="700">${pct}%</text>
    `;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <rect width="${w}" height="${h}" fill="#0f1117"/>
    <text x="600" y="80" text-anchor="middle" fill="#8b8fa3" font-family="system-ui,sans-serif" font-size="20" font-weight="500">CLOAKBOARD</text>
    <text x="600" y="170" text-anchor="middle" fill="#e4e6ed" font-family="system-ui,sans-serif" font-size="32" font-weight="700">${escapeXml(truncate(title, 60))}</text>
    <text x="600" y="220" text-anchor="middle" fill="#8b8fa3" font-family="system-ui,sans-serif" font-size="20">${totalVotes} vote${totalVotes !== 1 ? 's' : ''}</text>
    ${bars}
    <text x="600" y="590" text-anchor="middle" fill="#6366f1" font-family="system-ui,sans-serif" font-size="22" font-weight="600">What do you think? Vote anonymously on cloakboard.xyz</text>
  </svg>`;
}

// --- Routes ---

// OG Image
router.get('/api/duels/:idOrSlug/og-image', async (req: Request, res: Response) => {
  try {
    const duel = await lookupDuel(req.params.idOrSlug);
    if (!duel) return res.status(404).json({ error: 'Duel not found' });

    let svg: string;
    if (duel.duel_type === 'multi') {
      const options = await lookupOptions(duel.id);
      svg = generateMultiSvg(duel.title, options, duel.total_votes);
    } else {
      svg = generateBinarySvg(duel.title, duel.agree_count, duel.disagree_count, duel.total_votes);
    }

    const png = await sharp(Buffer.from(svg)).png().toBuffer();

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300'); // 5 min cache
    res.send(png);
  } catch (err: any) {
    console.error('[og-image] Error:', err?.message);
    res.status(500).json({ error: 'Failed to generate image' });
  }
});

// Share Text
router.get('/api/duels/:idOrSlug/share-text', async (req: Request, res: Response) => {
  try {
    const duel = await lookupDuel(req.params.idOrSlug);
    if (!duel) return res.status(404).json({ error: 'Duel not found' });

    let text: string;
    if (duel.duel_type === 'binary') {
      const pct = duel.total_votes > 0
        ? Math.round((duel.agree_count / duel.total_votes) * 100)
        : 50;
      text = `${pct}% agree: ${truncate(duel.title, 120)}. What do you think?`;
    } else if (duel.duel_type === 'multi') {
      const options = await lookupOptions(duel.id);
      const top = options[0];
      if (top && duel.total_votes > 0) {
        const pct = Math.round((top.vote_count / duel.total_votes) * 100);
        text = `${pct}% say "${truncate(top.label, 40)}": ${truncate(duel.title, 80)}. What do you think?`;
      } else {
        text = `${truncate(duel.title, 120)}. What do you think?`;
      }
    } else {
      // level
      const levels = await lookupLevels(duel.id);
      const totalCount = levels.reduce((sum: number, l: any) => sum + l.vote_count, 0);
      const avgLevel = totalCount > 0
        ? levels.reduce((sum: number, l: any) => sum + l.level * l.vote_count, 0) / totalCount
        : 5;
      text = `Average rating: ${avgLevel.toFixed(1)}/10 -- ${truncate(duel.title, 100)}. What do you think?`;
    }

    res.json({ text });
  } catch (err: any) {
    console.error('[share-text] Error:', err?.message);
    res.status(500).json({ error: 'Failed to generate share text' });
  }
});

// Share page — serves HTML with Twitter Card meta tags, then redirects to SPA
router.get('/share/d/:slug', async (req: Request, res: Response) => {
  try {
    const slug = req.params.slug;
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) && !/^[a-z0-9]$/.test(slug)) {
      return res.status(400).send('Invalid slug');
    }
    const duel = await lookupDuel(slug);
    if (!duel) return res.redirect(`/d/${slug}`);

    // Determine app URL
    const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const apiUrl = process.env.VITE_API_URL || `${req.protocol}://${req.get('host')}`;
    const duelUrl = `${appUrl}/d/${duel.slug}`;
    const imageUrl = `${apiUrl}/api/duels/${duel.slug}/og-image`;

    const pct = duel.total_votes > 0 ? Math.round((duel.agree_count / duel.total_votes) * 100) : 50;
    const description = duel.duel_type === 'binary'
      ? `${pct}% agree. ${duel.total_votes} anonymous votes cast. What do you think?`
      : `${duel.total_votes} anonymous votes cast. What do you think?`;

    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(duel.title)} - Cloakboard</title>
  <meta name="description" content="${escapeXml(description)}"/>
  <meta property="og:title" content="${escapeXml(duel.title)}"/>
  <meta property="og:description" content="${escapeXml(description)}"/>
  <meta property="og:image" content="${imageUrl}"/>
  <meta property="og:url" content="${duelUrl}"/>
  <meta property="og:type" content="website"/>
  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${escapeXml(duel.title)}"/>
  <meta name="twitter:description" content="${escapeXml(description)}"/>
  <meta name="twitter:image" content="${imageUrl}"/>
  <meta http-equiv="refresh" content="0;url=${duelUrl}"/>
</head>
<body>
  <p>Redirecting to <a href="${duelUrl}">${escapeXml(duel.title)}</a>...</p>
</body>
</html>`);
  } catch (err: any) {
    console.error('[share-page] Error:', err?.message);
    res.redirect('/');
  }
});

export default router;
