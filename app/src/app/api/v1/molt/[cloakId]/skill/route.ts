import { NextResponse } from 'next/server';
import { generateSkill } from '@/lib/molt/SkillGenerator';
import { getCloakId } from '../../helpers';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ cloakId: string }> }
) {
  const { cloakId } = await params;
  const id = getCloakId({ cloakId });

  // Config defaults — reading actual config from contract requires a wallet (client-side)
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://cloakboard.xyz';
  const apiBase = `${baseUrl}/api/v1/molt/${id}`;

  const skill = generateSkill({
    name: `Molt ${id}`,
    cloakId: id,
    apiBase,
    rateLimits: { postCooldown: 1800, commentCooldown: 20, dailyLimit: 50 },
    discussionPublic: true,
  });

  return new NextResponse(skill, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
}
