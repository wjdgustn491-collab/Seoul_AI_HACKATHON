import assert from 'node:assert/strict';
import { test } from 'node:test';
import { choiceKey, preferredChoice, recordPreferences } from '../dist/recommend-preferences.js';

test('counts confirmed button and chat choices across conversations without counting carried conditions', () => {
  const storage = new Map();
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  const guest = 'bappilot-recommend-preferences:guest';
  const person = choiceKey('people', { type: 'apply', cond: { people: 2 } });
  const food = choiceKey('menu', { type: 'apply', cond: { menu: '치킨' } });
  const flavor = choiceKey('taste', { type: 'apply', cond: { taste: ['매운'] } });
  const full = { staged: true, cond: { people: 2, menu: '치킨', taste: ['매운'] } };
  const text = { type: 'text', text: '둘이서 매콤한 치킨, 내 주소나 원문은 저장하지 마' };
  recordPreferences(guest, text, null, full);
  recordPreferences(guest, { type: 'text', text: '예산 3만 원' }, full, { ...full, cond: { ...full.cond, budget: 30000 } });
  assert.equal(preferredChoice(guest, [person]), null);

  recordPreferences(guest, { type: 'apply', cond: { people: 2 } }, null, full, person);
  recordPreferences(guest, { type: 'apply', cond: { menu: '치킨' } }, null, full, food);
  recordPreferences(guest, { type: 'apply', cond: { taste: ['매운'] } }, null, full, flavor);
  for (const key of [person, food, flavor]) assert.equal(preferredChoice(guest, [key]), key);
  assert.deepEqual(JSON.parse(storage.get(guest)), { [person]: 2, [food]: 2, [flavor]: 2 });
  assert.equal(preferredChoice('bappilot-recommend-preferences:another-account', [person]), null);
  assert.equal(preferredChoice(guest, ['menu:피자']), null);
});

test('keeps optional questions separate, ignores unresolved choices and hides tied recommendations', () => {
  const storage = new Map();
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  const key = 'choices';
  const skip = { type: 'apply', flowAnswer: 'skipExtra' };
  const cola = choiceKey('extra:cola', skip);
  const wrap = choiceKey('extra:wrap', skip);
  const waiting = { staged: true, cond: {}, flowExtraKind: 'cola' };
  const answered = { ...waiting, flowExtraDone: true };
  recordPreferences(key, skip, waiting, waiting, cola);
  recordPreferences(key, skip, waiting, answered, cola);
  recordPreferences(key, { type: 'text', text: '포함 여부는 상관없어요' }, waiting, answered);
  assert.equal(preferredChoice(key, [cola]), cola);
  assert.equal(preferredChoice(key, [wrap]), null);
  const include = choiceKey('extra:cola', { type: 'apply', flowAnswer: 'cola' });
  const chosen = { ...answered, flowPreference: 'cola' };
  for (let i = 0; i < 2; i++) recordPreferences(key, { type: 'text', text: '콜라 포함' }, waiting, chosen);
  assert.equal(preferredChoice(key, [cola, include]), null);

  const other = choiceKey('people', { type: 'apply', flowAnswer: 'enterPeople' });
  const entered = { ...waiting, cond: { people: 6 } };
  recordPreferences(key, { type: 'apply', flowAnswer: 'enterPeople' }, entered, entered, other);
  assert.equal(JSON.parse(storage.get(key))[other], undefined);
  for (let i = 0; i < 2; i++) recordPreferences(key, { type: 'text', text: '6명' }, waiting, entered);
  assert.equal(preferredChoice(key, [other]), other);
});
