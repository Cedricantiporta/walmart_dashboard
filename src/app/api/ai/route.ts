import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, fetchAllRows } from '@/lib/supabase-server';
import { calculateDashboardAnalytics } from '@/lib/analytics';
import { DEFAULT_RATE, DEFAULT_VANTAGE_CUTOFF } from '@/lib/constants';
import { RmsCase, ClientInfo } from '@/types';

export const revalidate = 0;

interface ChatMessage { role: 'user' | 'assistant'; content: string; }

const money = (n: number) => `$${(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d: string | null) => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'no posting date';

type InvRow = { invoice_number: string; client_name: string; billed_date: string | null; billed_fee: number; total_reimbursed: number; case_ids: string[] };

async function buildContext(db: ReturnType<typeof createServerClient>, message: string) {
  // Asia/Singapore (GAS project tz) so "now"/grace match the dashboard
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Singapore' }));
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().slice(0, 10);
  const isGracePeriod = now.getDate() <= 7;

  const [
    allData,
    { data: clientsRaw },
    { data: invoicesRaw },
    { data: hardcodedRaw },
    { data: excludedRaw },
    { data: configRaw },
  ] = await Promise.all([
    fetchAllRows<RmsCase>(db, 'rms_cases'),
    db.from('clients').select('*'),
    db.from('invoices').select('invoice_number, client_name, billed_date, billed_fee, total_reimbursed, case_ids').order('billed_date', { ascending: false }),
    db.from('hardcoded_billed_cases').select('case_id, rms_posting_date'),
    db.from('excluded_clients').select('client_name'),
    db.from('app_config').select('key, value'),
  ]);

  const settings: Record<string, string> = {};
  (configRaw ?? []).forEach((r: { key: string; value: string }) => { settings[r.key] = r.value; });
  const vantageCutoff = settings['VANTAGE_CUTOFF_DATE'] ?? DEFAULT_VANTAGE_CUTOFF;
  const vCutoff = new Date(vantageCutoff + 'T00:00:00');

  const onboardingInfo: Record<string, ClientInfo> = {};
  (clientsRaw ?? []).forEach((c: ClientInfo) => { onboardingInfo[c.client_name] = c; });
  const findInfo = (name: string) =>
    onboardingInfo[name] ?? onboardingInfo[Object.keys(onboardingInfo).find(k => k.toLowerCase() === name.toLowerCase()) ?? ''];

  const excludedClients = new Set<string>((excludedRaw ?? []).map((r: { client_name: string }) => r.client_name.toLowerCase()));

  // Billed set + invoice lookup
  const invoices = (invoicesRaw ?? []) as InvRow[];
  const hardcodedBilledIds = (hardcodedRaw ?? []).map((r: { case_id: string; rms_posting_date: string | null }) =>
    r.rms_posting_date ? `${r.case_id}:${r.rms_posting_date}` : r.case_id);
  const invoiceBilledIds = [...new Set(invoices.flatMap(inv => (inv.case_ids ?? []).map(String)))];
  const billedSet = new Set([...invoiceBilledIds, ...hardcodedBilledIds]);
  const caseIdsWithDateEntries = new Set(hardcodedBilledIds.filter(id => id.includes(':')).map(id => id.split(':')[0]));
  const billedIds = [...new Set([...invoiceBilledIds, ...hardcodedBilledIds])];
  const invoiceByCase = new Map<string, InvRow>();
  invoices.forEach(inv => (inv.case_ids ?? []).forEach(cid => { if (!invoiceByCase.has(String(cid))) invoiceByCase.set(String(cid), inv); }));

  // Analytics (mirrors Overview cards + Monthly Recovery bars)
  const analytics = calculateDashboardAnalytics({ timeRange: 'thisMonth' }, allData, onboardingInfo, billedIds, vantageCutoff, excludedClients);

  // Ready-to-Bill + Pending (mirrors the Billing tab logic exactly)
  type Agg = { fee: number; recovered: number; cases: number };
  const rtb: Record<string, Agg> = {};
  const pending: Record<string, Agg> = {};
  const add = (m: Record<string, Agg>, name: string, amount: number, fee: number) => {
    if (!m[name]) m[name] = { fee: 0, recovered: 0, cases: 0 };
    m[name].fee += fee; m[name].recovered += amount; m[name].cases += 1;
  };
  for (const row of allData) {
    if (!row.rms_posting_date) continue;                                   // reimbursed only
    if ((row.reimbursement_amount ?? 0) <= 0) continue;
    if (row.reimbursement_status?.trim().toLowerCase() !== 'approved') continue;
    const name = row.client_name?.trim();
    if (!name) continue;
    if (excludedClients.has(name.toLowerCase())) continue;
    if (name.toLowerCase() === 'vantage inc' && new Date(row.rms_posting_date) < vCutoff) continue;
    const info = findInfo(name);
    if (!info || (info.status !== 'Client' && name !== 'Premium Convenience')) continue;
    const startStr = info?.pilot_end_date ?? info?.start_date;
    if (startStr && row.date_filed && new Date(row.date_filed) < new Date(startStr)) continue;
    const caseId = String(row.case_id);
    if (billedSet.has(`${caseId}:${row.rms_posting_date}`) || (billedSet.has(caseId) && !caseIdsWithDateEntries.has(caseId))) continue;
    if (row.rms_posting_date >= nextMonthStart) continue;                  // skip future
    const rate = info?.rate ?? DEFAULT_RATE;
    const amount = row.reimbursement_amount;
    const fee = amount * rate;
    const isCurrentMonth = row.rms_posting_date >= currentMonthStart;
    if (isGracePeriod && isCurrentMonth) add(pending, name, amount, fee);
    else add(rtb, name, amount, fee);
  }
  const sumAgg = (m: Record<string, Agg>) => Object.values(m).reduce((a, c) => ({ fee: a.fee + c.fee, recovered: a.recovered + c.recovered, cases: a.cases + c.cases }), { fee: 0, recovered: 0, cases: 0 });
  const rtbTotal = sumAgg(rtb);
  const pendingTotal = sumAgg(pending);

  // Invoice lifetime totals
  const invLifetime = invoices.reduce((a, inv) => ({ fee: a.fee + (Number(inv.billed_fee) || 0), recovered: a.recovered + (Number(inv.total_reimbursed) || 0) }), { fee: 0, recovered: 0 });

  // Case index for direct lookups
  const caseIndex = new Map<string, RmsCase[]>();
  for (const row of allData) {
    const id = String(row.case_id);
    if (!caseIndex.has(id)) caseIndex.set(id, []);
    caseIndex.get(id)!.push(row);
  }

  // Detect requested case IDs in the message (6–12 digit numbers)
  const requestedIds = [...new Set((message.match(/\b\d{6,12}\b/g) ?? []))].slice(0, 15);
  const caseLookups = requestedIds.map(id => {
    const rows = caseIndex.get(id);
    if (!rows || rows.length === 0) return `Case ${id} — NOT FOUND in the system.`;
    const inv = invoiceByCase.get(id);
    const lines = rows.map(r => `${r.client_name?.trim()} · ${r.claim_type ?? 'Other'} · posting ${fmtDate(r.rms_posting_date)} · ${money(r.reimbursement_amount ?? 0)} · ${r.reimbursement_status ?? 'no status'}`);
    const total = rows.reduce((s, r) => s + (r.reimbursement_amount ?? 0), 0);
    const billedNote = inv ? `BILLED on invoice ${inv.invoice_number} (${fmtDate(inv.billed_date)})` : (billedSet.has(id) ? 'marked billed (hardcoded)' : 'NOT billed yet');
    const totalNote = rows.length > 1 ? ` | ${rows.length} line items, total ${money(total)}` : '';
    return `Case ${id}: ${lines.join(' ; ')} | ${billedNote}${totalNote}`;
  });

  // Build text context
  const monthly = analytics.monthlyHistory.slice(0, 12)
    .map(m => `${m.label}: recovered ${money(m.recovered)}, fee ${money(m.fee)}, ${m.approvedCount} cases`).join('\n');

  const rtbLines = Object.entries(rtb).sort((a, b) => b[1].fee - a[1].fee)
    .map(([n, a]) => `${n}: fee ${money(a.fee)} (recovered ${money(a.recovered)}, ${a.cases} cases)`).join('\n');
  const pendingLines = Object.entries(pending).sort((a, b) => b[1].fee - a[1].fee)
    .map(([n, a]) => `${n}: fee ${money(a.fee)} (recovered ${money(a.recovered)}, ${a.cases} cases)`).join('\n');

  const recentInvoices = invoices.slice(0, 20)
    .map(inv => `${inv.invoice_number} | ${inv.client_name} | ${fmtDate(inv.billed_date)} | recovered ${money(inv.total_reimbursed)} | fee ${money(inv.billed_fee)} | ${(inv.case_ids ?? []).length} cases`).join('\n');

  const activeClients = (clientsRaw ?? []).filter((c: ClientInfo) => c.status === 'Client')
    .map((c: ClientInfo) => `${c.client_name} (${(c.rate * 100).toFixed(0)}%)`).join(', ');

  const todayStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const curMonthLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return `Today (Asia/Singapore): ${todayStr}
