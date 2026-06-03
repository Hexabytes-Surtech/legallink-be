// Ad-hoc E2E verification: dump a matter's RAG-produced brief + citations.
// Usage: node check_matter.js <matter_id>
const { Client } = require('pg');
const fs = require('fs');
const url = fs.readFileSync('.env.development', 'utf8').match(/DATABASE_URL=(.+)/)[1].trim();
const id = process.argv[2];
if (!id) { console.error('usage: node check_matter.js <matter_id>'); process.exit(1); }

(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const m = await c.query(
    `SELECT matter_id, status, category_primary, urgency_level, confidence_score,
            jurisdiction_district, intake_language
     FROM matter WHERE matter_id = $1`, [id]);
  console.log('=== MATTER ===');
  console.log(JSON.stringify(m.rows[0], null, 2));

  const b = await c.query(
    `SELECT brief_id, language_code, grounded, generated_at,
            brief_json
     FROM matter_brief_version WHERE matter_id = $1
     ORDER BY generated_at DESC LIMIT 1`, [id]);
  console.log('\n=== LATEST BRIEF ===');
  if (b.rows.length) {
    const r = b.rows[0];
    console.log('brief_id:', r.brief_id, '| lang:', r.language_code, '| grounded:', r.grounded, '| at:', r.generated_at);
    const bj = typeof r.brief_json === 'string' ? JSON.parse(r.brief_json) : r.brief_json;
    console.log('brief_json keys:', Object.keys(bj || {}).join(', '));
    console.log(JSON.stringify(bj, null, 2).slice(0, 1800));
  } else {
    console.log('(no brief rows)');
  }

  const ci = await c.query(
    `SELECT mc.relevance_score, mc.retrieval_method, ldu.citation_text, ldu.doc_title
     FROM matter_citation mc
     JOIN legal_document_unit ldu ON ldu.unit_id = mc.unit_id
     WHERE mc.matter_id = $1
     ORDER BY mc.relevance_score DESC`, [id]);
  console.log('\n=== CITATIONS (' + ci.rows.length + ') ===');
  ci.rows.forEach(x => console.log(
    `  [${x.retrieval_method}] ${Number(x.relevance_score).toFixed(3)} | ${x.citation_text} (${x.doc_title})`));

  const ev = await c.query(
    `SELECT event_type, created_at FROM matter_event WHERE matter_id = $1 ORDER BY created_at ASC`, [id]);
  console.log('\n=== EVENTS ===');
  ev.rows.forEach(x => console.log(`  ${x.created_at.toISOString()} ${x.event_type}`));

  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
