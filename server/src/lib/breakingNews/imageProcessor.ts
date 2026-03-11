/**
 * Image processor for breaking news thumbnails.
 *
 * Pipeline: download source image → detect face via Rekognition →
 * crop square around face (or center-crop) → upload to Cloudflare R2.
 *
 * Returns the public R2 URL for the processed image.
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { RekognitionClient, DetectFacesCommand } from '@aws-sdk/client-rekognition';
import sharp from 'sharp';
import crypto from 'crypto';

const SQUARE_SIZE = 400; // output px

let r2: S3Client | null = null;
let rekognition: RekognitionClient | null = null;

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

function getRekognition(): RekognitionClient {
  if (!rekognition) {
    rekognition = new RekognitionClient({ region: process.env.AWS_REGION || 'us-east-1' });
  }
  return rekognition;
}

/**
 * Download an image from a URL. Returns the raw buffer or null on failure.
 */
async function downloadImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'DuelCloak/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.startsWith('image/')) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Detect the most prominent face bounding box using Rekognition.
 * Returns { left, top, width, height } as fractions (0-1) or null if no face.
 */
async function detectFace(imageBytes: Buffer): Promise<{
  left: number; top: number; width: number; height: number;
} | null> {
  try {
    const result = await getRekognition().send(
      new DetectFacesCommand({
        Image: { Bytes: imageBytes },
        Attributes: ['DEFAULT'],
      }),
    );

    const faces = result.FaceDetails;
    if (!faces || faces.length === 0) return null;

    // Pick the largest face (highest confidence as tiebreaker)
    const best = faces.reduce((a, b) => {
      const areaA = (a.BoundingBox?.Width || 0) * (a.BoundingBox?.Height || 0);
      const areaB = (b.BoundingBox?.Width || 0) * (b.BoundingBox?.Height || 0);
      return areaB > areaA ? b : a;
    });

    const box = best.BoundingBox;
    if (!box || box.Left == null || box.Top == null || box.Width == null || box.Height == null) {
      return null;
    }

    return { left: box.Left, top: box.Top, width: box.Width, height: box.Height };
  } catch (err: any) {
    console.warn('[imageProcessor] Rekognition failed, falling back to center crop:', err?.message);
    return null;
  }
}

/**
 * Crop a square region from the image, centered on the face if detected.
 * Falls back to center crop when no face is found.
 */
async function cropSquare(imageBuffer: Buffer, face: {
  left: number; top: number; width: number; height: number;
} | null): Promise<Buffer> {
  const metadata = await sharp(imageBuffer).metadata();
  const imgW = metadata.width!;
  const imgH = metadata.height!;

  let centerX: number;
  let centerY: number;

  if (face) {
    // Center on the face, biased slightly upward to include forehead
    centerX = Math.round((face.left + face.width / 2) * imgW);
    centerY = Math.round((face.top + face.height * 0.4) * imgH);
  } else {
    // Default center crop
    centerX = Math.round(imgW / 2);
    centerY = Math.round(imgH / 2);
  }

  // Square side = the smaller image dimension (to maximize crop area)
  const side = Math.min(imgW, imgH);

  // Clamp the crop region to image bounds
  let left = Math.max(0, centerX - Math.round(side / 2));
  let top = Math.max(0, centerY - Math.round(side / 2));
  if (left + side > imgW) left = imgW - side;
  if (top + side > imgH) top = imgH - side;
  left = Math.max(0, left);
  top = Math.max(0, top);

  const extractW = Math.min(side, imgW - left);
  const extractH = Math.min(side, imgH - top);

  return sharp(imageBuffer)
    .extract({ left, top, width: extractW, height: extractH })
    .resize(SQUARE_SIZE, SQUARE_SIZE)
    .jpeg({ quality: 80 })
    .toBuffer();
}

/**
 * Upload a buffer to R2 and return the public URL.
 */
async function uploadToR2(buffer: Buffer, key: string): Promise<string> {
  const bucket = process.env.R2_BUCKET;
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (!bucket) throw new Error('R2_BUCKET not set');
  if (!publicUrl) throw new Error('R2_PUBLIC_URL not set');

  await getR2().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=31536000',
    }),
  );

  return `${publicUrl.replace(/\/$/, '')}/${key}`;
}

/**
 * Full pipeline: download → face detect → crop → upload to R2 → return public URL.
 * Returns null if any step fails (non-blocking for duel creation).
 */
export async function processBreakingImage(sourceUrl: string): Promise<string | null> {
  try {
    const imageBuffer = await downloadImage(sourceUrl);
    if (!imageBuffer) {
      console.warn('[imageProcessor] Failed to download:', sourceUrl);
      return null;
    }

    const face = await detectFace(imageBuffer);
    if (face) {
      console.log(`[imageProcessor] Face detected at (${(face.left * 100).toFixed(0)}%, ${(face.top * 100).toFixed(0)}%)`);
    }

    const cropped = await cropSquare(imageBuffer, face);
    const hash = crypto.createHash('md5').update(sourceUrl).digest('hex').slice(0, 12);
    const key = `breaking-news/${hash}.jpg`;
    const r2Url = await uploadToR2(cropped, key);

    console.log(`[imageProcessor] Uploaded: ${key} (face: ${face ? 'yes' : 'no'})`);
    return r2Url;
  } catch (err: any) {
    console.error('[imageProcessor] Pipeline failed:', err?.message);
    return null;
  }
}
