const fs=require('fs');
const env=Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.split('=')[0].trim(), l.split('=').slice(1).join('=').trim()]));
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
(async()=>{
  const TX = {
    promissory_notes: ['name',['PN-2026-0001']],
    letter_guarantees: ['name',['LG-2026-0012','BG-2026-0003','SBLC-2026-0001']],
    letters_of_credit: ['lc_no',['LC-2026-0005']],
    floor_plans: ['fp_no',['FP-2026-0004']],
    overdrafts: ['od_no',['OD-2026-0001']],
    trust_receipts: ['tr_no',['TR-2026-0009']],
    fx_forwards: ['fxf_no',['FXF-2026-0003']],
    loans: ['loan_no',['LOAN-2026-0003']],
    leases: ['lease_no',['HP-2026-0007','LSE-2026-0011','LSE-2026-0002','LSE-2026-0020']],
  };
  const maNames=['MGC-SCB-2026','MGC-KBANK-2026','MGC-BBL-2026'];
  const { data: mas } = await sb.from('master_agreements').select('id,ma_name').in('ma_name', maNames);
  const maIds=(mas??[]).map(m=>m.id);
  let caIds=[];
  if (maIds.length) {
    const { data: cas } = await sb.from('credit_agreements').select('id,ca_name').in('ma_id', maIds);
    caIds=(cas??[]).map(c=>c.id);
  }
  console.log('found MA:', (mas??[]).map(m=>m.ma_name).join(', ')||'none', '| CA:', caIds.length);
  for (const [t,fk,ids] of [['ma_collaterals','ma_id',maIds],['ma_guarantors','ma_id',maIds],['ca_collaterals','ca_id',caIds],['ca_guarantors','ca_id',caIds]]) {
    if (!ids.length) continue;
    const { error, count } = await sb.from(t).delete({count:'exact'}).in(fk, ids);
    console.log(t.padEnd(20), error? 'ERR '+error.message : 'deleted '+count);
  }
  for (const [table,[field,vals]] of Object.entries(TX)) {
    const { error, count } = await sb.from(table).delete({count:'exact'}).in(field, vals);
    console.log(table.padEnd(20), error? 'ERR '+error.message : 'deleted '+count);
  }
  if (caIds.length) {
    const { error, count } = await sb.from('credit_agreements').delete({count:'exact'}).in('id', caIds);
    console.log('credit_agreements'.padEnd(20), error? 'ERR '+error.message : 'deleted '+count);
  }
  if (maIds.length) {
    const { error, count } = await sb.from('master_agreements').delete({count:'exact'}).in('id', maIds);
    console.log('master_agreements'.padEnd(20), error? 'ERR '+error.message : 'deleted '+count);
  }
})();
