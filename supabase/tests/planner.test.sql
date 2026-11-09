-- Run with `supabase test db` against an isolated local Supabase stack.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);
insert into auth.users(id,email) values
('11111111-1111-4111-8111-111111111111','a@example.invalid'),
('22222222-2222-4222-8222-222222222222','b@example.invalid');
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select is(public.apply_change('event','event','{"title":"Original"}',false,0,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->>'ok','true','Creates record');
select is(public.apply_change('event','event','{"title":"Original"}',false,0,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')#>>'{row,revision}','1','Retry is idempotent');
select is(public.apply_change('event','event','{"title":"Concurrent"}',false,0,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')->>'ok','false','Stale edit conflicts');
select is((select payload->>'title' from public.planner_records where id='event'),'Original','Conflict does not overwrite original');
select is(public.apply_change('event','event','{"title":"Original"}',true,1,'cccccccc-cccc-4ccc-8ccc-cccccccccccc')#>>'{row,deleted}','true','Tombstone retained');
select is(public.apply_change('event','event','{"title":"Offline"}',false,1,'dddddddd-dddd-4ddd-8ddd-dddddddddddd')->>'ok','false','Offline edit cannot silently resurrect deletion');
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select is((select count(*) from public.planner_records),0::bigint,'RLS hides other user records');
select is(public.apply_change('event','event','{"title":"Second user"}',false,0,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')->>'ok','true','Same ID is scoped per user');
select is((select count(*) from public.planner_records),1::bigint,'User sees own records only');
reset role;
select ok(not has_function_privilege('anon','public.apply_change(text,text,jsonb,boolean,bigint,uuid)','execute'),'Anonymous writes denied');
select * from finish();
rollback;
