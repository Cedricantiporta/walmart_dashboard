import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { getCached, setCached, clearCache } from '@/lib/server-cache';

export async function GET() {
  const cached = getCached('invoices:all');
  if (cached) return NextResponse.json(cached);

  const db = createServerClient();
  const { data, error } = await db.from('invoices').select('*').order('invoice_number', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  setCached('invoices:all', data, 2 * 60 * 1000);
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { invoice_number, client_name, billed_date, billed_fee, total_reimbursed, case_ids, case_snapshot, pdf_url } = body;

  if (!invoice_number || !client_name) {
    return NextResponse.json({ error: 'invoice_number and client_name required' }, { status: 400 });
  }

  const db = createServerClient();
  const { data, error } = await db.from('invoices').insert({
    invoice_number, client_name, billed_date: billed_date ?? new Date().toISOString(),
    billed_fee, total_reimbursed, case_ids: case_ids ?? [], case_snapshot: case_snapshot ?? [],
    pdf_url: pdf_url ?? '',
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, invoice: data });
}
