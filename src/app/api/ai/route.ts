import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, fetchAllRows } from '@/lib/supabase-server';
import { getCached, setCached } from '@/lib/server-cache';
import { calculateDashboardAnalytics } from '@/lib/analytics';
import { DEFAULT_RATE, DEFAULT_VANTAGE_CUTOFF } from '@/lib/constants';
import { RmsCase, ClientInfo } from '@/types';

export const revalidate = 0;

interface ChatMessage { role: 'user' | 'assistant'; content: string; }

const money = (n: number) => `$${(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d: string | null) => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'no posting date';

type InvRow = { invoice_number: string; client_name: string; billed_date: string | null; billed_fee: number; total_reimbursed: number; case_ids: string[] };

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4,
  jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};
const lastDay = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
const isoDate = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// Parse a date range from natural language: "May 1 to July 22", "Jan to May", "2026-05-01 to 2026-07-22"
function parseDateRange(msg: string, defaultYear: number): { startISO: string; endISO: string; label: string } | null {
  const text = msg.toLowerCase();
  const isoPair = text.match(/(\d{4}-\d{2}-\d{2})\D+(\d{4}-\d{2}-\d{2})/);
  if (isoPair) return { startISO: isoPair[1], endISO: isoPair[2], label: `${isoPair[1]} to ${isoPair[2]}` };
  const mn = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const re = new RegExp(mn + '\\s*(\\d{1,2})?(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?\\s*(?:to|through|thru|until|[-–—])\\s*' + mn + '\\s*(\\d{1,2})?(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?', 'i');
  const m = text.match(re);
  if (m) {
    const m1 = MONTHS[m[1]], m2 = MONTHS[m[4]];
    if (m1 != null && m2 != null) {
      const y1 = m[3] ? parseInt(m[3]) : defaultYear;
      const y2 = m[6] ? parseInt(m[6]) : defaultYear;
      const d1 = m[2] ? parseInt(m[2]) : 1;
      const d2 = m[5] ? parseInt(m[5]) : lastDay(y2, m2);
      return { startISO: isoDate(y1, m1, d1), endISO: isoDate(y2, m2, d2), label: `${isoDate(y1, m1, d1)} to ${isoDate(y2, m2, d2)}` };
    }
  }
  return null;
}

type RawData = {
  allData: RmsCase[];
  clientsRaw: ClientInfo[] | null;
  invoicesRaw: InvRow[] | null;
  hardcodedRaw: { case_id: string; rms_posting_date: string | null }[] | null;
  excludedRaw: { client_name: string }[] | null;
  configRaw: { key: string; value: string }[] | null;
};

// The DB round-trips are the slow part; cache them 60s. In-memory compute stays fresh per message.
// clearCache() (called on every sync + invoice mutation) drops this so new data shows immediately.
async function getRawData(db: ReturnType<typeof createServerClient>): Promise<RawData> {
  const cached = getCached<RawData>('ai-rawdata');
  if (cached) return cached;
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
  const raw: RawData = {
    allData,
    clientsRaw: (clientsRaw ?? null) as ClientInfo[] | null,
    invoicesRaw: (invoicesRaw ?? null) as InvRow[] | null,
    hardcodedRaw: (hardcodedRaw ?? null) as RawData['hardcodedRaw'],
    excludedRaw: (excludedRaw ?? null) as RawData['excludedRaw'],
    configRaw: (configRaw ?? null) as RawData['configRaw'],
  };
  setCached('ai-rawdata', raw, 60 * 1000);
  return raw;
}

// Detect a client name mentioned in the message (matches core name or a distinctive first word)
const GENERIC_WORDS = new Set(['the', 'llc', 'inc', 'co', 'corp', 'ltd', 'company', 'group']);
function detectClient(message: string, clientNames: string[]): string | null {
  const t = ` ${message.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ')} `;
  let best: string | null = null, bestScore = 0;
  for (const name of clientNames) {
    const clean = name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const core = clean.replace(/\b(llc|inc|co|corp|ltd|company)\b/g, ' ').replace(/\s+/g, ' ').trim();
    const first = core.split(' ')[0] || '';
    const cands: string[] = [];
    if (core.length >= 4) cands.push(core);
    if (first.length >= 4 && !GENERIC_WORDS.has(first)) cands.push(first);
    for (const c of cands) {
      if (c.length > bestScore && t.includes(` ${c} `)) { best = name; bestScore = c.length; }
    }
  }
  return best;
}

