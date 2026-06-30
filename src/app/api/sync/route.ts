import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { clearCache } from '@/lib/server-cache';

export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.SYNC_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { type, data } = body as { type: string; data: Record<string, unknown>[] };

  if (!type || !Array.isArray(data)) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const db = createServerClient();

  if (type === 'rms_cases') {
    // Full-replace via atomic RPC: advisory lock serializes concurrent syncs,
    // delete+insert runs in one transaction so readers never see a partial table.
    const { data: count, error } = await db.rpc('sync_rms_cases', { payload: data });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    clearCache();
    return NextResponse.json({ synced: count, type });
  }

  if (type === 'clients') {
    // Full-replace via atomic RPC — see sync_rms_cases above for why this matters.
    const { data: count, error } = await db.rpc('sync_clients', { payload: data });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    clearCache();
    return NextResponse.json({ synced: count, type });
  }

  if (type === 'billing_contacts') {
    const { error } = await db.from('billing_contacts').upsert(data, { onConflict: 'client_name' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    clearCache();
    return NextResponse.json({ synced: data.length, type });
  }

  // invoices — camelCase from old GAS migrateInvoicesToSupabase()
  if (type === 'invoices') {
    const mapped = data.map((inv: Record<string, unknown>) => ({
      invoice_number:   inv.invoiceNumber,
      client_name:      inv.clientName,
      billed_date:      inv.billedDate,
      billed_fee:       inv.billedFee,
      total_reimbursed: inv.totalReimbursed,
      case_ids:         inv.caseIds ?? [],
      case_snapshot:    inv.caseSnapshot ?? [],
      pdf_url:          inv.pdfUrl ?? '',
    }));
    const { error } = await db.from('invoices').upsert(mapped, { onConflict: 'invoice_number' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    clearCache();
    return NextResponse.json({ synced: mapped.length, type });
  }

  // invoices_raw — already snake_case from new GAS _migrateInvoiceLog()
  if (type === 'invoices_raw') {
    const { error } = await db.from('invoices').upsert(data, { onConflict: 'invoice_number' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    clearCache();
    return NextResponse.json({ synced: data.length, type });
  }

  return NextResponse.json({ error: 'Unknown sync type' }, { status: 400 });
}
