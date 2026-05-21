-- =====================================================================
--  Audit columns — who created / last edited each record.
--  Stores the app_user's name/email label (set from the logged-in session).
--  Pairs with the existing created_at / updated_at timestamps.
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'master_agreements', 'credit_agreements',
    'promissory_notes', 'letter_guarantees', 'floor_plans', 'overdrafts',
    'trust_receipts', 'fx_forwards', 'loans', 'leases'
  ] loop
    execute format('alter table %I add column if not exists created_by text;', t);
    execute format('alter table %I add column if not exists updated_by text;', t);
  end loop;
end $$;
