import { NextRequest, NextResponse } from 'next/server';
import { ScorerService, type ScoreRequest } from '@/lib/scorer';

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }

  let body: ScoreRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.resume || typeof body.resume !== 'object') {
    return NextResponse.json({ error: 'resume field is required and must be an object' }, { status: 400 });
  }

  try {
    const scorer = new ScorerService(apiKey);
    const result = await scorer.score(body);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Scoring failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
