// 동 단위 검색(같은 동 → 3km 확장)을 추천 엔진으로 확인. 데이터: node scripts/build-data.mjs → dist/data
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createEngine } from '../lib/engine.js';
import { engineSnapshot, loadZone, guOfDong } from '../lib/catalog.js';

const built = existsSync(new URL('../dist/data/index.json', import.meta.url));
const skip = !built && 'dist/data 없음: node scripts/build-data.mjs';
const noAI = new Proxy({}, { get: () => async () => { throw Error('LLM unavailable'); } });
const engines = new Map();
const engineFor = dong => engines.get(dong) ?? engines.set(dong, createEngine(engineSnapshot(dong), { zone: loadZone() })).get(dong);
async function ask(dong, text) {
  const e = engineFor(dong);
  const area = await e.handle(undefined, { type: 'dong', dong: guOfDong(dong), neighborhood: dong }, noAI);
  return { e, turn: await e.handle(area.state, { type: 'text', text }, noAI) };
}
const ids = turn => (turn.reply.cards ?? []).map(c => Number(c.storeId));

test('A·A2: 같은 동에서 후보가 시연 기대값과 같다', { skip }, async () => {
  for (const [dong, expected] of [['서초4동', [1, 2, 3, 4]], ['성수2가3동', [43, 44, 45, 46]]]) {
    const { turn } = await ask(dong, '간장치킨 2만5천원 이하 프랜차이즈 말고');
    assert.equal(turn.reply.step, '같은 동', dong);
    assert.match(turn.reply.text, /남은 4곳/, dong);                   // 후보 = 같은 동 4곳
    assert.ok(ids(turn).every(id => expected.includes(id)), `${dong}: ${ids(turn)}`);
    assert.ok(turn.reply.cards.every(c => c.distanceKm === 0));
  }
});

test('C·C2 1.2만 원: 같은 동 11·12 / 58·59', { skip }, async () => {
  for (const [dong, expected] of [['서초1동', [11, 12]], ['성수1가2동', [58, 59]]]) {
    const { turn } = await ask(dong, '마라탕 12000원 이하');
    assert.equal(turn.reply.step, '같은 동');
    assert.deepEqual(ids(turn).sort((a, b) => a - b), expected, dong);
  }
});

test('C 1만 원: 같은 동 0곳 → 양보안 두 가지, 주변 동을 고르면 3km 확장으로 14번(같은 동네)', { skip }, async () => {
  const { e, turn } = await ask('서초1동', '마라탕 1만원 이하');
  assert.equal(turn.reply.zero, true);
  assert.deepEqual(turn.reply.buttons.map(b => b.label), ['1만2천 원으로 올리면 우리 동 2곳', '주변 동까지 보면 1만 원에 1곳', '처음부터']);
  const raise = await e.handle(turn.state, turn.reply.buttons[0].action, noAI);
  assert.deepEqual(ids(raise).sort((a, b) => a - b), [11, 12]);
  assert.equal(raise.reply.step, '같은 동');
  const wide = await e.handle(turn.state, turn.reply.buttons[1].action, noAI);
  assert.equal(wide.reply.step, '3km 확장');
  assert.deepEqual(ids(wide), [14]);
  assert.equal(wide.reply.cards[0].distanceKm, 0); // 서초2동: 중심점이 같아 0km → 화면에 "같은 동네"
});

test('C2 1만 원: 같은 동 0곳 → 주변 동까지 보면 61번', { skip }, async () => {
  const { e, turn } = await ask('성수1가2동', '마라탕 1만원 이하');
  assert.equal(turn.reply.zero, true);
  const wide = await e.handle(turn.state, turn.reply.buttons.find(b => b.action?.expand).action, noAI);
  assert.deepEqual(ids(wide), [61]);
  assert.equal(wide.reply.cards[0].distanceKm, 0.87);
});

test('"다른 데 보기"는 3km 안의 동까지 넓힌다, 노출 횟수는 엔진끼리 같이 쓴다', { skip }, async () => {
  const exposure = { day: '', counts: {} };
  const a = createEngine(engineSnapshot('서초1동'), { zone: loadZone(), exposure });
  const area = await a.handle(undefined, { type: 'dong', dong: '서초구', neighborhood: '서초1동' }, noAI);
  const first = await a.handle(area.state, { type: 'text', text: '마라탕 12000원 이하' }, noAI);
  assert.deepEqual(first.reply.nextButton, { label: '다른 데 보기', action: { type: 'text', text: '다른 데는?' } });
  const more = await a.handle(first.state, first.reply.nextButton.action, noAI);
  assert.equal(more.reply.step, '3km 확장');
  assert.ok(more.reply.cards.length >= 1 && more.reply.cards.every(c => ![11, 12].includes(Number(c.storeId))));
  assert.ok(Object.keys(exposure.counts).length >= 3); // 노출된 가게가 공유 카운트에 쌓인다
});

test('착한가게 필터: "착한가게"라고 하면 is_good_price 가게만, 칩으로 해제', { skip }, async () => {
  const snapshot = engineSnapshot('서초4동');
  const good = snapshot.stores.filter(s => s.is_good_price && s.is_open);
  const { turn } = await ask(good[0]?.dong ?? '서초4동', '착한가게 추천해줘');
  if (!good.length) return;
  assert.equal(turn.state.cond.goodPrice, true);
  const chip = turn.reply.chips.find(c => c.label === '착한가게만');
  assert.ok(chip);
  const byId = new Map(engineSnapshot(good[0].dong).stores.map(s => [s.id, s]));
  assert.ok(turn.reply.cards?.length >= 1 && turn.reply.cards.every(c => byId.get(c.storeId).is_good_price), JSON.stringify(turn.reply.text));
  assert.ok(turn.reply.cards.every(c => c.isGoodPrice));
});
