import { NextResponse } from 'next/server';
import { clearCache } from '@/lib/server-cache';

export const revalidate = 0;

export async function POST() {
  clearCache();
  return NextResponse.json({ cleared: true });
}
