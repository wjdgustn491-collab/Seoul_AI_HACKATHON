// 검색 규칙 — data/search_rule.py(팀 원본)를 그대로 옮긴 것.
// 1단계 같은 동 → (결과 0곳 또는 '더 보기') 2단계 delivery_zone_3km 기준 3km 안의 동까지, 거리순.

// delivery_zone_3km 행 → { customer_dong: { store_dong: distance_km } }
export function zoneMap(rows) {
  const zone = {};
  for (const r of rows) (zone[r.customer_dong] ??= {})[r.store_dong] = Number(r.distance_km);
  return zone;
}

// stores: CSV 행 그대로({ store_id, dong, category, is_open: 'true', is_franchise, delivery_tip, ... })
// menusByStore: { store_id: [{ name, price }] }
// 반환: { step: '같은 동' | '3km 확장', storeIds: number[] }
export function searchStores({ stores, menusByStore, zone }, { dong, category = null, menuKw = null, budget = null, noFranchise = false, expand = false }) {
  const kw = menuKw ? new RegExp(menuKw) : null;
  const match = s => {
    if (s.is_open !== 'true' || (category && s.category !== category) || (noFranchise && s.is_franchise === 'true')) return false;
    const tip = parseInt(s.delivery_tip, 10);
    return (menusByStore[s.store_id] ?? []).some(m => (!kw || kw.test(m.name)) && (budget == null || parseInt(m.price, 10) + tip <= budget));
  };
  const same = stores.filter(s => s.dong === dong && match(s));
  if (same.length && !expand) return { step: '같은 동', storeIds: same.map(s => Number(s.store_id)) };
  const around = zone[dong] ?? {};
  const near = stores.filter(s => s.dong !== dong && s.dong in around && match(s))
    .sort((a, b) => around[a.dong] - around[b.dong]); // 안정 정렬 (파이썬 sort와 같음)
  return { step: '3km 확장', storeIds: [...same, ...near].map(s => Number(s.store_id)) };
}

// GPS 좌표 → 가장 가까운 동 (dong_centroids의 중심점 기준, 하버사인 거리)
export function nearestDong(lat, lon, centroids) {
  const rad = d => d * Math.PI / 180;
  let best = null, bestKm = Infinity;
  for (const c of centroids) {
    const dLat = rad(c.lat - lat), dLon = rad(c.lon - lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat)) * Math.cos(rad(c.lat)) * Math.sin(dLon / 2) ** 2;
    const km = 2 * 6371 * Math.asin(Math.sqrt(h));
    if (km < bestKm) { bestKm = km; best = c; }
  }
  if (!best) return null;
  // 서초1~4동처럼 중심점이 같은 동은 GPS로 구분할 수 없다 → 후보를 함께 돌려주고 화면에서 고르게 한다
  const ties = centroids.filter(c => c.lat === best.lat && c.lon === best.lon).map(c => c.dong);
  return { dong: best.dong, gu: best.sigungu ?? best.gu, km: bestKm, ties };
}

// 화면 표시용 거리: 서초1~4동처럼 중심점이 같아 0km면 "같은 동네"
export const distanceLabel = km => km == null ? '' : km === 0 ? '같은 동네' : `${km}km`;