async function buildContext(db: ReturnType<typeof createServerClient>, message: string) {
  // Asia/Singapore (GAS project tz) so "now"/grace match the dashboard
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Singapore' }));
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().slice(0, 10);
  const isGracePeriod = now.getDate() <= 7;

  const { allData, clientsRaw, invoicesRaw, hardcodedRaw, excludedRaw, configRaw } = await getRawData(db);

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

  // Detect requested invoice numbers (e.g. NV-1042) and resolve full detail
  const requestedInvNums = [...new Set((message.match(/\b(?:NV|INV)-\d+[a-z]?\b/gi) ?? []).map(s => s.toUpperCase()))].slice(0, 8);
  const invLookups = requestedInvNums.map(num => {
    const inv = invoices.find(i => i.invoice_number.toUpperCase() === num);
    if (!inv) return `Invoice ${num} — NOT FOUND.`;
    const ids = (inv.case_ids ?? []).map(String);
    const idList = ids.slice(0, 40).join(', ') + (ids.length > 40 ? ` … (+${ids.length - 40} more)` : '');
    return `Invoice ${inv.invoice_number}: ${inv.client_name} · billed ${fmtDate(inv.billed_date)} · recovered ${money(inv.total_reimbursed)} · fee ${money(inv.billed_fee)} · ${ids.length} cases | case IDs: ${idList || 'none'}`;
  });

  // Eligibility filter = a real recovered case (same rules as billing/analytics)
  const eligible = (row: RmsCase) => {
    if (!row.rms_posting_date) return null;
    if ((row.reimbursement_amount ?? 0) <= 0) return null;
    if (row.reimbursement_status?.trim().toLowerCase() !== 'approved') return null;
    const nm = row.client_name?.trim(); if (!nm) return null;
    if (excludedClients.has(nm.toLowerCase())) return null;
    if (nm.toLowerCase() === 'vantage inc' && new Date(row.rms_posting_date) < vCutoff) return null;
    const info = findInfo(nm);
    if (!info || (info.status !== 'Client' && nm !== 'Premium Convenience')) return null;
    const startStr = info?.pilot_end_date ?? info?.start_date;
    if (startStr && row.date_filed && new Date(row.date_filed) < new Date(startStr)) return null;
    const rate = info?.rate ?? DEFAULT_RATE;
    return { amount: row.reimbursement_amount, fee: row.reimbursement_amount * rate, posting: row.rms_posting_date };
  };

  // Recovered by ACTUAL posting month (all approved passing filters — billed + unbilled).
  // Accurate for range/trend analysis (unlike the redirected Overview bars).
  const rawMonthlyMap: Record<string, { recovered: number; fee: number; cases: number }> = {};
  for (const row of allData) {
    const e = eligible(row); if (!e) continue;
    const mk = e.posting.slice(0, 7);
    if (!rawMonthlyMap[mk]) rawMonthlyMap[mk] = { recovered: 0, fee: 0, cases: 0 };
    rawMonthlyMap[mk].recovered += e.amount; rawMonthlyMap[mk].fee += e.fee; rawMonthlyMap[mk].cases += 1;
  }
  const monthly = Object.entries(rawMonthlyMap).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 15)
    .map(([mk, v]) => `${mk}: recovered ${money(v.recovered)}, fee ${money(v.fee)}, ${v.cases} cases`).join('\n');

  // Exact total for a date range mentioned in the message (e.g. "May 1 to July 22")
  const range = parseDateRange(message, now.getFullYear());
  let rangeSection = '';
  if (range) {
    let rr = 0, rf = 0, rc = 0;
    for (const row of allData) {
      const e = eligible(row); if (!e) continue;
      if (e.posting >= range.startISO && e.posting <= range.endISO) { rr += e.amount; rf += e.fee; rc += 1; }
    }
    rangeSection = `RECOVERED — ALL CLIENTS — FOR ${range.label} (by RMS posting date): recovered ${money(rr)}, fee ${money(rf)}, ${rc} cases.`;
  }

  // Client-scoped focus (when a client name is mentioned in the message)
  const detectedClient = detectClient(message, (clientsRaw ?? []).map((c: ClientInfo) => c.client_name).filter(Boolean));
  const clientLc = detectedClient?.toLowerCase();
  let clientSection = '';
  if (detectedClient) {
    let lr = 0, lf = 0, lc = 0, cr = 0, cf = 0, cc = 0;
    for (const row of allData) {
      if (row.client_name?.trim().toLowerCase() !== clientLc) continue;
      const e = eligible(row); if (!e) continue;
      lr += e.amount; lf += e.fee; lc += 1;
      if (range && e.posting >= range.startISO && e.posting <= range.endISO) { cr += e.amount; cf += e.fee; cc += 1; }
    }
    const cInv = invoices.filter(i => i.client_name?.toLowerCase() === clientLc);
    const billedFee = cInv.reduce((s, i) => s + (Number(i.billed_fee) || 0), 0);
    const billedRec = cInv.reduce((s, i) => s + (Number(i.total_reimbursed) || 0), 0);
    clientSection = `CLIENT FOCUS — ${detectedClient}: lifetime recovered ${money(lr)} (${lc} cases), potential fee ${money(lf)}; billed to date ${cInv.length} invoices (fee ${money(billedFee)}, recovered ${money(billedRec)}).`;
    if (range) clientSection += `\n${detectedClient} recovered for ${range.label}: ${money(cr)}, fee ${money(cf)}, ${cc} cases.`;
  }

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

${clientSection ? clientSection + '\n\n' : ''}${rangeSection ? rangeSection + '\n\n' : ''}RECOVERED BY MONTH (by RMS posting date; all approved, billed + unbilled — sum these for any month range):
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

${caseLookups.length ? `REQUESTED CASE LOOKUPS (from the user's message):\n${caseLookups.join('\n')}\n` : ''}${invLookups.length ? `REQUESTED INVOICE LOOKUPS:\n${invLookups.join('\n')}` : ''}`;
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
- Look up any case by Case ID or any invoice by number (pre-resolved under REQUESTED CASE/INVOICE LOOKUPS when mentioned). For a case: claim type, posting date, amount, status, billed/which invoice. For an invoice: client, date, fee, recovered, cases.
- Total recovered/fee/cases for any date range the user gives — precomputed under "RECOVERED FOR …" when a range is mentioned; otherwise sum the RECOVERED BY MONTH table for month ranges.
- Report Ready to Bill, Pending, Invoices, and Overview figures — overall or per client — and combine them when asked (e.g. "Reimbursed + Pending").
- Offer light analysis and suggestions (trends, biggest clients, months up/down, what's worth billing) grounded strictly in the data below.

Rules: A case is only "reimbursed" when it has an RMS Posting Date. Be concise — lead with the answer, short lines, money as $X.XX. If the data doesn't cover it, say so rather than guessing.

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
