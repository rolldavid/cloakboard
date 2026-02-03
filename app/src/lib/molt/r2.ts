import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const bucket = process.env.R2_BUCKET_NAME!;

function sanitizeKey(hash: string): string {
  if (!/^[0-9a-fA-F]+$/.test(hash) || hash.length < 16 || hash.length > 128) {
    throw new Error('Invalid content hash');
  }
  return hash.toLowerCase();
}

export async function putContent(hash: string, plaintext: string): Promise<void> {
  await r2.send(new PutObjectCommand({
    Bucket: bucket,
    Key: sanitizeKey(hash),
    Body: plaintext,
    ContentType: 'text/plain',
  }));
}

export async function getContent(hash: string): Promise<string | null> {
  try {
    const result = await r2.send(new GetObjectCommand({
      Bucket: bucket,
      Key: sanitizeKey(hash),
    }));
    return (await result.Body?.transformToString()) ?? null;
  } catch (err: any) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw err;
  }
}
