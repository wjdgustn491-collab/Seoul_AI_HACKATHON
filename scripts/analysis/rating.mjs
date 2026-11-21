// 분석용: [요청사항 1] 보정 별점 확인 시나리오. 기존 코드는 import만 하고 바꾸지 않는다.
// 실행: node scripts/analysis/rating.mjs
import { readFileSync } from 'node:fs';
import { createEngine } from '../../lib/engine.js';

const noAI = new Proxy({}, { get: () => async () => { throw Error('LLM unavailable'); } });
const clamp = v => Math.max(0, Math.min(1, v));
// 요청 공식 (review_count 0 또는 별점 없음 → 지역평균)
const requested = (s, avg) => (s.rating == null || !s.review_count) ? avg : (s.review_count * s.rating + 10 * avg) / (s.review_count + 10);
// 현재 코드 공식 (lib/engine.js adjustedRating 그대로 옮김: review_count null이면 원래 별점)
const current = (s, avg) => s.rating == null || s.review_count === 0 ? avg : s.review_count == null ? s.rating : (s.review_count * s.rating + 10 * avg) / (s.review_count + 10);
const score20 = adj => Math.round(clamp((adj - 3.5) / 1.5) * 20 * 100) / 100;

// 같은 구·업종(치킨)에 비교 대상 3곳 + 지역평균을 만들 한식 가게 5곳(치킨 결과와 경쟁하지 않게 다른 업종)
function snapshot({ withReviewCount }) {
  const stores = [], menus = [];
  const add = (id, name, category, rating, review_count) => {
    stores.push({ id, name, region: '성동구', dong: '성수1가1동', category, tip: 2000, rating, franchise: false, ...(withReviewCount ? { review_count } : {}) });
    menus.push({ id: id + '-m', store: id, name: category === '치킨' ? '후라이드치킨' : '김치찌개', price: category === '치킨' ? 18000 : 9000, desc: '' });
  };
  add('r1', '리뷰1개 5.0집', '치킨', 5.0, 1);
  add('r3', '리뷰3개 5.0집', '치킨', 5.0, 3);
  add('r300', '리뷰300개 4.8집', '치킨', 4.8, 300);
  for (let i = 0; i < 5; i++) add('k' + i, '한식' + i, '한식', 4.3, 50);
  return { stores, menus };
}

function run(label, withReviewCount) {
  const snap = snapshot({ withReviewCount });
  const rated = snap.stores.filter(s => s.rating != null);
  const avg = rated.reduce((a, s) => a + s.rating, 0) / rated.length; // 현재 코드의 avgRating과 같은 계산(같은 구, 별점 있는 가게, 업종 무관)
  const engine = createEngine(snap);
  return engine.handle(undefined, { type: 'text', text: '성동구 치킨' }, noAI).then(turn => {
    const order = turn.reply.cards.map(c => c.storeId);
    const rows = snap.stores.filter(s => s.category === '치킨').map(s => ({
      store: s.name, rating: s.rating, review_count: s.review_count ?? '(없음)',
      current_adj: Math.round(current(s, avg) * 1000) / 1000, current_x20: score20(current(s, avg)),
      requested_adj: Math.round(requested({ ...s, review_count: s.review_count ?? 0 }, avg) * 1000) / 1000,
      engine_rank: order.indexOf(s.id) + 1, engine_score: turn.reply.cards.find(c => c.storeId === s.id)?.score,
    }));
    console.log(`\n## ${label} (지역평균 ${avg.toFixed(4)})`);
    console.table(rows);
    const top = order[0];
    console.log(`1위: ${snap.stores.find(s => s.id === top).name} → ${['r1', 'r3'].includes(top) ? '실패 (리뷰 적은 5.0이 이김)' : '통과'}`);
  });
}

await run('A. review_count가 들어오는 경우 (local/catalog.json·CSV와 같은 상황)', true);
await run('B. review_count가 안 들어오는 경우 (실제 Supabase snapshot과 같은 상황)', false);

// 실제 로컬 데이터: 지역평균과 review_count 현황
const lc = JSON.parse(readFileSync(new URL('../../local/catalog.json', import.meta.url), 'utf8'));
console.log('\n## 로컬 데이터 지역평균 (현재 코드 방식: 같은 구, 별점 있는 가게, 업종 무관)');
for (const gu of ['성동구', '서초구', '관악구']) {
  const inGu = lc.stores.filter(s => s.region === gu);
  const rated = inGu.filter(s => s.rating != null);
  const chicken = rated.filter(s => s.category === '치킨');
  console.log(gu, '가게', inGu.length, '| 별점 있음', rated.length, '| 평균', (rated.reduce((a, s) => a + s.rating, 0) / rated.length).toFixed(3),
    '| (참고) 치킨만 평균', (chicken.reduce((a, s) => a + s.rating, 0) / chicken.length).toFixed(3));
}
