// Блокує всі Approved пости @yurii_dovhan з датою публікації в майбутньому → Draft
// Захист поки виправляється pipeline.

const fs = require('fs');
const path = require('path');

// Read NOTION_TOKEN from detectivefm .env.production
const envPath = path.join('G:', 'Claude', 'detectivefm', '.env.production');
const env = fs.readFileSync(envPath, 'utf8');
const TOKEN = env.match(/NOTION_TOKEN="?([^"\n]+)"?/)?.[1];
const DB_ID = '33d796c4d75881429064c1d0e7340100';

if (!TOKEN) { console.error('NO NOTION_TOKEN'); process.exit(1); }

async function notion(p, method = 'GET', body = null) {
  const r = await fetch(`https://api.notion.com/v1${p}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}

(async () => {
  console.log('Querying Approved posts for @yurii_dovhan ...');
  const data = await notion(`/databases/${DB_ID}/query`, 'POST', {
    filter: {
      and: [
        { property: 'Статус', select: { equals: 'Approved' } },
        { property: 'Акаунт', select: { equals: 'yurii_dovhan' } },
      ],
    },
    page_size: 100,
  });

  if (!data.results) {
    console.error('Notion query failed:', JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log(`Found ${data.results.length} Approved posts.\n`);
  const now = new Date();
  const toBlock = [];
  for (const p of data.results) {
    const title = p.properties['Назва']?.title?.[0]?.plain_text || '(no title)';
    const dateStr = p.properties['Публікувати о']?.date?.start;
    const status = p.properties['Статус']?.select?.name;
    const tip = p.properties['Тип']?.select?.name;
    const dt = dateStr ? new Date(dateStr) : null;
    const future = dt && dt > now;
    const minutesAhead = dt ? Math.round((dt - now) / 60000) : null;
    console.log(`[${status}] ${tip || '?'} · ${title}`);
    console.log(`  → publish: ${dateStr || '(no date)'} · ${future ? `${minutesAhead}m ahead` : 'past or now'}`);
    if (future) toBlock.push({ id: p.id, title, dateStr });
  }
  console.log(`\nWill BLOCK ${toBlock.length} posts (future publication, status Approved → Draft):`);
  toBlock.forEach(p => console.log(`  - ${p.title} (${p.dateStr})`));

  if (process.argv.includes('--apply')) {
    console.log('\n--apply flag detected. Blocking now...');
    for (const p of toBlock) {
      const r = await notion(`/pages/${p.id}`, 'PATCH', {
        properties: { 'Статус': { select: { name: 'Draft' } } },
      });
      console.log(`  ${r.id ? 'OK' : 'FAIL'}: ${p.title}`);
    }
    console.log('Done.');
  } else {
    console.log('\nDRY RUN. Re-run with --apply to actually block.');
  }
})();
