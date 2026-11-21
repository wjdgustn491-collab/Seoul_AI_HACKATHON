// 동별 JSON(dist/data, scripts/build-data.mjs로 생성) 읽기. 주문자 동 + 3km 안의 동만 메모리에 올린다.
import { readFileSync } from 'node:fs';
import { normalizeCategory } from './engine.js';

const dataDir = new URL('../dist/data/', import.meta.url);
const readJson = name => JSON.parse(readFileSync(new URL(name, dataDir), 'utf8'));
let index = null, zone = null;
const dongCache = new Map(); // ponytail: 동 파일 캐시는 무제한 (최대 458개, 합계 약 52MB). 메모리가 빠듯하면 LRU로.

export const loadIndex = () => index ??= readJson('index.json');
export const loadZone = () => zone ??= readJson('zone.json');

function loadDong(dong) {
  if (!dongCache.has(dong)) {
    const entry = loadIndex().dongs.find(d => d.dong === dong);
    dongCache.set(dong, entry ? readJson(`dong/${entry.file}.json`) : { stores: [], menus: [] });
  }
  return dongCache.get(dong);
}

export const hasDong = dong => loadIndex().dongs.some(d => d.dong === dong);
export const guOfDong = dong => loadIndex().dongs.find(d => d.dong === dong)?.gu ?? null;

// 주문자 동 + 3km 안의 동 (원본 CSV 행 그대로)
export function areaRows(customerDong) {
  const dongs = Object.keys(loadZone()[customerDong] ?? { [customerDong]: 0 });
  if (!dongs.includes(customerDong)) dongs.unshift(customerDong);
  const parts = dongs.map(loadDong);
  return { dongs, stores: parts.flatMap(p => p.stores), menus: parts.flatMap(p => p.menus) };
}

// 검색 규칙(searchRule.js) 입력
export function searchInput(customerDong) {
  const { stores, menus } = areaRows(customerDong);
  const menusByStore = {};
  for (const m of menus) (menusByStore[m.store_id] ??= []).push(m);
  return { stores, menusByStore, zone: loadZone() };
}

// 추천 엔진(createEngine) 입력: 원본 행 → 엔진 형식 (값은 바꾸지 않고 타입만)
export function engineSnapshot(customerDong) {
  const { stores, menus } = areaRows(customerDong);
  const num = v => v === '' ? null : Number(v);
  return {
    stores: stores.map(s => ({
      id: s.store_id, name: s.name, region: guOfDong(s.dong), dong: s.dong, category: s.category,
      franchise: s.is_franchise === 'true', tip: Number(s.delivery_tip), rating: num(s.rating), review_count: num(s.review_count),
      is_open: s.is_open === 'true', exposure_count: Number(s.exposure_count) || 0, is_good_price: s.is_good_price === 'true',
    })),
    // review_count: 그 메뉴가 언급된 리뷰 수(가상). 추천 계산에는 아직 쓰지 않는다
    menus: menus.map(m => ({ id: m.menu_id, store: m.store_id, name: m.name, price: Number(m.price), desc: m.description, reviews: num(m.review_count ?? '') })),
  };
}

// 업종 칩: 데이터에서 뽑는다 (엔진이 쓰는 이름으로 맞춤, 예: 돈까스·일식 → 일식)
export const dataCategories = () => [...new Set(loadIndex().categories.map(normalizeCategory))];
