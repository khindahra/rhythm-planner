-- Extends existing per-user records; the same RLS and revision-safe RPC apply.
alter table public.planner_records drop constraint planner_records_type_check;
alter table public.planner_records add constraint planner_records_type_check
check (type in ('event','action','occurrence','settings','attendance'));
