import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET() {
  const db = createServerClient();
  const { data } = await db.from('invoices').select('invoice_number');
  let maxNum = 1000;
  let prefix = 'NV';
  (data ?? []).forEach(({ invoice_number }: { invoice_number: string }) => {
    if (!invoice_number) return;
    const dashIdx = invoice_number.search(/-\d/);
    if (dashIdx < 0) return;
    const p = invoice_number.slice(0, dashIdx);
    const n = parseInt(invoice_number.slice(dashIdx + 1));
    if (!isNaN(n) && n > maxNum) { maxNum = n; prefix = p; }
  });
  return NextResponse.json({ nextNumber: `${prefix}-${maxNum + 1}` });
}
