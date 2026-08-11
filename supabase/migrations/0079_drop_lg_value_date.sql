-- Remove value_date from letter_guarantees per MoM 14:13 · Fee calculated from issue_date only · value_date is redundant (Transaction/Debit day = Issue day for L/G)

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'letter_guarantees'
      and column_name = 'value_date'
  ) then
    alter table public.letter_guarantees drop column value_date;
  end if;
end $$;