Grace period active (1st–7th, current-month cases held in Pending): ${isGracePeriod ? 'YES' : 'no'}

OVERVIEW — CURRENT MONTH (${curMonthLabel}):
- Reimbursed (current outstanding, unbilled): ${money(analytics.metrics.totalReimbursed)}
- Fees (current): ${money(analytics.metrics.totalFees)}
- Approved cases (current bucket): ${analytics.metrics.approvedCases}
- Pending total (held during grace): ${money(pendingTotal.recovered)} recovered / ${money(pendingTotal.fee)} fee / ${pendingTotal.cases} cases
- Reimbursed + Pending combined: ${money(analytics.metrics.totalReimbursed + pendingTotal.recovered)}

MONTHLY RECOVERY (recovered by posting month; billed cases sit in their month):
${monthly || 'none'}

READY TO BILL — by client (unbilled, reimbursed${isGracePeriod ? ', prior month during grace' : ''}):
${rtbLines || 'none'}
RTB TOTAL: ${money(rtbTotal.recovered)} recovered / ${money(rtbTotal.fee)} fee / ${rtbTotal.cases} cases

PENDING — by client (current-month, held during grace):
${pendingLines || 'none (not in grace, or no current-month cases)'}
PENDING TOTAL: ${money(pendingTotal.recovered)} recovered / ${money(pendingTotal.fee)} fee / ${pendingTotal.cases} cases

