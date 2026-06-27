export interface RmsCase {
  case_id: string;
  client_name: string;
  date_filed: string | null;
  claim_type: string | null;
  reimbursement_status: string | null;
  reimbursement_amount: number;
  rms_posting_date: string | null;
  synced_at?: string;
  gtin?: string | null;
  sku_id?: string | null;
  unit_amount?: number | null;
  reimbursed_qty?: number | null;
}

export interface ClientInfo {
  client_name: string;
  status: string;
  rate: number;
  start_date: string | null;
  pilot_end_date: string | null;
}

export interface BillingContact {
  client_name: string;
  invoice_date: string | null;
  payment_terms: string | null;
  address: string | null;
}

export interface CaseSnapshot {
  case_id: string;
  claim_type: string;
  rms_posting_date: string;
  reimbursement_amount: number;
  gtin?: string;
  sku_id?: string;
  unit_amount?: number;
  reimbursed_qty?: number;
}

export interface Invoice {
  id?: number;
  invoice_number: string;
  client_name: string;
  billed_date: string;
  billed_fee: number;
  total_reimbursed: number;
  case_ids: string[];
  case_snapshot: CaseSnapshot[];
  pdf_url?: string;
  created_at?: string;
}

export interface ClientSummary {
  clientName: string;
  isBillableClient: boolean;
  casesFiled: number;
  readyToBillCases: number;
  totalReimbursed: number;
  readyToBillFee: number;
  previouslyBilledFee: number;
  pendingCases: number;
  pendingFee: number;
  pendingReimbursed: number;
  rate: number;
  hasPreviousMonthBill: boolean;
}

export interface DashboardMetrics {
  totalReimbursed: number;
  totalFees: number;
  approvedCases: number;
  approvalRate: number;
}

export interface MonthlyHistory {
  label: string;
  sort: string;
  recovered: number;
  fee: number;
  approvedCount: number;
  declinedCount: number;
  growth: number;
}

export interface ExtraPrevMonth {
  label: string;
  data: number[];
}

export interface DashboardAnalytics {
  metrics: DashboardMetrics;
  trends: Partial<DashboardMetrics>;
  dailyData: { labels: string[]; current: number[]; previous: number[] };
  chartData: {
    labels: string[];
    current: number[];
    previous: number[];
    curMonthLabel: string;
    prevMonthLabel: string;
    isHistorical: boolean;
    extraPrevMonths: ExtraPrevMonth[];
  };
  categoryData: { category: string; amount: number }[];
  monthlyHistory: MonthlyHistory[];
  dateRange: { start: string; end: string };
  dynamicHiddenClients: string[];
  vantageFreePeriodAmount: number;
}

export interface BillingInsights {
  highestClient: { name: string; amount: number } | null;
  mostCasesClient: { name: string; count: number } | null;
  clientCount: number;
  clientsWithPreviousBills: number;
}

export interface AppSettings {
  time: string;
  startupTab: string;
  billingTab: string;
  feeRate: string;
  theme: string;
  vantageCutoff: string;
}

export interface UserInfo {
  email: string;
  name: string;
  initial: string;
}

export interface InitialPayload {
  billingSummary: ClientSummary[];
  history: Invoice[];
  billedIds: string[];
  onboardingInfo: Record<string, ClientInfo>;
  defaultDashboardSettings: AppSettings;
  dashboardAnalytics: DashboardAnalytics | null;
  billingInsights: BillingInsights;
  billingSummaryInfo: Record<string, BillingContact>;
  clientList: string[];
  hiddenClientList: string[];
  lastSyncTime: string;
  vantageCutoff: string;
}
