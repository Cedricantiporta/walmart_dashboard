import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET() {
  const db = createServerClient();
  const { data } = await db.from('app_config').select('*');
  const settings: Record<string, string> = {};
  (data ?? []).forEach(({ key, value }: { key: string; value: string }) => { settings[key] = value; });
  return NextResponse.json(settings);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const db = createServerClient();

  const upserts = Object.entries(body).map(([key, value]) => ({
    key, value: String(value), updated_at: new Date().toISOString()
  }));

  const { error } = await db.from('app_config').upsert(upserts, { onConflict: 'key' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
