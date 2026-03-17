/**
 * OG Image Generator — generates PNG vote snapshots and uploads to R2.
 * Called after vote tally sync so images are always fresh for sharing.
 *
 * Supports all 3 duel types: binary, multi-item, and level.
 * R2 key includes a vote-count hash for cache busting.
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { pool } from './db/pool.js';

let r2: S3Client | null = null;

function getR2(): S3Client {
  if (!r2) {
    r2 = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return r2;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '\u2026';
}

// ─── SVG Generators ───

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
    <text x="600" y="580" text-anchor="middle" fill="#8b8fa3" font-family="system-ui,sans-serif" font-size="18">cloakboard.com</text>
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
    <text x="600" y="590" text-anchor="middle" fill="#6366f1" font-family="system-ui,sans-serif" font-size="22" font-weight="600">What do you think? Vote anonymously on cloakboard.com</text>
  </svg>`;
}

function generateLevelSvg(title: string, levels: Array<{level: number; vote_count: number; label?: string}>, totalVotes: number): string {
  const w = 1200, h = 630;
  const barX = 80, barW = w - 160;
  const maxCount = Math.max(...levels.map(l => l.vote_count), 1);
  const startY = 240, rowH = 36;
  const displayLevels = levels.slice(0, 10);

  const bars = displayLevels.map((lvl, i) => {
    const y = startY + i * rowH;
    const fillW = Math.max((lvl.vote_count / maxCount) * barW * 0.8, 2);
    const label = lvl.label || `Level ${lvl.level}`;
    return `
      <rect x="${barX}" y="${y}" width="${barW}" height="28" rx="6" fill="#1e2030"/>
      <rect x="${barX}" y="${y}" width="${fillW}" height="28" rx="6" fill="#8b5cf6" opacity="0.7"/>
      <text x="${barX + 10}" y="${y + 19}" fill="#e4e6ed" font-family="system-ui,sans-serif" font-size="14" font-weight="500">${escapeXml(truncate(label, 30))}</text>
      <text x="${barX + barW - 10}" y="${y + 19}" text-anchor="end" fill="#c4b5fd" font-family="system-ui,sans-serif" font-size="14" font-weight="700">${lvl.vote_count}</text>
    `;
  }).join('');

  // Compute weighted average
  const totalCount = levels.reduce((sum, l) => sum + l.vote_count, 0);
  const avgLevel = totalCount > 0
    ? levels.reduce((sum, l) => sum + l.level * l.vote_count, 0) / totalCount
    : 0;
  const avgText = totalCount > 0 ? `Average: ${avgLevel.toFixed(1)}` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <rect width="${w}" height="${h}" fill="#0f1117"/>
    <text x="600" y="80" text-anchor="middle" fill="#8b8fa3" font-family="system-ui,sans-serif" font-size="20" font-weight="500">CLOAKBOARD</text>
    <text x="600" y="160" text-anchor="middle" fill="#e4e6ed" font-family="system-ui,sans-serif" font-size="32" font-weight="700">${escapeXml(truncate(title, 60))}</text>
    <text x="600" y="210" text-anchor="middle" fill="#8b8fa3" font-family="system-ui,sans-serif" font-size="20">${totalVotes} vote${totalVotes !== 1 ? 's' : ''}${avgText ? ` \u00B7 ${avgText}` : ''}</text>
    ${bars}
    <text x="600" y="600" text-anchor="middle" fill="#6366f1" font-family="system-ui,sans-serif" font-size="22" font-weight="600">What do you think? Vote anonymously on cloakboard.com</text>
  </svg>`;
}

// ─── Upload ───

/**
 * Generate OG image for a duel and upload to R2.
 * Key includes total_votes for cache busting — URL changes when votes change.
 * Returns the public R2 URL, or null on failure.
 */
export async function generateAndUploadOgImage(duelId: number): Promise<string | null> {
  const bucket = process.env.R2_BUCKET;
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (!bucket || !publicUrl) return null;

  try {
    const duelResult = await pool.query(
      `SELECT id, slug, title, duel_type, agree_count, disagree_count, total_votes FROM duels WHERE id = $1`,
      [duelId],
    );
    const duel = duelResult.rows[0];
    if (!duel) return null;

    let svg: string;
    if (duel.duel_type === 'multi') {
      const opts = await pool.query(
        `SELECT label, vote_count FROM duel_options WHERE duel_id = $1 ORDER BY vote_count DESC`,
        [duelId],
      );
      svg = generateMultiSvg(duel.title, opts.rows, duel.total_votes);
    } else if (duel.duel_type === 'level') {
      const lvls = await pool.query(
        `SELECT level, vote_count, label FROM duel_levels WHERE duel_id = $1 ORDER BY level`,
        [duelId],
      );
      svg = generateLevelSvg(duel.title, lvls.rows, duel.total_votes);
    } else {
      svg = generateBinarySvg(duel.title, duel.agree_count, duel.disagree_count, duel.total_votes);
    }

    const png = await sharp(Buffer.from(svg)).png().toBuffer();

    // Cache-busting key: total_votes in the filename so URL changes with each vote
    const key = `og/${duel.slug}-v${duel.total_votes}.png`;
    await getR2().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: png,
        ContentType: 'image/png',
        CacheControl: 'public, max-age=86400',
      }),
    );

    const ogUrl = `${publicUrl.replace(/\/$/, '')}/${key}`;
    await pool.query(`UPDATE duels SET og_image_url = $1 WHERE id = $2`, [ogUrl, duelId]);

    return ogUrl;
  } catch (err: any) {
    console.warn(`[ogImage] Failed for duel ${duelId}:`, err?.message);
    return null;
  }
}

/**
 * Refresh OG images for all active duels that have votes.
 * Called from the cron after tally sync.
 */
export async function refreshOgImages(): Promise<number> {
  try {
    // Only regenerate for duels where vote count changed (og_image_url won't match current count)
    const result = await pool.query(`
      SELECT id, slug, total_votes, og_image_url
      FROM duels
      WHERE status = 'active' AND total_votes > 0
    `);
    let updated = 0;
    for (const row of result.rows) {
      // Skip if image URL already matches current vote count
      const expectedSuffix = `-v${row.total_votes}.png`;
      if (row.og_image_url && row.og_image_url.endsWith(expectedSuffix)) continue;

      const url = await generateAndUploadOgImage(row.id);
      if (url) updated++;
    }
    return updated;
  } catch (err: any) {
    console.warn('[ogImage] Refresh failed:', err?.message);
    return 0;
  }
}
