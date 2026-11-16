// npm test — 설계서 숫자·흐름 자가 검사 (API 키 불필요)
import assert from 'node:assert/strict';
import { hasPrice, parseAmount, priceScore, ratingScore, mains, handle, ruleParse } from './engine.js';

// 가격 패턴: '원' 한 글자로 거르지 않는다
for (const t of ['2만5천 원', '25000원', '2.5만', '이만오천 원', '만이천 원', '3만 원까지']) assert.ok(hasPrice(t), t);
for (const t of ['원하셔서 골랐어요', '원조 간장', '순살', '2인']) assert.ok(!hasPrice(t), t);
assert.equal(parseAmount('2만5천 원'), 25000);
assert.equal(parseAmount('둘이서 인당 만이천 원 정도'), 12000);
assert.equal(parseAmount('이만오천 원'), 25000);
assert.equal(parseAmount('2.5만'), 25000);
assert.equal(parseAmount('25,000원'), 25000);

// 5단계 계산 예시 (기준가 24,000 · 동네 평균 4.5): B = 50 + 24.4 + 14.5
const v = { mode: 'value', base: 24000 };
assert.equal(Math.round(priceScore(21000, v) * 300) / 10, 24.4);
assert.equal(Math.round(ratingScore({ rating: 4.6, reviews: 85 }, 4.5) * 200) / 10, 14.5);
assert.equal(Math.round(ratingScore({ rating: null, reviews: 0 }, 4.5) * 200) / 10, 13.3); // 신규 = 평균
assert.equal(priceScore(29000, v), 0);
const b = { mode: 'budget', totalBudget: 25000 };
assert.equal(priceScore(17500, b), 1); // 예산 70% 이하 = 만점
assert.equal(Math.round(priceScore(21000, b) * 300) / 10, 16); // 설계서: B 16.0

// 메인 메뉴: 콜라·치즈볼은 사이드로 빠진다
assert.ok(!mains.S05.some(m => /콜라|치즈볼/.test(m.name)));
assert.ok(mains.S09.some(m => m.name === '순살 치킨 컵') && !mains.S09.some(m => m.name === '컵라면'));

// AI 없이(키 없음/실패) 전체 흐름
const noAi = { parse: async () => { throw new Error('x'); }, question: async () => { throw new Error('x'); }, judge: async () => { throw new Error('x'); } };
let r = await handle(null, { type: 'dong', dong: '서초4동' }, noAi);
r = await handle(r.state, { type: 'text', text: '둘이서 바삭한 간장치킨, 프랜차이즈 말고' }, noAi);
assert.deepEqual(r.state.cond.taste, ['바삭', '간장']);
assert.equal(r.state.cond.people, 2);
assert.equal(r.reply.remaining, 5); // 치킨 8 - 프랜차이즈 2 - 영업 안 함 1
assert.ok(r.reply.cards.length === 3 && r.reply.banner);
assert.ok(r.reply.cards.every((c, i, a) => i === 0 || a[i - 1].score >= c.score)); // 점수순
const top = r.reply.cards.map(c => c.name);

// "더 싸게" → 코드가 총예산 = 최저 총액 - 1
const min = Math.min(...r.reply.cards.map(c => c.total));
r = await handle(r.state, { type: 'text', text: '더 싸게' }, noAi);
assert.equal(r.state.cond.budget, min - 1);
assert.ok(r.reply.chips.some(c => c.label.endsWith('미만')));

// "다른 데는?" → 본 가게 제외
r = await handle(r.state, { type: 'text', text: '처음부터' }, noAi);
r = await handle(r.state, { type: 'text', text: '둘이서 바삭한 간장치킨, 프랜차이즈 말고' }, noAi);
const first = r.reply.cards.map(c => c.name);
r = await handle(r.state, { type: 'text', text: '다른 데는?' }, noAi);
assert.ok((r.reply.cards || []).every(c => !first.includes(c.name)));

// 없는 동네·업종 → 0곳 안내
r = await handle(null, { type: 'dong', dong: '서초1동' }, noAi);
r = await handle(r.state, { type: 'text', text: '치킨 먹고 싶어' }, noAi);
assert.equal(r.reply.remaining, 0);

// AI 응답 검증: 없는 가게·메뉴 버림, 지어낸 인용 버림, 가격 말하는 이유 버림, 지어낸 예산 삭제, 가격 선택지 제거
const fakeAi = {
  parse: async () => ({ menu: '치킨', people: 2, budget: 30000, budget_unit: 'total', price_pref: null, taste: ['간장'], franchise: 'exclude' }),
  question: async ({ stores }) => ({ question: '순살이 좋으세요, 뼈가 좋으세요?', options: [
    { label: '뼈', store_ids: stores.slice(0, 3).map(s => s.store_id).concat('S99') },
    { label: '순살', store_ids: [stores.at(-1).store_id] },
    { label: '2만원대', store_ids: [stores[0].store_id] },
  ] }),
  judge: async ({ stores }) => stores.map((s, i) => ({
    store_id: s.store_id, match: i === 0 ? '안 맞음' : '맞음', menu_ids: [...s.menus.map(m => m.menu_id), 'X-1'],
    quotes: [{ menu_id: s.menus[0].menu_id, quote: '지어낸 문장' }], reason: i === 1 ? '2만원이라 가성비 좋아요' : '간장 조건에 맞아요',
  })).concat({ store_id: 'S99', match: '맞음', menu_ids: [], quotes: [], reason: '' }),
};
r = await handle(null, { type: 'dong', dong: '서초4동' }, fakeAi);
r = await handle(r.state, { type: 'text', text: '둘이서 간장치킨 프랜차이즈 말고' }, fakeAi);
assert.equal(r.state.cond.budget, null); // 원문에 가격 없음 → AI 예산 삭제
assert.deepEqual(r.reply.buttons.map(x => x.label), ['뼈 (3곳)', '순살 (1곳)', '상관없어요']);
r = await handle(r.state, { type: 'option', index: 0 }, fakeAi);
assert.deepEqual(r.state.chosen.map(c => c.label), ['뼈']);
assert.equal(r.reply.remaining, 3);
assert.equal(r.reply.cards.length, 2); // 첫 가게 '안 맞음' 제외
assert.ok(r.reply.cards.every(c => !c.quote && !c.reason.includes('가성비')));

// 규칙 기반 조건 정리
assert.deepEqual(ruleParse('인당 만이천 원으로 둘이서 간장치킨', { taste: [] }), { menu: '치킨', people: 2, budget: 12000, budget_unit: 'per_person', taste: ['간장'] });

console.log('ok', top);
