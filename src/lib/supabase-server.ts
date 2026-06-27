import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export function createServerClient() {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Supabase caps responses at 1000 rows regardless of .range() on hosted projects.
// This paginates through all rows in 1000-row chunks.
export async function fetchAllRows<T>(
  db: SupabaseClient,
  table: string,
  select = '*',
): Promise<T[]> {
  const PAGE = 1000;
  const results: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await db.from(table).select(select).range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    results.push(...(data as T[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return results;
}
