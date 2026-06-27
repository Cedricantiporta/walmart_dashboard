import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET() {
  const db = createServerClient();
  const { data } = await db.from('invoices').select('invoice_number');
  let maxNum = 1000;
  (data ?? []).forEach(({ invoice_number }: { invoice_number: string }) => {
    const parts = invoice_number?.split('-');
    if (parts?.length > 1) {
      const n = parseInt(parts[1]);
      if (!isNaN(n) && n > maxNum) maxNum = n;
    }
  });
  return NextResponse.json({ nextNumber: `INV-${maxNum + 1}` });
}
