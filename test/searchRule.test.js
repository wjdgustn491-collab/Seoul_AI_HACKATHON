// 시연 시나리오 (FE 적용 프롬프트 4절). 데이터: data/ → node scripts/build-data.mjs → dist/data
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { searchStores, nearestDong, distanceLabel, zoneMap } from '../dist/searchRule.js';
import { searchInput, loadIndex, loadZone } from '../lib/catalog.js';
import { parseCsv, readCsvObjects } from '../lib/csv.js';

const built = existsSync(new URL('../dist/data/index.json', import.meta.url));
const LB = '떡볶이\\(1인\\)|1인.*떡볶이|떡볶이.*1인';
const run = (dong, category, menuKw, budget, noFranchise, expand = false) =>
  searchStores(searchInput(dong), { dong, category, menuKw, budget, noFranchise, expand });

test('CSV 파서: BOM, 큰따옴표 안 쉼표·따옴표, CRLF, 빈 값', () => {
  const rows = readCsvObjects('﻿menu_id,name,description\r\n1,"치킨, 반반","그냥 ""맛있는"" 치킨"\r\n2,떡볶이,\r\n');
  assert.deepEqual(rows, [{ menu_id: '1', name: '치킨, 반반', description: '그냥 "맛있는" 치킨' }, { menu_id: '2', name: '떡볶이', description: '' }]);
  assert.deepEqual(parseCsv('a,b\n'), [['a', 'b']]);
});

test('zoneMap / 거리 표시: 0km는 "같은 동네"', () => {
  assert.deepEqual(zoneMap([{ customer_dong: '서초1동', store_dong: '서초2동', distance_km: '0.0' }]), { 서초1동: { 서초2동: 0 } });
  assert.equal(distanceLabel(0), '같은 동네');
  assert.equal(distanceLabel(0.87), '0.87km');
});

test('시나리오 A·A2·B·B2·C·C2 (같은 동)', { skip: !built && 'dist/data 없음: node scripts/build-data.mjs' }, () => {
  const cases = [
    ['A 서초4동 간장치킨', ['서초4동', '치킨', '간장', 25000, true], [1, 2, 3, 4]],
    ['A2 성수2가3동 간장치킨', ['성수2가3동', '치킨', '간장', 25000, true], [43, 44, 45, 46]],
    ['B 서초2동 1인 떡볶이', ['서초2동', null, LB, 10000, false], [19, 20, 21]],
    ['B2 성수1가1동 1인 떡볶이', ['성수1가1동', null, LB, 10000, false], [52, 53, 54]],
    ['C 서초1동 마라탕 1.2만', ['서초1동', null, '마라탕', 12000, false], [11, 12]],
    ['C2 성수1가2동 마라탕 1.2만', ['성수1가2동', null, '마라탕', 12000, false], [58, 59]],
  ];
  for (const [name, args, expected] of cases) {
    const r = run(...args);
    assert.equal(r.step, '같은 동', name);
    assert.deepEqual(r.storeIds, expected, name);
  }
});

test('시나리오 C·C2 1만 원: 같은 동 0곳 → 3km 확장', { skip: !built && 'dist/data 없음' }, () => {
  const c = run('서초1동', null, '마라탕', 10000, false);
  assert.deepEqual(c, { step: '3km 확장', storeIds: [14] });
  assert.equal(loadZone()['서초1동']['서초2동'], 0); // 14번은 서초2동, 중심점이 같아 0km → "같은 동네"
  const c2 = run('성수1가2동', null, '마라탕', 10000, false);
  assert.deepEqual(c2, { step: '3km 확장', storeIds: [61] });
  // "더 보기"면 같은 동이 있어도 3km 확장 (같은 동 먼저, 그다음 거리순)
  const more = run('서초1동', null, '마라탕', 12000, false, true);
  assert.equal(more.step, '3km 확장');
  assert.deepEqual(more.storeIds.slice(0, 2), [11, 12]);
});

test('nearestDong: 동 중심점과 가장 가까운 동', { skip: !built && 'dist/data 없음' }, () => {
  const centroids = loadIndex().dongs;
  // 서초1~4동은 중심점이 같아 GPS로는 구분할 수 없다 → 중심점이 겹치지 않는 동으로 확인
  const same = centroids.filter(x => x.lat === centroids.find(y => y.dong === '서초4동').lat).map(x => x.dong);
  assert.ok(same.length >= 4, same.join());
  for (const d of ['신사동(은평구)', '개포동', '논현동']) {
    const c = centroids.find(x => x.dong === d);
    const r = nearestDong(c.lat + 0.0003, c.lon - 0.0003, centroids);
    assert.equal(r.dong, d);
    assert.deepEqual(r.ties, [d]);
  }
  const s = centroids.find(x => x.dong === '서초4동');
  assert.deepEqual(nearestDong(s.lat, s.lon, centroids).ties.sort(), ['서초1동', '서초2동', '서초3동', '서초4동']);
});
