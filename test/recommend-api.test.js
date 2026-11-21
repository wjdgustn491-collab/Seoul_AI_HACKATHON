import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import recommend from '../api/recommend.js';

async function post(action, state = null) {
  const reply = {
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; },
  };
  await recommend({ method: 'POST', body: { action, state } }, reply);
  assert.equal(reply.statusCode, 200);
  return reply.payload;
}

const built = existsSync(new URL('../dist/data/index.json', import.meta.url));

test('recommend API works without a Gemini key and rules mode prevents Gemini calls with a configured key', { skip: !built && 'dist/data 없음: node scripts/build-data.mjs' }, async t => {
  const settings = ['GEMINI_API_KEY', 'RECOMMENDATION_MODE'].map(key => [key, process.env[key]]);
  t.after(() => {
    for (const [key, value] of settings) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  // 동 데이터는 로컬 파일(dist/data)에서 읽는다. browserKey가 없으면 외부 요청이 없어야 한다.
  const requests = [];
  t.mock.method(globalThis, 'fetch', async url => { requests.push(String(url)); throw new Error('unexpected fetch'); });

  delete process.env.RECOMMENDATION_MODE;
  delete process.env.GEMINI_API_KEY;
  const area = await post({ type: 'dong', dong: '서초구', neighborhood: '서초4동' });
  const first = await post({ type: 'text', text: '둘이 3만 원 안에 치킨 추천해줘' }, area.state);
  assert.equal(first.provider, 'rules');
  assert.equal(first.state.cond.budget, 30000);
  assert.ok(first.reply.cards.length > 0);

  process.env.RECOMMENDATION_MODE = 'rules';
  process.env.GEMINI_API_KEY = 'test-key';
  const again = await post({ type: 'text', text: '예산 2만 원으로 바꿔줘' }, first.state);
  assert.equal(again.provider, 'rules');
  assert.equal(again.state.cond.budget, 20000);
  assert.deepEqual(requests, []);
});
