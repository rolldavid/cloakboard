import { NextRequest, NextResponse } from 'next/server';
import { jsonError } from '../../helpers';
import { isMoltPublic, readMoltPosts, getMoltSchedule } from '@/lib/molt/serviceWallet';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ cloakId: string }> }
) {
  const { cloakId } = await params;

  try {
    const isPublic = await isMoltPublic(cloakId);
    if (!isPublic) {
      const schedule = await getMoltSchedule(cloakId);
      return NextResponse.json({
        private: true,
        public_hours_per_day: schedule.hoursPerDay,
        window_start_utc: schedule.startHour,
      });
    }

    const searchParams = request.nextUrl.searchParams;
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));

    const { posts, total } = await readMoltPosts(cloakId, page, limit);

    return NextResponse.json({
      private: false,
      posts,
      total,
      page,
    });
  } catch (error) {
    console.error('[public-feed] Error:', error);
    return jsonError('Failed to load feed', 500);
  }
}
