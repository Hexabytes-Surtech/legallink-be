// Dump full RAG output (brief + citations) for the 10 test matters.
const { Client } = require('pg');
const fs = require('fs');
const url = fs.readFileSync('.env.development', 'utf8').match(/DATABASE_URL=(.+)/)[1].trim();
const idxPath = 'C:\\Users\\param\\Core\\Code\\FinalYearProject\\code\\organization\\PLATFORM_QA\\rag_tests\\matter_ids.txt';

const entries = fs.readFileSync(idxPath, 'utf8').split(/\r?\n/).filter(Boolean)
  .map(l => l.split('\t')).filter(p => p[1] && p[1] !== 'ERROR');

(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  for (const [name, id] of entries) {
    const m = (await c.query(
      `SELECT category_primary, urgency_level, confidence_score, jurisdiction_district FROM matter WHERE matter_id=$1`, [id])).rows[0] || {};
    const b = (await c.query(
      `SELECT grounded, brief_json FROM matter_brief_version WHERE matter_id=$1 ORDER BY generated_at DESC LIMIT 1`, [id])).rows[0];
    const ci = (await c.query(
      `SELECT mc.relevance_score, mc.retrieval_method, ldu.citation_text, ldu.doc_title
       FROM matter_citation mc JOIN legal_document_unit ldu ON ldu.unit_id=mc.unit_id
       WHERE mc.matter_id=$1 ORDER BY mc.relevance_score DESC`, [id])).rows;

    console.log('\n' + '='.repeat(90));
    console.log(`### ${name}   [matter ${id}]`);
    console.log(`classification: type=${m.category_primary} | urgency=${m.urgency_level} | confidence=${m.confidence_score} | district=${m.jurisdiction_district ?? '—'} | grounded=${b?.grounded}`);
    const bj = b ? (typeof b.brief_json === 'string' ? JSON.parse(b.brief_json) : b.brief_json) : {};
    console.log('\n-- matter_summary (EN):\n' + (bj.matter_summary ?? '(none)'));
    console.log('\n-- bn_summary (BN):\n' + (bj.bn_summary ?? '(none)'));
    console.log('\n-- relevant_laws:');
    (bj.relevant_laws || []).forEach((l, i) => {
      console.log(`  [${i + 1}] ${l.citation}`);
      console.log(`      quote: "${(l.exact_quote || '').slice(0, 220)}"`);
      console.log(`      why:   ${l.why_relevant}`);
    });
    if (!(bj.relevant_laws || []).length) console.log('  (none)');
    console.log('\n-- procedural_information:');
    (bj.procedural_information || []).forEach(s => console.log('  • ' + s));
    console.log('\n-- missing_information:');
    (bj.missing_information || []).forEach(s => console.log('  ? ' + s));
    console.log(`\n-- persisted citations (${ci.length}):`);
    ci.forEach(x => console.log(`  [${x.retrieval_method}] ${Number(x.relevance_score).toFixed(3)} | ${x.citation_text}`));
  }
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
