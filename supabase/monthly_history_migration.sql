-- Create monthly_history table for pre-computed past month summaries.
-- Current month is always computed live; this table holds immutable historical months.

create table if not exists monthly_history (
  id          serial primary key,
  month_key   text not null unique,   -- 'YYYY-MM'
  label       text not null,          -- 'June 2026'
  recovered   numeric default 0,
  fee         numeric default 0,
  approved_count  int default 0,
  declined_count  int default 0,
  updated_at  timestamptz default now()
);

-- Populate from existing rms_cases for all PAST months (exclude current month).
-- Run this once after creating the table. Re-run is safe (upsert).
-- Adjust the excluded client filter / rate logic to match your billing rules.

with
current_month_start as (
  select date_trunc('month', now())::date as d
),
approved_cases as (
  select
    to_char(date_trunc('month', rc.rms_posting_date::date), 'YYYY-MM') as month_key,
    to_char(rc.rms_posting_date::date, 'Month YYYY')                    as label_raw,
    rc.reimbursement_amount,
    coalesce(c.rate, 0.22)                                              as rate
  from rms_cases rc
  left join clients c on lower(c.client_name) = lower(rc.client_name)
  where rc.reimbursement_status = 'Approved'
    and rc.rms_posting_date is not null
    and rc.reimbursement_amount > 0
    -- exclude current month — it stays dynamic
    and rc.rms_posting_date::date < (select d from current_month_start)
    -- only billable clients
    and exists (
      select 1 from clients cl
      where lower(cl.client_name) = lower(rc.client_name)
        and cl.status = 'Client'
    )
    -- Vantage pre-cutoff exclusion (adjust date if needed)
    and not (lower(rc.client_name) = 'vantage inc' and rc.rms_posting_date::date < '2026-05-06')
),
declined_cases as (
  select
    to_char(date_trunc('month', rc.date_filed::date), 'YYYY-MM') as month_key
  from rms_cases rc
  where rc.reimbursement_status = 'Declined'
    and rc.date_filed is not null
    and rc.date_filed::date < (select d from current_month_start)
),
approved_agg as (
  select
    month_key,
    max(trim(label_raw)) as label,
    sum(reimbursement_amount) as recovered,
    sum(reimbursement_amount * rate) as fee,
    count(*) as approved_count
  from approved_cases
  group by month_key
),
declined_agg as (
  select month_key, count(*) as declined_count
  from declined_cases
  group by month_key
)
insert into monthly_history (month_key, label, recovered, fee, approved_count, declined_count, updated_at)
select
  a.month_key,
  a.label,
  round(a.recovered::numeric, 2),
  round(a.fee::numeric, 2),
  a.approved_count::int,
  coalesce(d.declined_count, 0)::int,
  now()
from approved_agg a
left join declined_agg d using (month_key)
on conflict (month_key) do update
  set recovered      = excluded.recovered,
      fee            = excluded.fee,
      approved_count = excluded.approved_count,
      declined_count = excluded.declined_count,
      updated_at     = now();
