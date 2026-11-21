// 가게 데이터(snapshot)를 Supabase에서 한 번 받아 local/catalog.json으로 저장한다.
// stores_excel의 review_count를 붙여 보정 별점이 로컬에서도 동작하게 한다.
// 실행: npm run fetch:catalog  (local/은 .gitignore 대상인 로컬 캐시 폴더)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { supabaseConfig } from '../dist/supabase-config.js';

const root = new URL('../', import.meta.url);
const t0 = Date.now();
const res = await fetch(supabaseConfig.url + '/rest/v1/rpc/seoul_recommendation_snapshot', {
  method: 'POST',
  headers: { apikey: supabaseConfig.publishableKey, 'Content-Type': 'application/json' },
  body: '{}',
  signal: AbortSignal.timeout(60000),
});
if (!res.ok) throw new Error('Supabase ' + res.status);
const snapshot = await res.json();
console.log(`받음: 가게 ${snapshot.stores.length} / 메뉴 ${snapshot.menus.length} (${Date.now() - t0}ms)`);

// CSV 헤더: store_id,name,dong,category,is_franchise,delivery_tip,rating,review_count,is_open,...
const [header, ...rows] = (await readFile(new URL('stores_excel', root), 'utf8')).trim().split(/\r?\n/);
const col = header.split(',');
const idIdx = col.indexOf('store_id'), rcIdx = col.indexOf('review_count');
const reviews = new Map(rows.map(r => r.split(',')).map(c => [c[idIdx], c[rcIdx] === '' ? null : Number(c[rcIdx])]));
let matched = 0;
for (const s of snapshot.stores) {
  if (s.review_count == null && reviews.has(s.id)) { s.review_count = reviews.get(s.id); matched++; }
}
console.log(`review_count 붙임: ${matched}/${snapshot.stores.length}`);

await mkdir(new URL('local/', root), { recursive: true });
await writeFile(new URL('local/catalog.json', root), JSON.stringify(snapshot));
console.log('저장: local/catalog.json');