INVOICES — lifetime: ${invoices.length} invoices, total billed fee ${money(invLifetime.fee)}, total recovered ${money(invLifetime.recovered)}
Recent invoices:
${recentInvoices || 'none'}

ACTIVE CLIENTS (${(clientsRaw ?? []).filter((c: ClientInfo) => c.status === 'Client').length}): ${activeClients || 'none'}

${caseLookups.length ? `REQUESTED CASE LOOKUPS (from the user's message):\n${caseLookups.join('\n')}` : ''}`;
}

export async function POST(req: NextRequest) {
  try {
    const { message, history = [] }: { message: string; history: ChatMessage[] } = await req.json();
    if (!message?.trim()) return NextResponse.json({ error: 'No message' }, { status: 400 });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not set' }, { status: 500 });

    const db = createServerClient();
    const context = await buildContext(db, message);

    const systemInstruction = `You are the assistant for a Walmart Fulfillment Services claims-recovery dashboard. Answer ONLY from the live data below — never invent numbers.

You can:
- Look up any case by its Case ID (details are pre-resolved under REQUESTED CASE LOOKUPS when the user mentions an ID). Report claim type, posting date, amount, status, and whether it's billed/which invoice.
- Report totals for Ready to Bill, Pending, Invoices, Monthly Recovery, and the Overview cards — overall or per client.
- Combine figures when asked (e.g. "Reimbursed + Pending"); the combined value is precomputed where common, otherwise add the labeled numbers yourself.

Rules: A case is only "reimbursed" when it has an RMS Posting Date. Be concise — lead with the answer, use short lines, format money as $X.XX. If the data below doesn't contain the answer, say so plainly rather than guessing.

LIVE DATA:
${context}`;

    const contents = [
      ...history.slice(-8).map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
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
          generationConfig: { maxOutputTokens: 1024, temperature: 0.3 },
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
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
