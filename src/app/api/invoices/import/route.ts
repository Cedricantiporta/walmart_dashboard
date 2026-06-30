import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { clearCache } from '@/lib/server-cache';

type ImportInvoice = {
  invoice_number: string;
  client_name: string;
  billed_date: string;
  billed_fee: number;
  total_reimbursed: number;
  case_ids: string[];
  case_snapshot?: object[];
  pdf_url?: string;
};

export async function POST(req: NextRequest) {
  const body = await req.json();
  const invoices: ImportInvoice[] = Array.isArray(body) ? body : body.invoices;

  if (!Array.isArray(invoices) || invoices.length === 0) {
    return NextResponse.json({ error: 'Expected array of invoices' }, { status: 400 });
  }

  const db = createServerClient();

  const rows = invoices
    .filter(inv => inv.invoice_number)
    .map(inv => ({
      invoice_number: inv.invoice_number,
      client_name: inv.client_name,
      billed_date: inv.billed_date ?? new Date().toISOString(),
      billed_fee: Number(inv.billed_fee) || 0,
      total_reimbursed: Number(inv.total_reimbursed) || 0,
      case_ids: Array.isArray(inv.case_ids) ? inv.case_ids.map(String) : [],
      case_snapshot: inv.case_snapshot ?? [],
      pdf_url: inv.pdf_url ?? '',
    }));

  // Upsert — updates case_ids/snapshot on existing rows, inserts new ones
  const { error } = await db.from('invoices').upsert(rows, { onConflict: 'invoice_number' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Importing invoices marks cases billed → affects RTB, summary, analytics, initial
  clearCache();

  return NextResponse.json({ upserted: rows.length });
}
