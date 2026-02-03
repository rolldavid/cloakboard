import { jsonError, jsonSuccess } from '../../../helpers';
import { getContent } from '@/lib/molt/r2';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ cloakId: string; hash: string }> }
) {
  const { cloakId, hash } = await params;

  try {
    const plaintext = await getContent(hash);
    if (!plaintext) {
      return jsonError('Content not found', 404);
    }

    return jsonSuccess({ hash, plaintext });
  } catch (error) {
    console.error('Resolve content error:', error);
    return jsonError('Failed to resolve content', 500);
  }
}
