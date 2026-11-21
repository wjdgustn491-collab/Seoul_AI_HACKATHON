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

test('C 1만 원: 같은 동 0곳 → 3km 안의 동까지 자동으로 넓혀 14번(같은 동네), 넓혔다고 알린다', { skip }, async () => {
  const { turn } = await ask('서초1동', '마라탕 1만원 이하');
  assert.equal(turn.reply.step, '3km 확장');
  assert.deepEqual(ids(turn), [14]);
  assert.equal(turn.reply.cards[0].distanceKm, 0); // 서초2동: 중심점이 같아 0km → 화면에 "같은 동네"
  assert.match(turn.reply.text, /서초1동에는 조건에 맞는 곳이 없어서 3km 안의 주변 동까지 넓혀/);
});

test('C2 1만 원: 같은 동 0곳 → 3km 확장으로 61번', { skip }, async () => {
  const { turn } = await ask('성수1가2동', '마라탕 1만원 이하');
  assert.equal(turn.reply.step, '3km 확장');
  assert.deepEqual(ids(turn), [61]);
  assert.equal(turn.reply.cards[0].distanceKm, 0.87);
});

test('3km까지 넓혀도 예산 안이 0곳이면 양보안: 예산에 가장 가까운 메뉴와 얼마가 넘는지', { skip }, async () => {
  const { turn } = await ask('서초1동', '마라탕 3천원 이하');
  assert.equal(turn.reply.kind, 'concession');
  assert.equal(turn.reply.step, '3km 확장');
  assert.ok(turn.reply.cards.length > 0 && turn.reply.cards.every(c => /예산보다 [\d,]+원 높아요/.test(c.budgetNote)));
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
