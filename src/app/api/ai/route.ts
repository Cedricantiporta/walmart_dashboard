import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export const revalidate = 0;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

async function fetchContext(db: ReturnType<typeof createServerClient>) {
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

  const [
    { data: clients },
    { data: recentInvoices },
    { data: currentCases },
    { data: config },
  ] = await Promise.all([
    db.from('clients').select('client_name, status, rate, onboard_date').eq('status', 'Client').order('client_name'),
    db.from('invoices').select('client_name, billed_date, billed_fee, total_reimbursed, case_ids').order('billed_date', { ascending: false }).limit(50),
    db.from('rms_cases').select('client_name, case_id, reimbursement_status, reimbursement_amount, rms_posting_date').gte('rms_posting_date', currentMonthStart),
    db.from('app_config').select('key, value'),
  ]);

  const settings: Record<string, string> = {};
  (config ?? []).forEach((r: { key: string; value: string }) => { settings[r.key] = r.value; });

  // Aggregate current month
  let curRecovered = 0;
  let curApproved = 0;
  let curDeclined = 0;
  (currentCases ?? []).forEach((c: { reimbursement_status: string | null; reimbursement_amount: number }) => {
    const s = c.reimbursement_status?.toLowerCase();
    if (s === 'approved') { curRecovered += c.reimbursement_amount; curApproved++; }
    if (s === 'declined') curDeclined++;
  });

  // Recent 6 invoices summary
  const recentInvoiceSummary = (recentInvoices ?? []).slice(0, 20).map((inv: {
    client_name: string; billed_date: string; billed_fee: number; total_reimbursed: number; case_ids: string[];
  }) =>
    `${inv.client_name} | ${inv.billed_date} | recovered $${inv.total_reimbursed?.toFixed(2)} | fee $${inv.billed_fee?.toFixed(2)} | ${(inv.case_ids ?? []).length} cases`
  ).join('\n');

  const clientList = (clients ?? []).map((c: { client_name: string; rate: number; onboard_date: string | null }) =>
    `${c.client_name} (rate: ${(c.rate * 100).toFixed(0)}%, since: ${c.onboard_date ?? 'unknown'})`
  ).join(', ');

  const todayStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return `Today: ${todayStr}

ACTIVE CLIENTS (${(clients ?? []).length} total):
${clientList || 'none'}

CURRENT MONTH STATS (${now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}):
- Total recovered: $${curRecovered.toFixed(2)}
- Approved cases: ${curApproved}
- Declined cases: ${curDeclined}

RECENT INVOICES (last 20):
${recentInvoiceSummary || 'none'}

SETTINGS:
${Object.entries(settings).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'}`;
}

export async function POST(req: NextRequest) {
  try {
    const { message, history = [] }: { message: string; history: ChatMessage[] } = await req.json();
    if (!message?.trim()) return NextResponse.json({ error: 'No message' }, { status: 400 });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not set' }, { status: 500 });

    const db = createServerClient();
    const context = await fetchContext(db);

    const systemInstruction = `You are an AI assistant for a Walmart Claims Recovery dashboard. You help the user understand their recovery data, billing status, client performance, and trends.

You have access to live database context below. Answer questions based on this data. Be concise and helpful. Format numbers as currency when relevant. If you don't know something or the data doesn't cover it, say so.

DATABASE CONTEXT:
${context}`;

    // Build Gemini contents array
    const contents = [
      ...history.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      { role: 'user', parts: [{ text: message }] },
    ];

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents,
          generationConfig: { maxOutputTokens: 1024, temperature: 0.7 },
        }),
      }
    );

    if (!geminiRes.ok) {
      const err = await geminiRes.text();
      return NextResponse.json({ error: `Gemini error: ${err}` }, { status: 500 });
    }

    const geminiData = await geminiRes.json();
    const reply = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? 'No response from AI.';

    return NextResponse.json({ reply });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
