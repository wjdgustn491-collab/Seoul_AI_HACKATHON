// data/의 CSV를 동별 JSON으로 나눈다 → dist/data/
// 메뉴가 약 30MB라 화면·서버가 한 번에 다 읽지 않도록, 주문자 동 + 3km 안의 동 파일만 읽게 한다.
// 실행: node scripts/build-data.mjs   (데이터 값은 바꾸지 않고 형식만 바꾼다)
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { readCsvObjects } from '../lib/csv.js';

const root = new URL('../', import.meta.url);
const read = name => readCsvObjects(readFileSync(new URL('data/' + name, root), 'utf8'));
const out = new URL('dist/data/', root);
rmSync(out, { recursive: true, force: true });
mkdirSync(new URL('dong/', out), { recursive: true });

const centroids = read('dong_centroids.csv');
const stores = read('hackathon_stores_excel.csv');
const menus = [1, 2, 3, 4].flatMap(i => read(`hackathon_menus_part${i}.csv`));
const zoneRows = read('delivery_zone_3km.csv');

// 동 → 파일 번호 (파일 이름에 한글을 쓰지 않으려고)
const dongs = centroids.map(c => c.dong);
const fileOf = new Map(dongs.map((d, i) => [d, `d${i}`]));
const byDong = new Map(dongs.map(d => [d, { stores: [], menus: [] }]));
const dongOfStore = new Map();

for (const s of stores) {
  const bucket = byDong.get(s.dong);
  if (!bucket) throw new Error(`동 파일에 없는 동: ${s.dong} (store ${s.store_id})`);
  dongOfStore.set(s.store_id, s.dong);
  bucket.stores.push(s); // CSV 행 그대로 (검색 규칙이 원본 형식을 쓴다)
}
for (const m of menus) {
  const dong = dongOfStore.get(m.store_id);
  if (!dong) throw new Error(`가게 없는 메뉴: ${m.menu_id}`);
  byDong.get(dong).menus.push(m);
}
let bytes = 0;
for (const [dong, data] of byDong) {
  const json = JSON.stringify(data);
  bytes += json.length;
  writeFileSync(new URL(`dong/${fileOf.get(dong)}.json`, out), json);
}

const zone = {};
for (const r of zoneRows) (zone[r.customer_dong] ??= {})[r.store_dong] = Number(r.distance_km);
writeFileSync(new URL('zone.json', out), JSON.stringify(zone));

const categories = [...new Set(stores.map(s => s.category))].sort((a, b) => a.localeCompare(b, 'ko'));
writeFileSync(new URL('index.json', out), JSON.stringify({
  dongs: centroids.map(c => ({ dong: c.dong, gu: c.sigungu, lat: Number(c.lat), lon: Number(c.lon), file: fileOf.get(c.dong), stores: byDong.get(c.dong).stores.length })),
  categories,
}));
console.log(`가게 ${stores.length} · 메뉴 ${menus.length} · 동 ${dongs.length} · 업종 ${categories.length} · 동별 파일 합계 ${(bytes / 1e6).toFixed(1)}MB`);
