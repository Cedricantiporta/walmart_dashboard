export const ALWAYS_EXCLUDED_CLIENTS = new Set<string>([]);
export const DEFAULT_RATE = 0.22;
// Hardcoded as permanently billed — never re-bill
export const HARDCODED_BILLED_IDS = new Set<string>(['13011996', '14969195']);
export const DEFAULT_VANTAGE_CUTOFF = '2026-05-06';
export const VALID_TIME_RANGES = ['thisMonth', 'lastMonth', 'specificMonth', '90days', 'lifetime'] as const;
