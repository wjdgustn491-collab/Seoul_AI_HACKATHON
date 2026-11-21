import test from 'node:test';
import assert from 'node:assert/strict';
import { createLLM, validate } from '../lib/llm/index.js';
import { PARSE_SCHEMA } from '../lib/prompts.js';

// 맥락 필드(eaten·avoid·meal_time·season·delivery_tip_max)도 required (nullable)
const good = { menu: '치킨', dish: null, people: 2, budget: null, budget_unit: 'total', price_pref: null, taste: ['간장'], franchise: 'none',
  eaten: [], avoid: [], meal_time: null, season: null, delivery_tip_max: null };
const fake = replies => {
  const calls = [];
  return { calls, provider: { name: 'fake', available: true, async complete(req) { calls.push(req); const r = replies.shift(); if (r instanceof Error) throw r; return r; } } };
};

test('스키마 검사: enum·필수 필드·타입', () => {
  assert.equal(validate(good, PARSE_SCHEMA), null);
  assert.match(validate({ ...good, menu: '라면' }, PARSE_SCHEMA), /menu/);
  assert.match(validate({ ...good, people: 1.5 }, PARSE_SCHEMA), /people/);
  const { franchise, ...missing } = good;
  assert.match(validate(missing, PARSE_SCHEMA), /franchise/);
});

test('형식이 틀린 응답은 1번 다시 요청한다', async () => {
  const f = fake(['not json', JSON.stringify(good)]);
  const ai = createLLM({}, { provider: f.provider });
  assert.deepEqual(await ai.parse('치킨', {}), good);
  assert.equal(f.calls.length, 2);
  assert.equal(ai.used, true);
  assert.equal(ai.provider, 'fake');
});

test('두 번 틀리면 throw (엔진이 규칙 기반으로 폴백)', async () => {
  const f = fake([JSON.stringify({ ...good, menu: '라면' }), '{}', JSON.stringify({ question: 'q', options: [] })]);
  const ai = createLLM({}, { provider: f.provider });
  await assert.rejects(ai.parse('x', {}));
  assert.equal(f.calls.length, 2);
  // 형식 오류는 다음 호출까지 막지 않는다
  assert.deepEqual(await ai.question({}), { question: 'q', options: [] });
});

test('타임아웃은 재요청 없이 폴백하고 이 턴의 나머지 호출도 건너뛴다', async () => {
  const timeout = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
  const f = fake([timeout, JSON.stringify(good)]);
  const ai = createLLM({}, { provider: f.provider });
  await assert.rejects(ai.parse('x', {}));
  await assert.rejects(ai.question({}));
  assert.equal(f.calls.length, 1);
  assert.equal(ai.used, false);
});

test('키가 없으면 호출하지 않고, LLM_PROVIDER로 provider를 고른다', async () => {
  const ai = createLLM({ LLM_PROVIDER: 'gemini' });
  assert.equal(ai.provider, 'gemini');
  await assert.rejects(ai.parse('x', {}));
  assert.throws(() => createLLM({ LLM_PROVIDER: 'nope' }), /nope/);
});

test('시간 예산이 1초 미만이면 AI를 부르지 않는다', async () => {
  const f = fake([JSON.stringify(good)]);
  const ai = createLLM({}, { provider: f.provider, deadline: Date.now() + 500 });
  await assert.rejects(ai.parse('x', {}));
  assert.equal(f.calls.length, 0);
});

test('LLM_PROVIDER=none이면 키가 있어도 AI를 부르지 않는다', async () => {
  const ai = createLLM({ LLM_PROVIDER: 'none', GEMINI_API_KEY: 'x' });
  assert.equal(ai.provider, 'none');
  await assert.rejects(ai.parse('x', {}), /LLM unavailable/);
  assert.equal(ai.used, false);
});

test('[맥락] PARSE_SCHEMA: 먹은 것·피할 것·끼니·계절·배달팁', () => {
  const context = { ...good, menu: null, eaten: [{ meal: 'breakfast', menu: '한식', dish: '국밥' }, { meal: 'lunch', menu: '도시락·죽', dish: '도시락' }],
    avoid: [{ menu: '피자', dish: null }], meal_time: 'dinner', season: 'winter', delivery_tip_max: 0 };
  assert.equal(validate(context, PARSE_SCHEMA), null);
  assert.match(validate({ ...context, season: 'spring' }, PARSE_SCHEMA), /season/);
  assert.match(validate({ ...context, meal_time: 'brunch' }, PARSE_SCHEMA), /meal_time/);
  assert.match(validate({ ...context, eaten: [{ meal: 'lunch', menu: '라면집', dish: null }] }, PARSE_SCHEMA), /eaten\[0\]\.menu/);
  assert.match(validate({ ...context, delivery_tip_max: 1.5 }, PARSE_SCHEMA), /delivery_tip_max/);
  const { eaten, ...missing } = context;
  assert.match(validate(missing, PARSE_SCHEMA), /eaten/);
});

test('[맥락] RECOMMENDATION_MODE=rules면 키가 있어도 AI를 부르지 않는다', async () => {
  const ai = createLLM({ RECOMMENDATION_MODE: 'rules', GEMINI_API_KEY: 'x' });
  assert.equal(ai.provider, 'none');
  await assert.rejects(ai.parse('x', {}), /LLM unavailable/);
});
