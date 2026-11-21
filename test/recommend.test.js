import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEngine } from '../lib/engine.js';

const snapshot = { stores: [], menus: [] };
function add(id, region, dong, category, name, menu, price, desc = '') {
  snapshot.stores.push({ id, region, dong, category, name, tip: 1000, rating: 4.5 });
  snapshot.menus.push({ id: id + '-1', store: id, name: menu, price, desc });
}
add('seocho-chicken', '서초구', '서초4동', '치킨', '서초통닭', '간장 순살치킨', 18000, '바삭한 껍질');
add('seocho-chicken-bone', '서초구', '서초2동', '치킨', '골목닭집', '뼈 양념치킨', 16000);
add('seocho-chicken-crunch', '서초구', '서초4동', '치킨', '바른통닭', '후라이드 순살치킨', 17000);
add('seocho-chicken-two', '서초구', '서초1동', '치킨', '옛날통닭', '두 마리 치킨', 27000, '넉넉한 두 마리');
add('gangnam-chicken', '강남구', '역삼동', '치킨', '역삼치킨', '간장 순살치킨', 21000, '바삭하고 푸짐한 치킨');
add('gangnam-pizza', '강남구', '역삼동', '피자', '역삼화덕', '버섯 피자', 18000);
add('gangnam-pizza-expensive', '강남구', '삼성동', '피자', '삼성화덕', '페퍼로니 피자', 28000);
add('gangnam-chinese', '강남구', '역삼동', '중식', '미소반점', '해물짬뽕', 8500, '얼큰한 해물 국물');
add('gangnam-chinese-two', '강남구', '삼성동', '중식', '정원중식당', '새우볶음밥', 9500);
add('mapo-korean', '마포구', '합정동', '한식', '합정식당', '김치찌개', 9000);
add('gangdong-gukbap', '강동구', '길동', '한식', '길동밥상', '돼지국밥', 17500, '푸짐한 한 그릇');
add('mapo-gukbap', '마포구', '합정동', '한식', '합정국밥집', '돼지국밥', 11000, '푸짐한 한 그릇');
add('gangdong-cheap-gukbap', '강동구', '성내동', '한식', '성내식당', '아침국밥', 7000, '푸짐한 국밥');
add('outside-seoul', '원미구', '상동', '치킨', '상동닭집', '후라이드치킨', 11000);
snapshot.menus.push({ id: 'seocho-side', store: 'seocho-chicken', name: '등심돈까스', price: 6000, desc: '푸짐한 돈까스' });

const noGemini = new Proxy({}, { get: () => async () => { throw Error('LLM unavailable'); } });
// 카테고리만 정하면 세부 메뉴 단계가 먼저 나온다. 기존 테스트는 "카테고리 전체 추천" 흐름을 검증하므로 [상관없어요]로 넘긴다.
const skipSub = async (engine, turn, ai = noGemini) =>
  turn.reply.subMenu ? engine.handle(turn.state, { type: 'apply', cond: { sub: '' } }, ai) : turn;
const textTurn = async (engine, previous, text, ai = noGemini) =>
  skipSub(engine, await engine.handle(previous?.state, { type: 'text', text }, ai), ai);
const catTurn = async (engine, state, menu, ai = noGemini) =>
  skipSub(engine, await engine.handle(state, { type: 'apply', cond: { menu } }, ai), ai);
const cards = turn => turn.reply.cards?.map(c => c.storeId) ?? [];

test('recommends only open catalog stores and marks good-price stores in new categories', async () => {
  const data = {
    stores: [
      { id: 'open', name: '열린 버거', is_open: true, is_good_price: true },
      { id: 'closed', name: '닫힌 버거', is_open: false, is_good_price: true },
    ].map(store => ({ ...store, category: '패스트푸드', region: '서초구', dong: '서초4동', tip: 1000, rating: null })),
    menus: [
      { id: '1', store: 'open', name: '치즈버거', price: 8000, desc: '' },
      { id: '2', store: 'closed', name: '치즈버거', price: 6000, desc: '' },
    ],
  };
  const engine = createEngine(data);
  const region = await engine.handle(null, { type: 'dong', dong: '서초구' }, noGemini);
  const result = await textTurn(engine, region, '치즈버거 먹고 싶어');
  assert.deepEqual(cards(result), ['open']);
  assert.equal(result.reply.cards[0].isGoodPrice, true);
});

test('requires cheese quantity evidence, diversifies brands and answers franchise questions in context', async () => {
  const pizza = [
    ['chain-one', '오븐피자 잠실점', true, '치즈 듬뿍', 18000],
    ['chain-two', '오븐피자 혜화점', true, '모짜렐라 가득', 19000],
    ['chain-three', '오븐피자 망우점', true, '더블 치즈', 20000],
    ['small-shop', '양철지붕피자', false, '치즈를 많이 올렸어요', 27000],
    ['cheese-only', '작은피자', false, '치즈 쭉쭉 고소', 9000],
    ['denied-cheese', '담백한피자', false, '치즈 듬뿍은 아니에요', 9000],
    ['plain', '모락피자', false, '1인용 미니 피자', 7000],
  ];
  const engine = createEngine({
    stores: pizza.map(([id, name, franchise]) => ({
      id, name, franchise, region: '서초구', dong: '서초4동', category: '피자', rating: 4.5, tip: 1000,
    })),
    menus: pizza.map(([store, , , desc, price]) => ({ store, id: store + '-menu', name: '치즈피자', desc, price })),
  });
  const first = await textTurn(engine, null, '서초구에서 치즈가 많은 고소한 피자를 먹고 싶어');
  assert.deepEqual(first.state.cond.taste, ['고소', '치즈 듬뿍']); // 고소는 표준 맛(TASTE_CANON). 치즈피자 이름이 근거
  assert.equal(first.state.cond.dish, null);
  assert.equal(cards(first).filter(id => id.startsWith('chain')).length, 1);
  assert.ok(cards(first).includes('small-shop'));
  assert.ok(!cards(first).includes('denied-cheese'));
  assert.ok(first.reply.cards.every(card => card.checks.includes('치즈 듬뿍')));
  const noAi = new Proxy({}, { get: () => assert.fail('A franchise question should only read the catalog') });
  const answer = await textTurn(engine, first, '너가 추천해준곳은 프렌차이즈 아닌가?', noAi);
  assert.match(answer.reply.text, /프랜차이즈.*오븐피자.*나머지/);
  assert.equal(answer.reply.preserveResults, true);
  assert.deepEqual(answer.state, first.state);
  const independent = await engine.handle(answer.state, answer.reply.buttons[0].action, noGemini);
  assert.deepEqual(cards(independent), ['small-shop']);
  assert.deepEqual(independent.state.cond.taste, ['고소', '치즈 듬뿍']);
  assert.equal(independent.state.cond.franchise, 'exclude');
  const explicit = await textTurn(engine, first, '프렌차이즈 아닌 피자집으로 바꿔줘');
  assert.deepEqual(cards(explicit), ['small-shop']);
  assert.deepEqual(explicit.state.cond.taste, ['고소', '치즈 듬뿍']);
  const tooCheap = await textTurn(engine, independent, '1만원으로 바꿔줘');
  assert.deepEqual(cards(tooCheap), ['small-shop']);
  assert.match(tooCheap.reply.cards[0].budgetNote, /18,000원/);
  const unavailable = await textTurn(createEngine({
    stores: [{ id: 'plain', name: '작은피자', franchise: false, region: '서초구', dong: '서초4동', category: '피자', rating: 4.5, tip: 1000 }],
    menus: [{ store: 'plain', id: 'plain-menu', name: '치즈피자', desc: '치즈 쭉쭉 고소', price: 9000 }],
  }), null, '서초구에서 치즈 듬뿍 피자 추천해줘');
  assert.match(unavailable.reply.text, /치즈 양이 많다는 근거/);
  assert.deepEqual(cards(unavailable), []);
});

function chickenCatalog(rows) {
  const stores = [...new Set(rows.map(([store]) => store))].map(id => ({
    id, name: id, region: '서초구', dong: '서초4동', category: '치킨', tip: 1000, rating: 4.5,
  }));
  const menus = rows.map(([store, id, name, price, desc = '']) => ({ store, id, name, price, desc }));
  return { stores, menus };
}

test('keeps non-spicy requests explicit in regular results and budget alternatives', async () => {
  const engine = createEngine(chickenCatalog([
    ['house-mild', 'mild', '간장치킨', 18000, '간장 소스는 맵지 않아 순한 맛이에요.'],
    ['house-hot', 'hot', '매운 양념치킨', 8000],
    ['house-unknown', 'unknown', '후라이드치킨', 7000],
    ['house-both', 'both', '반반 치킨', 6000, '안 매운 간장과 매운 양념 반반'],
  ]));
  const search = text => engine.handle(null, { type: 'text', text });
  for (const request of ['안 매운 치킨', '맵지 않은 치킨', '순한 맛 치킨', '치킨. 매운 건 빼줘']) {
    const result = await search(`서초구에서 ${request} 추천해줘`);
    assert.equal(result.state.cond.dish, null);
    assert.deepEqual(result.state.cond.taste, ['안 매운']);
    assert.deepEqual(cards(result), ['house-mild']);
    assert.match(result.reply.cards[0].reason, /메뉴 설명.*안 매운/);
  }
  const hot = await search('서초구에서 매운 치킨 추천해줘');
  const switched = await engine.handle(hot.state, { type: 'text', text: '안 매운 걸로' });
  assert.deepEqual(switched.state.cond.taste, ['안 매운']);
  const overBudget = await engine.handle(switched.state, { type: 'text', text: '예산만 1만 원으로' });
  assert.deepEqual(cards(overBudget), ['house-mild']);
  assert.equal(overBudget.reply.cards[0].budgetNote, '예산보다 9,000원 높아요');
  const alternative = await engine.handle(switched.state, { type: 'text', text: '안 매운 후라이드치킨으로 바꿔줘' });
  assert.deepEqual(cards(alternative), ['house-mild']);
  assert.equal(alternative.reply.cards[0].partial, true);
  const onlySpicy = createEngine(chickenCatalog([['house-hot', 'hot', '매운치킨', 8000]]));
  const noEvidence = await onlySpicy.handle(null, { type: 'text', text: '서초구 안 매운 치킨 2만 원 이하 추천해줘' });
  assert.deepEqual(cards(noEvidence), []);
  assert.match(noEvidence.reply.text, /맵지 않다고 표기된/);
  assert.ok(noEvidence.reply.chips.some(chip => chip.label === '안 매운'));
});

test('does not add a spicy or undocumented main to a non-spicy group plan', async () => {
  const engine = createEngine(chickenCatalog([
    ['house', 'mild', '순한 간장치킨 (2인분)', 14000],
    ['house', 'hot', '매운치킨 (1인분)', 4000],
    ['house', 'unknown', '후라이드치킨 (1인분)', 6000],
  ]));
  const result = await engine.handle(null, { type: 'text', text: '서초구에서 3명 안 매운 치킨 3만3천 원으로 추천해줘' });
  const [card] = result.reply.cards;
  assert.equal(card.menuId, 'mild');
  assert.equal(card.items, undefined);
  assert.equal(card.qty, 2);
  assert.equal(card.total, 29000);
  assert.equal(card.portionNote, '4인분 표기 기준');
});

test('asks a local chicken question based on eligible plans and keeps the chosen cut after a budget edit', async () => {
  const engine = createEngine(snapshot);
  const first = await engine.handle(null, { type: 'text', text: '서초구에서 두 명이서 인당 1만2천 원 치킨 추천해줘' });
  assert.equal(first.state.cond.budget_unit, 'per_person');
  assert.match(first.reply.followUp, /순살과 뼈/);
  assert.deepEqual(first.state.pending, [
    { label: '순살', store_ids: ['seocho-chicken', 'seocho-chicken-crunch'] },
    { label: '뼈', store_ids: ['seocho-chicken-bone'] },
  ]);
  const skip = first.reply.buttons.find(button => button.label === '상관없어요');
  const skipped = await engine.handle(first.state, skip.action);
  assert.equal(skipped.state.pending, null);
  assert.equal(skipped.state.dong, '서초구');
  const option = first.reply.buttons.find(button => button.label === '순살 (2곳)');
  const selected = await engine.handle(first.state, option.action);
  assert.ok(selected.reply.cards.length > 0);
  assert.ok(selected.reply.cards.every(card => /순살/.test(card.menu)));
  assert.equal(selected.state.pending, null);
  const updated = await engine.handle(selected.state, { type: 'text', text: '예산만 3만 원으로 바꿔줘' });
  assert.equal(updated.state.cond.budget, 30000);
  assert.equal(updated.state.cond.budget_unit, 'per_person');
  assert.equal(updated.state.cond.menu, '치킨');
  assert.equal(updated.state.cond.people, 2);
  assert.deepEqual(updated.state.cond.taste, ['순살']);
  assert.ok(updated.reply.cards.every(card => /순살/.test(card.menu)));
});

test('skips local cut questions that cannot narrow the candidates within budget', async () => {
  const engine = createEngine(chickenCatalog([
    ['both-cuts', 'boneless', '마늘간장 순살', 16000],
    ['both-cuts', 'bone', '뼈 있는 양념치킨', 17000],
    ['too-expensive', 'expensive-bone', '뼈 있는 치킨', 31000],
    ['unspecified', 'whole', '후라이드치킨', 18000],
  ]));
  const result = await engine.handle(null, { type: 'text', text: '서초구 치킨 2만 원 이하 추천해줘' });
  assert.ok(result.reply.cards.some(card => card.menuId === 'boneless'));
  assert.equal(result.state.pending, null);
  assert.doesNotMatch(result.reply.followUp, /순살과 뼈/);
  const bone = await engine.handle(result.state, { type: 'text', text: '뼈가 있는 치킨 추천해줘' });
  assert.equal(bone.state.cond.dish, null);
  assert.deepEqual(bone.reply.cards.map(card => card.menuId), ['bone']);
});

test('keeps a taste while asking for a category and displays evidence for catalog synonyms', async () => {
  const engine = createEngine(chickenCatalog([
    ['crispy-mild', 'crispy', '후라이드치킨', 18000, '겉바속촉이고 맵지 않아요.'],
    ['other', 'spicy', '매운 양념치킨', 17000],
  ]));
  const first = await engine.handle(null, { type: 'text', text: '서초구에서 크리스피하고 안 매운 걸로 추천해줘' });
  const chooseChicken = first.reply.buttons.find(button => button.label === '치킨');
  assert.ok(chooseChicken);
  const result = await engine.handle(first.state, chooseChicken.action);
  assert.deepEqual(result.state.cond.taste, ['바삭', '안 매운']);
  assert.deepEqual(cards(result), ['crispy-mild']);
  assert.ok(result.reply.cards[0].checks.includes('바삭'));
  assert.match(result.reply.cards[0].reason, /메뉴 설명.*안 매운/);
});

test('changes district and dong without clearing food, headcount or budget', async () => {
  const engine = createEngine(snapshot);
  const first = await textTurn(engine, null, '서초구에서 둘이 2만5천 원 안에 치킨 추천해줘');
  assert.equal(first.state.dong, '서초구');
  assert.equal(first.state.cond.people, 2);
  assert.equal(first.state.cond.budget, 25000);
  assert.ok(cards(first).every(id => id.startsWith('seocho-')));
  assert.ok(first.reply.cards.every(c => c.menu !== '등심돈까스'));
  const change = await textTurn(engine, first, '서초구 말고 강남구에서 찾아줘');
  assert.equal(change.state.dong, '강남구');
  assert.equal(change.state.cond.budget, 25000);
  assert.deepEqual(cards(change), ['gangnam-chicken']);
  const dong = await textTurn(engine, change, '역삼동으로');
  assert.equal(dong.state.neighborhood, '역삼동');
  assert.deepEqual(cards(dong), ['gangnam-chicken']);
  const dropdown = await engine.handle(dong.state, { type: 'dong', dong: '서초구' }, noGemini);
  assert.equal(dropdown.state.cond.menu, '치킨');
  assert.equal(dropdown.state.neighborhood, null);
  assert.ok(cards(dropdown).every(id => id.startsWith('seocho-')));
});

test('expands the region and never includes stores outside Seoul in Seoul-wide results', async () => {
  const engine = createEngine(snapshot);
  const first = await textTurn(engine, null, '강남구에서 피자 추천해줘');
  const broad = await textTurn(engine, first, '다른 지역도 괜찮아');
  assert.equal(broad.state.dong, '서울 전체');
  assert.equal((await textTurn(engine, first, '상관없어요')).state.dong, '서울 전체');
  const chicken = await textTurn(engine, broad, '지역 상관없어. 치킨 말고 후라이드치킨 추천해줘');
  assert.equal(chicken.state.dong, '서울 전체');
  assert.deepEqual(cards(chicken), ['seocho-chicken-crunch']);
  const unknown = await textTurn(engine, chicken, '해운대구에서 추천해줘');
  assert.match(unknown.reply.text, /해운대.*(?:찾지 못했어요|추천해 드릴 수 없어요)/); // 서울 밖은 추천하지 않는다(지역 밖 안내)
  assert.equal(unknown.state.dong, '서울 전체');
  assert.deepEqual(cards(unknown), []);
});

test('replaces stale food filters and selections when a new request follows', async () => {
  const engine = createEngine(snapshot);
  const first = await textTurn(engine, null, '서초구에서 둘이 2만5천 원에 간장치킨 먹고 싶어');
  first.state.chosen = [{ label: '순살', store_ids: ['seocho-chicken'] }];
  first.state.seen = ['gangnam-pizza'];
  const second = await textTurn(engine, first, '치킨 말고 강남구에서 피자. 2만 원 이하로');
  assert.equal(second.state.cond.menu, '피자');
  assert.equal(second.state.cond.dish, null);
  assert.equal(second.state.cond.people, 2);
  assert.equal(second.state.cond.budget, 20000);
  assert.deepEqual(second.state.chosen, []);
  assert.deepEqual(cards(second), ['gangnam-pizza']);
  const third = await textTurn(engine, second, '가격은 상관없어');
  assert.equal(third.state.cond.budget, null);
  assert.ok(cards(third).includes('gangnam-pizza-expensive'));
  assert.ok(third.reply.followUp);
});

test('shows exact dishes, then explicitly labeled category alternatives for missing dishes or stores', async () => {
  const engine = createEngine(snapshot);
  const exact = await textTurn(engine, null, '강남구에서 짬뽕 추천해줘');
  assert.deepEqual(cards(exact), ['gangnam-chinese']);
  assert.equal(exact.reply.cards[0].menu, '해물짬뽕');
  const absent = await textTurn(engine, exact, '짜장면이 먹고 싶어');
  assert.match(absent.reply.text, /짜장면.*찾지 못했어요.*중식.*대안/);
  assert.ok(absent.reply.cards.every(c => c.partial && c.menu !== '짜장면'));
  const store = await textTurn(engine, absent, '“없는반점” 가게 있어?');
  assert.match(store.reply.text, /없는반점.*찾지 못했어요.*중식.*대안/);
  const exactShop = await textTurn(engine, store, '미소반점 있어?');
  assert.deepEqual(cards(exactShop), ['gangnam-chinese']);
  const overBudget = await textTurn(engine, exact, '8천 원 미만');
  assert.match(overBudget.reply.text, /데이터는 있지만 현재 조건/);
  assert.deepEqual(cards(overBudget), ['gangnam-chinese']);
  assert.equal(overBudget.reply.cards[0].budgetNote, '예산보다 1,500원 높아요');
  assert.ok(!overBudget.reply.cards[0].checks.includes('예산'));
});

const tteokbokkiStores = [
  { id: 'seller', name: '봄분식', category: '분식' },
  { id: 'brand', name: '엽떡 서초점', category: '분식' },
  { id: 'mala', name: '마라반점', category: '중식' },
].map(store => ({ ...store, region: '서초구', dong: '서초4동', tip: 1000, rating: 4.5 }));
const tteokbokkiMenus = [
  { id: 'brand-original', store: 'brand', name: '엽떡', price: 13000, desc: '매운 떡볶이' },
  { id: 'mala-tang', store: 'mala', name: '마라탕', price: 12000, desc: '얼얼한 마라 맛' },
];

test('matches the whole registered 마라로제엽떡 name instead of filtering by the store name inside it', async () => {
  const registered = { id: 'demo-mara-rose', store: 'seller', name: '마라로제엽떡', price: 16000, desc: '마라 향과 로제 소스를 더한 떡볶이예요.' };
  const engine = createEngine({ stores: tteokbokkiStores, menus: [...tteokbokkiMenus, registered] });
  const region = await engine.handle(null, { type: 'dong', dong: '서초구' });
  for (const text of ['마라로제엽떡', '마라 로제 엽떡', '2만 원 이하로 마라로제엽떡 추천해줘']) {
    const result = await textTurn(engine, region, text);
    assert.equal(result.state.cond.menu, '분식');
    assert.equal(result.state.cond.dish, registered.name);
    assert.equal(result.state.cond.store, null);
    assert.deepEqual(result.state.cond.taste, ['로제', '마라']);
    assert.deepEqual(cards(result), ['seller']);
    const [card] = result.reply.cards;
    assert.equal(card.menuId, registered.id);
    assert.equal(card.partial, false);
    assert.ok(card.checks.includes('마라') && card.checks.includes('로제'));
  }
  const explicitStore = await textTurn(engine, region, '엽떡 서초점에서 마라로제엽떡 추천해줘');
  assert.equal(explicitStore.state.cond.store, '엽떡 서초점');
  const model = { parse: async () => ({ menu: '중식', dish: '마라', taste: ['마라'] }) };
  const withModel = await textTurn(engine, region, '마라로제엽떡 추천해줘', model);
  assert.equal(withModel.state.cond.menu, '분식');
  assert.equal(withModel.state.cond.dish, registered.name);
  assert.ok(withModel.reply.cards[0].checks.includes('로제'));
});

test('keeps the flavored 떡볶이 request in 분식 when the exact menu is absent', async () => {
  const similar = { id: 'similar', store: 'seller', name: '마라 로제 떡볶이', price: 15000, desc: '마라 향과 로제 소스' };
  const engine = createEngine({ stores: tteokbokkiStores, menus: [...tteokbokkiMenus, similar] });
  const region = await engine.handle(null, { type: 'dong', dong: '서초구' });
  const result = await textTurn(engine, region, '마라로제엽떡');
  assert.equal(result.state.cond.menu, '분식');
  assert.equal(result.state.cond.dish, '마라로제엽떡');
  assert.equal(result.state.cond.store, null);
  assert.deepEqual(result.state.cond.taste, ['로제', '마라']);
  assert.match(result.reply.text, /마라로제엽떡.*찾지 못했어요.*분식.*대안/);
  assert.deepEqual(cards(result), ['seller']);
  assert.equal(result.reply.cards[0].menuId, similar.id);
  assert.equal(result.reply.cards[0].partial, true);
  const singleFlavor = createEngine({
    stores: tteokbokkiStores,
    menus: [...tteokbokkiMenus, { ...similar, name: '로제떡볶이', desc: '부드러운 로제 소스' }],
  });
  const partial = await textTurn(singleFlavor, region, '마라로제엽떡');
  assert.match(partial.reply.text, /‘마라’ 조건은 .*확인하지 못했어요/);
  assert.ok(partial.reply.cards.every(card => card.partial && !card.checks.includes('마라')));
  const malaTang = await textTurn(engine, region, '마라탕');
  assert.equal(malaTang.state.cond.menu, '중식');
  assert.equal(malaTang.reply.cards[0].menuId, 'mala-tang');
});

test('searches a group budget without a category and offers the nearest totals', async () => {
  const engine = createEngine({
    stores: snapshot.stores.filter(store => store.category === '치킨'),
    menus: snapshot.menus,
  });
  const result = await textTurn(engine, null, '5명이서 4만원에 배불리 먹고 싶어');
  assert.equal(result.state.dong, '서울 전체');
  assert.equal(result.state.cond.people, 5);
  assert.equal(result.state.cond.budget, 40000);
  assert.match(result.reply.text, /현재 조건.*예산에 가까운 대안/);
  assert.deepEqual(result.reply.cards.map(card => [card.qty, card.total]), [[3, 49000], [3, 52000], [2, 55000]]);
  assert.ok(result.reply.cards.every(card => card.partial && !card.checks.includes('예산')));
  assert.equal(result.reply.cards[0].budgetNote, '예산보다 9,000원 높아요');
  const confirmed = await textTurn(engine, result, '1번 메뉴가 마음에 들어');
  assert.equal(confirmed.reply.selected.budgetNote, '예산보다 9,000원 높아요');
  const sameDistrict = await textTurn(engine, result, '강남구에서 찾아줘');
  assert.deepEqual(cards(sameDistrict), ['gangnam-chicken']);
  assert.equal(sameDistrict.state.cond.budget, 40000);
});

test('compares listed set portions and mixed meals with one delivery fee per store', async () => {
  const engine = createEngine({
    stores: [
      { id: 'set-shop', name: '모둠중식', region: '강남구', dong: '역삼동', category: '중식', rating: 4.5, tip: 3000 },
      { id: 'mix-shop', name: '골목반점', region: '강남구', dong: '삼성동', category: '중식', rating: 4.5, tip: 2000 },
    ],
    menus: [
      { id: 'set', store: 'set-shop', name: '특선 세트 (3인분)', desc: '', price: 26000 },
      { id: 'single', store: 'set-shop', name: '잡채밥', desc: '', price: 11000 },
      { id: 'main', store: 'mix-shop', name: '해물짬뽕', desc: '2인분', price: 19000 },
      { id: 'rice', store: 'mix-shop', name: '새우볶음밥', desc: '1인분', price: 10000 },
      { id: 'drink', store: 'mix-shop', name: '콜라', desc: '', price: 1000 },
    ],
  });
  const result = await textTurn(engine, null, '강남구에서 3명이서 3만2천원으로 중식 추천해줘');
  assert.equal(result.reply.cards.length, 2);
  const set = result.reply.cards.find(card => card.storeId === 'set-shop');
  const mix = result.reply.cards.find(card => card.storeId === 'mix-shop');
  assert.equal(set.qty, 1);
  assert.equal(set.total, 29000);
  assert.equal(set.setMenu, true);
  assert.equal(set.portionNote, '3인분 표기 기준');
  assert.equal(mix.total, 31000);
  assert.deepEqual(mix.items.map(item => item.menuId).sort(), ['main', 'rice']);
  const approved = await textTurn(engine, result, '골목반점이 마음에 들어');
  assert.equal(approved.reply.selected.total, mix.total);
  assert.deepEqual(approved.reply.selected.items, mix.items);
  const exact = await textTurn(engine, null, '강남구에서 3명이서 3만2천원으로 짬뽕 추천해줘');
  assert.equal(exact.reply.cards[0].menuId, 'main');
  assert.ok(exact.reply.cards[0].items.some(item => item.menuId === 'rice'));
});

test('keeps both foods in the first results and lists all six unseen stores on request', async () => {
  const chickenStores = Array.from({ length: 4 }, (_, index) => ({ id: `chicken-${index}`, category: '치킨' }));
  const snackStores = Array.from({ length: 5 }, (_, index) => ({ id: `snack-${index}`, category: '분식' }));
  const stores = [...chickenStores, ...snackStores].map(store => ({
    ...store, name: store.id, region: '서초구', dong: '서초4동', tip: 1000, rating: 4.5,
  }));
  const menus = stores.map(store => ({
    id: `${store.id}-1`, store: store.id, name: store.category === '치킨' ? '후라이드치킨' : '떡볶이',
    price: store.category === '치킨' ? 18000 : 5500, desc: '',
  }));
  const engine = createEngine({ stores, menus });
  const first = await textTurn(engine, null, '치킨이랑 떡볶이를 같이 먹고 싶어');
  assert.equal(first.state.dong, '서울 전체');
  assert.deepEqual(first.reply.cards.map(card => card.foodLabel), ['치킨', '떡볶이', '치킨']);
  assert.equal(first.reply.remaining, 6);
  assert.match(first.reply.buttons[0].label, /6곳 더 보기/);
  const rest = await textTurn(engine, first, '다른 6곳도 알려줘');
  assert.equal(cards(rest).length, 6);
  assert.equal(new Set([...cards(first), ...cards(rest)]).size, 9);
  assert.equal(rest.reply.remaining, 0);
  assert.deepEqual(rest.state.cond.foods, first.state.cond.foods);
  const exhausted = await textTurn(engine, rest, '나머지 후보도 보여줘');
  assert.match(exhausted.reply.text, /더 보여드릴 후보가 없어요/);
  const switched = await textTurn(engine, rest, '떡볶이 말고 치킨으로 바꿔줘');
  assert.equal(switched.state.cond.menu, '치킨');
  assert.deepEqual(switched.state.cond.foods, []);
});

test('shows unseen single-food recommendations when the user asks for a count', async () => {
  const engine = createEngine(snapshot);
  const first = await textTurn(engine, null, '서초구에서 치킨 추천해줘');
  assert.equal(first.reply.remaining, 1);
  const rest = await textTurn(engine, first, '나머지 1곳도 보여줘');
  assert.equal(cards(rest).length, 1);
  assert.equal(rest.reply.remaining, 0);
  assert.ok(!cards(first).includes(cards(rest)[0]));
});

test('places a grounded follow-up after the results and discards invented catalog entries', async () => {
  const engine = createEngine(snapshot);
  const ai = {
    parse: async () => ({}),
    judge: async () => [{ store_id: 'invented', menu_ids: ['invented'], match: '맞음' }],
    question: async () => ({ question: '순살과 뼈 중 어느 쪽이 좋으세요?', options: [
      { label: '순살', store_ids: ['seocho-chicken', 'seocho-chicken-crunch', 'invented'] },
      { label: '뼈', store_ids: ['seocho-chicken-bone'] },
    ] }),
  };
  const first = await textTurn(engine, null, '서초구 치킨 추천해줘', ai);
  assert.equal(first.reply.cards.length, 3);
  assert.ok(first.reply.cards.every(c => c.storeId !== 'invented'));
  assert.match(first.reply.followUp, /순살과 뼈/);
  assert.ok(first.reply.buttons.some(b => b.label === '순살 (2곳)'));
  const narrower = await textTurn(engine, first, '순살', ai);
  assert.ok(narrower.reply.cards.every(c => /순살/.test(c.menu)));
  assert.deepEqual(narrower.state.chosen.map(c => c.label), ['순살']);
  const moved = await textTurn(engine, narrower, '강남구로 바꿔줘', ai);
  assert.deepEqual(moved.state.cond.taste, ['순살']);
  assert.deepEqual(cards(moved), ['gangnam-chicken']);
});

test('Gemini can identify a specific new dish without introducing an invented menu or an amount', async () => {
  const engine = createEngine(snapshot);
  const first = await textTurn(engine, null, '강남구에서 둘이 2만5천 원에 피자 추천해줘');
  const ai = { ...noGemini, parse: async () => ({ menu: '피자', dish: '트러플 피자', budget: 99000 }), judge: noGemini.judge, question: noGemini.question };
  const second = await textTurn(engine, first, '트러플 피자가 먹고 싶어', ai);
  assert.equal(second.state.cond.dish, '트러플 피자');
  assert.equal(second.state.cond.budget, 25000);
  assert.match(second.reply.text, /트러플 피자.*찾지 못했어요/);
  assert.deepEqual(cards(second), ['gangnam-pizza']);
  const fallback = await textTurn(engine, first, '강남구로 바꾸고 트러플 피자 추천해줘');
  assert.match(fallback.reply.text, /트러플 피자.*찾지 못했어요/);
  const short = await textTurn(engine, first, '트러플 피자');
  assert.match(short.reply.text, /트러플 피자.*찾지 못했어요/);
  const withPrice = await textTurn(engine, first, '강남구에서 트러플 피자 추천해줘. 가격은 상관없어');
  assert.equal(withPrice.state.cond.budget, null);
  assert.match(withPrice.reply.text, /트러플 피자.*찾지 못했어요/);
});

test('understands the reported 1만원대 and excludes the original district on request', async () => {
  const engine = createEngine(snapshot);
  const selected = await engine.handle(null, { type: 'dong', dong: '강동구' }, noGemini);
  const first = await textTurn(engine, selected, '양 많은 1만원대 국밥을 먹고싶어');
  assert.equal(first.state.cond.budget_floor, 10000);
  assert.equal(first.state.cond.budget, 19999);
  assert.deepEqual(cards(first), ['gangdong-gukbap']);
  const moved = await textTurn(engine, first, '강동구에서 말고 다른 지역에서도 찾아봐줘');
  assert.equal(moved.state.dong, '서울 전체');
  assert.equal(moved.state.excludedRegion, '강동구');
  assert.equal(moved.state.cond.budget_floor, 10000);
  assert.deepEqual(cards(moved), ['mapo-gukbap']);
  const cheaper = await textTurn(engine, first, '8천 원 이하로 바꿔줘');
  assert.equal(cheaper.state.cond.budget_floor, null);
  assert.deepEqual(cards(cheaper), ['gangdong-cheap-gukbap']);
});

test('category selection clears the missing dish even when reselecting the current category', async () => {
  const engine = createEngine(snapshot);
  const first = await textTurn(engine, null, '강남구에서 트러플 피자 추천해줘');
  assert.match(first.reply.text, /트러플 피자.*찾지 못했어요/);
  const category = await catTurn(engine, first.state, '피자');
  assert.equal(category.state.cond.dish, null);
  assert.doesNotMatch(category.reply.text, /트러플/);
  assert.ok(cards(category).includes('gangnam-pizza'));
  const changed = await catTurn(engine, category.state, '중식');
  assert.ok(cards(changed).length && cards(changed).every(id => id.startsWith('gangnam-chinese')));
});

test('acknowledges a previous recommendation without re-running the search', async () => {
  const engine = createEngine(snapshot);
  const first = await textTurn(engine, null, '강남구에서 피자 추천해줘');
  assert.ok(first.reply.cards.length >= 2);
  const mustNotCallAI = new Proxy({}, { get() { assert.fail('confirmation must not perform a new search'); } });
  const ambiguous = await textTurn(engine, first, '마음에 들어', mustNotCallAI);
  assert.match(ambiguous.reply.text, /어느 추천이 마음에 들었나요/);
  const chosen = await textTurn(engine, ambiguous, '2번 가게가 마음에 들어', mustNotCallAI);
  const second = first.reply.cards[1];
  assert.equal(chosen.reply.selected.menuId, second.menuId);
  assert.equal(chosen.reply.selected.storeId, second.storeId);
  assert.match(chosen.reply.text, /장바구니/);
  assert.deepEqual(chosen.state.cond, first.state.cond);
  const again = await textTurn(engine, chosen, '그걸로 할게', mustNotCallAI);
  assert.equal(again.reply.selected.menuId, second.menuId);
  const byMenu = await textTurn(engine, first, '버섯 피자가 좋아', mustNotCallAI);
  assert.equal(byMenu.reply.selected.menu, '버섯 피자');
  const switched = await textTurn(engine, chosen, '마음에 드는데 중식으로 바꿔줘');
  assert.equal(switched.state.cond.menu, '중식');
  assert.equal(switched.reply.selected, undefined);
});

test('[P0-2] AI ② 입력은 상한까지만, 앞부분이 아니라 점수 순으로 보내고 선택지 가게는 코드가 근거로 계산한다', async () => {
  const { AI2_MAX_STORES, AI2_MAX_MENUS_PER_STORE, AI2_DESC_MAX_CHARS } = await import('../lib/engine.js');
  const stores = [], menus = [];
  for (let i = 0; i < 20; i++) {
    const id = 'big-' + String(i).padStart(2, '0');
    // 뒤쪽 가게일수록 별점이 높다 → 앞부분 자르기면 뽑히지 않는다
    stores.push({ id, region: '서초구', dong: '서초4동', category: '치킨', name: '닭집' + i, tip: 1000, rating: 3.5 + i * 0.07 });
    for (let k = 0; k < 6; k++) menus.push({ id: `${id}-${k}`, store: id, name: (i % 2 ? '순살' : '뼈') + '치킨' + k, price: 18000 + k * 100, desc: '가'.repeat(150) });
  }
  const engine = createEngine({ stores, menus });
  let payload;
  const ai = {
    parse: async () => { throw Error('LLM unavailable'); },
    judge: async () => { throw Error('LLM unavailable'); },
    question: async p => { payload = p; return { question: '순살과 뼈 중 어느 쪽?', options: [{ label: '순살', store_ids: [] }, { label: '뼈', store_ids: ['big-00'] }] }; },
  };
  const turn = await textTurn(engine, null, '서초구 치킨', ai);
  assert.equal(payload.stores.length, AI2_MAX_STORES);
  assert.ok(payload.stores.every(s => s.menus.length <= AI2_MAX_MENUS_PER_STORE && s.menus.every(m => m.desc.length <= AI2_DESC_MAX_CHARS)));
  assert.ok(payload.stores.some(s => s.store_id === 'big-19'));
  assert.ok(!payload.stores.some(s => s.store_id === 'big-00'));
  // AI가 store_ids를 비워 보내도 남은 20곳 전체에서 근거로 다시 센다
  assert.ok(turn.reply.buttons.some(b => b.label === '순살 (10곳)'));
  assert.ok(turn.reply.buttons.some(b => b.label === '뼈 (10곳)'));
});

test('[P0-4] 보정 별점·신규 가게·영업 여부', async () => {
  const stores = [], menus = [];
  const shop = (id, rating, reviews, extra = {}) => {
    stores.push({ id, region: '용산구', dong: '이촌동', category: '분식', name: id + '분식', tip: 1000, rating, review_count: reviews, ...extra });
    menus.push({ id: id + '-1', store: id, name: '떡볶이', price: 9000, desc: '' });
  };
  shop('lucky-one', 5.0, 1);       // 리뷰 1개짜리 5.0
  shop('steady', 4.7, 500);        // 리뷰 많은 4.7
  shop('newbie', null, 0);         // 리뷰 0개 신규
  shop('closed', 4.9, 300, { is_open: false });
  shop('avg-a', 4.0, 200); shop('avg-b', 4.2, 200);
  const engine = createEngine({ stores, menus });
  const turn = await textTurn(engine, null, '용산구 분식 추천해줘');
  assert.equal(cards(turn)[0], 'steady');   // 리뷰 1개 5.0 가게가 1등이 아님
  assert.match(turn.reply.text, /남은 5곳/); // 6곳 중 영업 안 하는 1곳만 빠짐 (신규 가게는 남음)
  assert.ok(cards(turn).includes('newbie'));
  assert.ok(!cards(turn).includes('closed'));
});

test('[P0-4] 리뷰 0개 신규 가게는 후보에서 빠지지 않고, open 정보가 없으면 지금처럼 영업중으로 본다', async () => {
  const engine = createEngine({
    stores: [
      { id: 'n1', region: '용산구', dong: '이촌동', category: '분식', name: '새가게', tip: 1000, rating: null, review_count: 0, is_open: true },
      { id: 'n2', region: '용산구', dong: '이촌동', category: '분식', name: '옛가게', tip: 1000, rating: 4.4 },
    ],
    menus: [
      { id: 'n1-1', store: 'n1', name: '떡볶이', price: 8000, desc: '' },
      { id: 'n2-1', store: 'n2', name: '떡볶이', price: 8000, desc: '' },
    ],
  });
  const turn = await textTurn(engine, null, '용산구 분식 추천해줘');
  assert.deepEqual(cards(turn).sort(), ['n1', 'n2']);
});

test('[P0-4] 메뉴에 main 표시가 있으면 그 메뉴를 대표 메뉴로 쓴다', async () => {
  const engine = createEngine({
    stores: [{ id: 'm1', region: '용산구', dong: '이촌동', category: '분식', name: '김밥집', tip: 1000, rating: 4.5 }],
    menus: [
      { id: 'm1-1', store: 'm1', name: '참치김밥', price: 5000, desc: '' },
      { id: 'm1-2', store: 'm1', name: '라볶이', price: 9000, desc: '', main: true },
    ],
  });
  const turn = await textTurn(engine, null, '용산구 분식 추천해줘');
  assert.match(turn.reply.cards[0].menu, /라볶이/);
});

test('[P1-3] 양보안에 바뀌는 조건을 from → to로 담는다', async () => {
  const stores = [], menus = [];
  for (const [id, franchise] of [['a', false], ['b', false], ['c', true]]) {
    stores.push({ id, region: '서초구', dong: '서초4동', category: '치킨', name: id + '닭', tip: 1000, rating: 4.5, franchise });
    menus.push({ id: id + '-1', store: id, name: '후라이드치킨', price: 18000, desc: '' });
  }
  const turn = await textTurn(createEngine({ stores, menus }), null, '서초구 치킨 프랜차이즈 말고');
  assert.equal(turn.reply.cards.length, 2);
  const b = turn.reply.buttons.find(b => b.change);
  assert.deepEqual(b.change, { label: '프랜차이즈', from: '제외', to: '포함' });
  assert.equal(b.label, '프랜차이즈도 괜찮으면 1곳 더');
  assert.deepEqual(b.action, { type: 'apply', cond: { franchise: 'none' } });
});

test('패스트푸드 대표 메뉴는 버거, 사이드(너겟·코울슬로)는 대표 메뉴가 아니다', async () => {
  const engine = createEngine({
    stores: [{ id: 'b1', region: '서초구', dong: '서초2동', category: '패스트푸드', name: '버거집', tip: 2000, rating: 4.8 }],
    menus: [
      { id: 'b1-1', store: 'b1', name: '너겟(6조각)', price: 4000, desc: '' },
      { id: 'b1-2', store: 'b1', name: '코울슬로', price: 3500, desc: '' },
      { id: 'b1-3', store: 'b1', name: '치즈버거', price: 7900, desc: '' },
      { id: 'b1-4', store: 'b1', name: '콜라 500ml', price: 2000, desc: '' },
      { id: 'b1-5', store: 'b1', name: '핫도그', price: 3000, desc: '' },
    ],
  });
  for (const text of ['서초구 햄버거', '서초구 둘이서 햄버거 3만원 이하']) {
    const turn = await textTurn(engine, null, text);
    const c = turn.reply.cards[0];
    const names = (c.items ?? [{ name: c.menu }]).map(line => line.name).join(' + ');
    assert.match(names, /버거/, text);
    assert.doesNotMatch(names, /너겟|코울슬로|콜라|핫도그/, text);
  }
  // 핫도그는 직접 말하면 찾는다
  assert.match((await textTurn(engine, null, '서초구 핫도그')).reply.cards[0].menu, /핫도그/);
});

test('고기·구이 "싸게"는 된장찌개·도시락이 아니라 고기 메뉴끼리 비교한다', async () => {
  const stores = [], menus = [];
  const shop = (id, list) => {
    stores.push({ id, region: '서초구', dong: '서초4동', category: '고기·구이', name: id + '고깃집', tip: 2000, rating: 4.5 });
    list.forEach(([name, price], i) => menus.push({ id: `${id}-${i}`, store: id, name, price, desc: '' }));
  };
  const sides = [['된장찌개', 3000], ['공기밥', 1000], ['냉면', 6000], ['1인 고기 도시락', 9000], ['차돌된장 세트', 12000], ['파절이', 2000]];
  shop('g1', [['삼겹살 구이(200g)', 17500], ['목살 구이(200g)', 18500], ...sides]);
  shop('g2', [['삼겹살 구이(200g)', 16000], ['돼지갈비(2인)', 32000], ...sides]);
  shop('g3', [['항정살 구이(180g)', 19000], ['소불고기(2인)', 31000], ...sides]);
  shop('g4', [['대패삼겹살(100g)', 9900], ...sides]);
  shop('g5', [['생삼겹살(200g)', 15000], ...sides]);
  const engine = createEngine({ stores, menus });
  const area = await engine.handle(undefined, { type: 'dong', dong: '서초구' }, noGemini);
  const cheap = await engine.handle(area.state, { type: 'text', text: '싸게' }, noGemini);
  const turn = await catTurn(engine, cheap.state, '고기·구이');
  const shown = turn.reply.cards.map(c => c.items ? c.items.map(i => i.name).join('+') : c.menu);
  assert.ok(shown.length >= 1, JSON.stringify(turn.reply.text));
  for (const name of shown) assert.doesNotMatch(name, /된장|공기|냉면|도시락|세트|파절이/, name);
});

const shopsOf = (category, list) => {
  const stores = [], menus = [];
  for (const [id, items] of list) {
    stores.push({ id, region: '서초구', dong: '서초4동', category, name: id + '집', tip: 1000, rating: 4.5 });
    items.forEach(([name, price], i) => menus.push({ id: `${id}-${i}`, store: id, name, price, desc: '' }));
  }
  return createEngine({ stores, menus });
};
const menusOf = turn => turn.reply.cards.map(c => c.items ? c.items.map(i => `${i.name}×${i.qty}`).join('+') : `${c.menu}×${c.qty ?? 1}`);

test('가성비는 1인분당 가격으로 비교: 혼자여도 닭강정(1인)이 한 마리 치킨보다 무조건 앞서지 않는다', async () => {
  const engine = shopsOf('치킨', [
    ['k1', [['닭강정(1인)', 12000]]], ['k2', [['후라이드치킨', 18000]]], ['k3', [['양념치킨', 19000]]],
    ['k4', [['닭강정(1인)', 10000]]], ['k5', [['간장치킨', 21000]]], ['k6', [['닭강정(1인)', 13000]]],
  ]);
  const turn = await textTurn(engine, null, '서초구 치킨');
  assert.equal(turn.state.cond.price_pref, 'none'); // 가성비 모드
  assert.match(menusOf(turn)[0], /후라이드치킨/);      // 1인분당 9,500원 < 닭강정 11,000원
  assert.match(turn.reply.cards[0].valueLabel ?? '', /1인분 기준/);
});

test('후보에 닭강정이 섞이면 "닭강정 빼고 보기" → 치킨만, 칩으로 되돌리기', async () => {
  const engine = shopsOf('치킨', [
    ['k1', [['닭강정(1인)', 7000]]], ['k2', [['후라이드치킨', 18000]]], ['k3', [['양념치킨', 19000]]],
    ['k4', [['닭강정(1인)', 7500], ['후라이드치킨', 22000]]], ['k5', [['간장치킨', 21000]]],
  ]);
  const turn = await textTurn(engine, null, '서초구 치킨');
  assert.ok(menusOf(turn).some(m => /닭강정/.test(m)), menusOf(turn).join());
  const button = turn.reply.buttons.find(b => b.label === '닭강정 빼고 보기');
  assert.ok(button);
  const without = await engine.handle(turn.state, button.action, noGemini);
  assert.ok(without.reply.cards.length >= 3);
  assert.ok(menusOf(without).every(m => !/닭강정/.test(m)), menusOf(without).join());
  assert.ok(!without.reply.buttons.some(b => b.label === '닭강정 빼고 보기'));
  const chip = without.reply.chips.find(c => c.label === '닭강정 제외');
  assert.ok(chip);
  const back = await engine.handle(without.state, chip.remove, noGemini);
  assert.deepEqual(back.state.cond.exclude, []);
  // 업종을 바꾸면 빼기는 풀린다
  const pizza = await catTurn(engine, without.state, '피자');
  assert.deepEqual(pizza.state.cond.exclude, []);
});

test('고기는 무게로 양을 맞춘다: 대패삼겹살(100g)은 혼자여도 2개로 비교', async () => {
  const engine = shopsOf('고기·구이', [
    ['m1', [['대패삼겹살(100g)', 9900]]], ['m2', [['삼겹살 구이(200g)', 17500]]], ['m3', [['생삼겹살(200g)', 15000]]],
    ['m4', [['목살 구이(200g)', 16500]]], ['m5', [['항정살 구이(180g)', 19000]]],
  ]);
  const area = await engine.handle(undefined, { type: 'dong', dong: '서초구' }, noGemini);
  const cheap = await engine.handle(area.state, { type: 'text', text: '싸게' }, noGemini);
  const turn = await catTurn(engine, cheap.state, '고기·구이');
  const shown = menusOf(turn);
  assert.match(shown[0], /생삼겹살\(200g\)×1/);
  const daepae = shown.find(m => /대패/.test(m));
  if (daepae) assert.match(daepae, /×2/);
  assert.ok(!/대패/.test(shown[0]));
});

test('닭강정을 함께 파는 치킨집: 싸게·예산·가성비에서도 가게 대표는 치킨, 닭강정은 치킨이 안 맞을 때만', async () => {
  // 실제 데이터처럼 대부분의 치킨집이 닭강정(1인)을 같이 판다
  const engine = shopsOf('치킨', [
    ['c1', [['후라이드치킨', 16000], ['닭강정(1인)', 11500]]], ['c2', [['양념치킨', 17000], ['닭강정(1인)', 11000]]],
    ['c3', [['간장치킨', 18000], ['닭강정(1인)', 12000]]], ['c4', [['후라이드치킨', 19000], ['닭강정(1인)', 11500]]],
    ['c5', [['반반치킨', 18500], ['닭강정(1인)', 12500]]], ['c6', [['닭강정(1인)', 10000]]],
  ]);
  for (const text of ['서초구 치킨 먹고 싶어 싸게', '서초구 치킨 2만원 이하', '서초구 치킨 먹고 싶은데 가성비 좋은 걸로']) {
    const turn = await textTurn(engine, null, text);
    const shown = menusOf(turn);
    // 치킨을 파는 가게(c1~c5)의 카드는 치킨. 닭강정은 닭강정만 파는 c6 카드에만
    for (const card of turn.reply.cards) if (card.storeId !== 'c6') assert.doesNotMatch(card.menu, /닭강정/, `${text}: ${shown.join()}`);
  }
  // 가성비(1인분당)는 한 마리 치킨이 닭강정(1인)보다 앞선다
  assert.match(menusOf(await textTurn(engine, null, '서초구 치킨 먹고 싶은데 가성비 좋은 걸로'))[0], /치킨/);
  // 예산 안에 치킨이 하나도 없으면 닭강정으로 대신 보여주고, 빼기 버튼을 준다
  const tight = await textTurn(engine, null, '서초구 치킨 만오천원 이하');
  assert.ok(menusOf(tight).every(m => /닭강정/.test(m)), menusOf(tight).join());
  assert.ok(tight.reply.buttons.some(b => b.label === '닭강정 빼고 보기'));
  // 닭강정을 직접 말하면 닭강정을 찾는다
  assert.ok(menusOf(await textTurn(engine, null, '서초구 닭강정')).every(m => /닭강정/.test(m)));
});

test('"가성비"는 가성비 모드(1인분당 비교), "싸게"는 총액 최저', async () => {
  const engine = createEngine(snapshot);
  assert.equal((await textTurn(engine, null, '서초구 치킨 가성비 좋은 걸로')).state.cond.price_pref, 'none');
  assert.equal((await textTurn(engine, null, '서초구 치킨 싸게')).state.cond.price_pref, 'cheap');
});

test('예산 안에 한 마리 치킨이 있으면, 1인분당 더 싼 치킨이 닭강정(1인)보다 앞선다 (동네 기준가는 예산과 무관)', async () => {
  // 대부분 치킨은 예산(2만)을 넘고, 한 곳만 예산 안. 닭강정 가게들의 별점이 더 높아도 가격 기준이 같아야 한다
  const stores = [], menus = [];
  const add = (id, rating, items) => {
    stores.push({ id, region: '서초구', dong: '서초4동', category: '치킨', name: id + '집', tip: 3000, rating });
    items.forEach(([name, price], i) => menus.push({ id: `${id}-${i}`, store: id, name, price, desc: '' }));
  };
  add('fit', 4.5, [['후라이드치킨', 13500], ['닭강정(1인)', 9000]]); // 치킨 16,500원 → 1인분 8,250원
  for (let i = 0; i < 6; i++) add('k' + i, 5.0, [['후라이드치킨', 20000], ['닭강정(1인)', 8500]]); // 치킨 23,000원은 예산 밖
  const turn = await textTurn(createEngine({ stores, menus }), null, '서초구 치킨 2만원 이하');
  assert.equal(turn.reply.cards[0].storeId, 'fit', menusOf(turn).join());
  assert.match(turn.reply.cards[0].menu, /후라이드치킨/);
});

test('두 명이서 먹을 만한 메뉴: 업종 없이 인원만 말해도 나눠 먹는 메뉴(2인분 이상)를 업종별로 추천', async () => {
  const stores = [], menus = [];
  const add = (id, category, items) => {
    stores.push({ id, region: '성동구', dong: '성수1가1동', category, name: id + '집', tip: 2000, rating: 4.5 });
    items.forEach(([name, price], i) => menus.push({ id: `${id}-${i}`, store: id, name, price, desc: '' }));
  };
  for (let i = 0; i < 5; i++) {
    add('b' + i, '분식', [['김밥', 3500], ['주먹밥', 2000], ['떡볶이(2~3인)', 11000 + i * 500]]);
    add('c' + i, '치킨', [['후라이드치킨', 17000 + i * 500], ['콜라 1.25L', 2500]]);
    add('j' + i, '족발·보쌈', [['족발(소)', 28000 + i * 500], ['족발(중)', 34000], ['막국수', 7000]]);
    add('k' + i, '한식', [['김치찌개', 8000], ['공기밥', 1000], ['계란말이', 6000]]); // 나눠 먹는 메뉴 없음
    add('d' + i, '카페·디저트', [['케이크(2인)', 20000]]);
  }
  const engine = createEngine({ stores, menus });
  const area = await engine.handle(undefined, { type: 'dong', dong: '성동구' }, noGemini);
  const turn = await engine.handle(area.state, { type: 'text', text: '두명이서 먹을만한 메뉴 추천해줘' }, noGemini);
  assert.equal(turn.reply.cards.length, 3, turn.reply.text);
  const categories = turn.reply.cards.map(c => c.foodLabel);
  assert.equal(new Set(categories).size, 3, categories.join());               // 서로 다른 업종
  assert.ok(categories.every(c => ['분식', '치킨', '족발·보쌈'].includes(c)), categories.join()); // 1인분만 있는 한식·카페 제외
  for (const name of menusOf(turn)) assert.doesNotMatch(name, /김밥|주먹밥|콜라|막국수|공기밥|계란말이/, name);
  // 남는 양은 인원의 약 1.5배까지만 인정: 둘이면 (소)·(중)까지, 혼자면 (소)
  assert.ok(menusOf(turn).some(m => /족발\((소|중)\)×1/.test(m)), menusOf(turn).join());
  const solo = await textTurn(engine, null, '성동구 족발');
  assert.match(menusOf(solo)[0], /족발\(소\)/);
});

test('공기밥은 사이드: 둘이서 찌개를 시키면 공기밥을 한 사람 식사로 세지 않는다', async () => {
  const engine = shopsOf('한식', [
    ['h1', [['된장찌개', 8000], ['공기밥', 1000]]], ['h2', [['김치찌개', 8500], ['공기밥', 1000]]],
    ['h3', [['제육볶음', 9000], ['공기밥', 1000]]], ['h4', [['비빔밥', 9000], ['공기밥', 1000]]], ['h5', [['불고기', 10000], ['공기밥', 1000]]],
  ]);
  const turn = await textTurn(engine, null, '서초구 둘이서 한식');
  for (const name of menusOf(turn)) assert.doesNotMatch(name, /공기밥/, name);
});

test('[C1] 예산 양보안: change.from/to는 총예산과 총예산+2000, 인당 예산은 총액으로 환산', async () => {
  // 예산 모드의 0곳은 "가까운 대안" 화면으로 대체되므로, 같은 양보안이 붙는 "결과 3곳 미만" 화면에서 확인한다
  const stores = [], menus = [];
  for (const [id, price] of [['a', 17000], ['b', 18000], ['c', 18500], ['d', 19000]]) {
    stores.push({ id, region: '서초구', dong: '서초4동', category: '치킨', name: id + '닭', tip: 1000, rating: 4.5 });
    menus.push({ id: id + '-1', store: id, name: '후라이드치킨', price, desc: '' });
  }
  const engine = createEngine({ stores, menus });
  const total = await textTurn(engine, null, '서초구 치킨 18000원 이하'); // a만 예산 안(18,000), +2000이면 b·c·d
  assert.equal(total.reply.cards.length, 1);
  const first = total.reply.buttons.find(b => b.change);
  assert.deepEqual(first.change, { label: '예산', from: '18,000원', to: '20,000원' });
  assert.equal(first.label, '2천 원 더 쓰면 3곳 더');
  const perPerson = await textTurn(engine, null, '서초구 둘이서 치킨 인당 9500원');   // 총 19,000원
  const pp = perPerson.reply.buttons.find(b => b.change);
  assert.deepEqual(pp.change, { label: '예산 2인', from: '19,000원', to: '21,000원' });
});

test('[B2·B4·B5] 0곳 화면: 제목·안내, 양보안 뒤에 "처음부터", 양보안이 없으면 "처음부터"만', async () => {
  const stores = [], menus = [];
  for (const [id, franchise] of [['f1', true], ['f2', true]]) {
    stores.push({ id, region: '서초구', dong: '서초4동', category: '치킨', name: id + '치킨', tip: 1000, rating: 4.5, franchise });
    menus.push({ id: id + '-1', store: id, name: '후라이드치킨', price: 18000, desc: '' });
  }
  const engine = createEngine({ stores, menus });
  const zero = await textTurn(engine, null, '서초구 치킨 프랜차이즈 말고');
  assert.equal(zero.reply.title, '조건에 맞는 가게가 없어요');
  assert.equal(zero.reply.hint, '조건을 조금 바꾸면 이런 가게가 있어요');
  assert.deepEqual(zero.reply.buttons.map(b => b.label), ['프랜차이즈도 괜찮으면 2곳', '처음부터']);
  const none = await textTurn(engine, null, '서초구 피자');
  if (none.reply.zero) assert.deepEqual(none.reply.buttons.map(b => b.label), ['처음부터']);
});

test('[A4·A5·A6·A8] 카드: 충족 조건만 ✓, 이유 한 줄, 리뷰 0개는 새 가게, 다른 데 보기', async () => {
  const stores = [], menus = [];
  for (let i = 0; i < 5; i++) {
    stores.push({ id: 's' + i, region: '서초구', dong: '서초4동', category: '치킨', name: '닭' + i, tip: 1000, rating: i ? 4.6 : null, review_count: i ? 100 : 0, franchise: false });
    menus.push({ id: `s${i}-1`, store: 's' + i, name: '후라이드치킨', price: 15000 + i * 500, desc: '바삭' });
  }
  const engine = createEngine({ stores, menus });
  const turn = await textTurn(engine, null, '서초구 치킨 2만원 이하 프랜차이즈 말고');
  for (const card of turn.reply.cards) {
    assert.deepEqual(card.met, ['예산', '영업중', '프랜차이즈 아님']);
    assert.ok(card.reason, card.name);
  }
  const plain = await textTurn(engine, null, '서초구 치킨');
  assert.ok(plain.reply.cards.every(card => card.met.join() === '영업중')); // 조건을 안 걸면 영업중만
  const fresh = [...turn.reply.cards, ...plain.reply.cards].find(card => card.storeId === 's0');
  if (fresh) assert.equal(fresh.isNew, true);
  assert.ok([...turn.reply.cards, ...plain.reply.cards].filter(card => card.storeId !== 's0').every(card => !card.isNew));
  assert.deepEqual(plain.reply.nextButton, { label: '다른 데 보기', action: { type: 'text', text: '다른 데는?' } });
  const next = await engine.handle(plain.state, plain.reply.nextButton.action, noGemini);
  const before = new Set(cards(plain));
  assert.ok(next.reply.cards.length >= 1 && next.reply.cards.every(card => !before.has(card.storeId)));
});

// ---------- 세부 메뉴 단계 ----------
const chickenTown = () => {
  const stores = [], menus = [];
  const add = (id, items, franchise = false) => {
    stores.push({ id, region: '서초구', dong: '서초4동', category: '치킨', name: id + '치킨', tip: 2000, rating: 4.5, franchise });
    items.forEach(([name, price], i) => menus.push({ id: `${id}-${i}`, store: id, name, price, desc: '' }));
  };
  add('a', [['후라이드치킨', 17000], ['양념치킨', 18000], ['양념소스추가', 500]]);
  add('b', [['후라이드치킨', 16500], ['간장치킨', 18500]]);
  add('c', [['양념치킨', 18500], ['닭강정(1인)', 11000]]);
  add('d', [['후라이드치킨', 18000], ['양념치킨', 19000], ['닭강정(1인)', 11500]]);
  add('e', [['반반치킨', 19000], ['닭강정(1인)', 12000]]);
  add('f', [['간장치킨', 18000]], true); // 유일한 프랜차이즈
  return createEngine({ stores, menus });
};
const raw = (engine, state, action) => engine.handle(state, action, noGemini);

test('[세부 메뉴] 카테고리 [치킨] → 가게 카드가 아니라 세부 메뉴 버튼, 버튼마다 가게 수 1 이상', async () => {
  const engine = chickenTown();
  const area = await raw(engine, undefined, { type: 'dong', dong: '서초구' });
  const turn = await raw(engine, area.state, { type: 'apply', cond: { menu: '치킨' } });
  assert.equal(turn.reply.cards, undefined);
  assert.equal(turn.reply.subMenu, true);
  const subs = turn.reply.buttons.filter(b => b.label !== '상관없어요');
  assert.ok(subs.length >= 2 && subs.length <= 8);
  for (const b of subs) assert.ok(Number(b.label.match(/\((\d+)곳\)/)?.[1]) >= 1, b.label);
  assert.equal(turn.reply.buttons.at(-1).label, '상관없어요');
  // 가게 수가 많은 순 (후라이드 3 · 양념 3 · 닭강정 3 · 간장 2 · 반반 1)
  const counts = subs.map(b => Number(b.label.match(/\((\d+)곳\)/)[1]));
  assert.deepEqual(counts, [...counts].sort((x, y) => y - x));
  // 상단 select와 같은 경로(카테고리 변경)도, 말로 카테고리만 해도 같은 단계
  assert.equal((await raw(engine, undefined, { type: 'text', text: '서초구 치킨 먹고 싶어' })).reply.subMenu, true);
  // 좁히기 질문 횟수에 넣지 않는다
  assert.equal(turn.state.questions, 0);
});

test('[세부 메뉴] [양념] → 카드 대표 메뉴가 모두 양념, 칩 표시, 바꾸기·지우기', async () => {
  const engine = chickenTown();
  const area = await raw(engine, undefined, { type: 'dong', dong: '서초구' });
  const step = await raw(engine, area.state, { type: 'apply', cond: { menu: '치킨' } });
  const yangnyeom = step.reply.buttons.find(b => b.label.startsWith('양념'));
  const turn = await raw(engine, step.state, yangnyeom.action);
  assert.equal(turn.reply.cards.length, 3);
  for (const c of turn.reply.cards) assert.match(c.menu, /양념/, c.menu);
  assert.ok(turn.reply.cards.every(c => !/소스추가/.test(c.menu)));
  const chip = turn.reply.chips.find(c => c.kind === 'sub');
  assert.equal(chip.label, '양념');
  assert.equal((await raw(engine, turn.state, chip.change)).reply.subMenu, true);       // 눌러서 다시 고르기
  assert.ok((await raw(engine, turn.state, chip.remove)).reply.cards.length >= 1);        // ×는 상관없어요
  // "처음부터"·카테고리 변경 시 초기화
  assert.equal((await raw(engine, turn.state, { type: 'text', text: '처음부터' })).state.cond.sub, null);
  assert.equal((await raw(engine, turn.state, { type: 'apply', cond: { menu: '피자' } })).state.cond.sub, null);
});

test('[세부 메뉴] [닭강정] → 카드 대표 메뉴가 모두 닭강정', async () => {
  const engine = chickenTown();
  const area = await raw(engine, undefined, { type: 'dong', dong: '서초구' });
  const step = await raw(engine, area.state, { type: 'apply', cond: { menu: '치킨' } });
  const turn = await raw(engine, step.state, step.reply.buttons.find(b => b.label.startsWith('닭강정')).action);
  assert.ok(turn.reply.cards.length >= 1);
  for (const c of turn.reply.cards) assert.match(c.menu, /닭강정/, c.menu);
  assert.ok(!turn.reply.buttons.some(b => b.label === '닭강정 빼고 보기'));
});

test('[세부 메뉴] [상관없어요] → 기존 카테고리 추천과 같은 흐름', async () => {
  const engine = chickenTown();
  const area = await raw(engine, undefined, { type: 'dong', dong: '서초구' });
  const step = await raw(engine, area.state, { type: 'apply', cond: { menu: '치킨' } });
  const any = await raw(engine, step.state, step.reply.buttons.at(-1).action);
  assert.equal(any.state.cond.sub, '');
  assert.equal(any.reply.cards.length, 3);
  assert.ok(!any.reply.chips.some(c => c.kind === 'sub'));
  // 같은 대화에서 다른 조건을 더해도 세부 메뉴를 다시 묻지 않는다
  const more = await raw(engine, any.state, { type: 'text', text: '2만원 이하' });
  assert.ok(!more.reply.subMenu && more.reply.cards?.length >= 1);
});

test('[세부 메뉴] 세부 메뉴를 말하면 단계 없이 바로 추천, 0곳이면 "\'반반\' → 상관없음" 양보안', async () => {
  const engine = chickenTown();
  const direct = await raw(engine, undefined, { type: 'text', text: '서초구 양념치킨 먹고 싶어' });
  assert.ok(!direct.reply.subMenu);
  assert.ok(direct.reply.cards.every(c => /양념/.test(c.menu)));
  const area = await raw(engine, undefined, { type: 'dong', dong: '서초구' });
  const step = await raw(engine, area.state, { type: 'apply', cond: { menu: '치킨' } });
  const banban = await raw(engine, step.state, step.reply.buttons.find(b => b.label.startsWith('반반')).action);
  const none = await raw(engine, banban.state, { type: 'text', text: '프랜차이즈만' }); // 반반 파는 e는 프랜차이즈가 아님 → 0곳, 반반을 풀면 f(간장) 1곳
  assert.equal(none.reply.zero, true);
  const back = none.reply.buttons.find(b => b.change?.from === "'반반'");
  assert.ok(back, JSON.stringify(none.reply.buttons));
  assert.deepEqual(back.change, { label: '', from: "'반반'", to: '상관없음' });
});

// ---------- 대화형 흐름 (guided): 현재 위치 → 첫 질문 → 카테고리 → 예산 → 추천 ----------
import { DEMO_HOME, homeOf, homeFromAddress } from '../dist/home.js';

const hwayang = () => {
  const stores = [], menus = [];
  const add = (id, category, name, price) => {
    stores.push({ id, region: '광진구', dong: '화양동', category, name: id + '집', tip: 2000, rating: 4.5, franchise: false });
    menus.push({ id: id + '-1', store: id, name, price, desc: '' });
  };
  for (let i = 0; i < 5; i++) add('c' + i, '치킨', '후라이드치킨', 15000 + i * 1000);
  for (let i = 0; i < 3; i++) add('k' + i, '한식', '김치찌개', 9000 + i * 500);
  for (let i = 0; i < 2; i++) add('b' + i, '분식', '떡볶이', 8000);
  return createEngine({ stores, menus }, { zone: { 화양동: { 화양동: 0 } }, guided: true });
};
const homeTurn = engine => engine.handle(undefined, { type: 'dong', ...homeOf([]) }, noGemini);

test('[대화형] 현재 위치 = 등록 주소, 없으면 광진구 화양동 — 동 선택 질문 없이 바로 설정', async () => {
  assert.deepEqual(DEMO_HOME, { dong: '광진구', neighborhood: '화양동' });
  assert.deepEqual(homeOf([], { getItem: () => null }), DEMO_HOME);
  const list = [{ dong: '화양동', gu: '광진구' }, { dong: '상암동', gu: '마포구' }];
  assert.deepEqual(homeFromAddress('서울 마포구 상암동 방송사 근처', list), { dong: '마포구', neighborhood: '상암동' });
  const turn = await homeTurn(hwayang());
  assert.equal(turn.state.dong, '광진구');
  assert.equal(turn.state.neighborhood, '화양동');
  assert.doesNotMatch(turn.reply.text, /중 어디에서/);
  assert.equal(turn.reply.chips[0].label, '광진구 화양동');
});

test('[대화형] 동네 결정 직후: 음식 버튼 없이 "뭐가 먹고 싶어요" 질문만', async () => {
  const turn = await homeTurn(hwayang());
  assert.match(turn.reply.text, /뭐가 먹고 싶어요/);
  assert.ok(!turn.reply.buttons?.length);
  assert.equal(turn.state.step, 'askFood');
  assert.equal(turn.reply.placeholder, '예: 둘이서 매콤한 거 먹고 싶어');
});

test('[대화형] "남성 둘이서 먹을 만한 음식을 추천해줘" → 카테고리 버튼, 인원 2, 성별은 조건에 없음', async () => {
  const engine = hwayang();
  const turn = await engine.handle((await homeTurn(engine)).state, { type: 'text', text: '남성 둘이서 먹을 만한 음식을 추천해줘' }, noGemini);
  assert.equal(turn.reply.cards, undefined);
  assert.match(turn.reply.text, /둘이서 드실 거군요! 혹시 이 중에 지금 땡기는 음식이 있나요\?/);
  assert.deepEqual(turn.reply.buttons.map(b => b.label), ['치킨', '한식', '분식', '아무거나 괜찮아요']); // 가게 많은 순
  assert.equal(turn.state.cond.people, 2);
  assert.doesNotMatch(JSON.stringify(turn.state.cond), /남성|남자/);
  assert.equal(turn.state.step, 'pickCategory');
  assert.equal(turn.state.questions, 0);
});

test('[대화형] 카테고리 [치킨] → 예산 질문, "3만 원" → 예산 모드 총 30,000원으로 추천', async () => {
  const engine = hwayang();
  const ask = await engine.handle((await homeTurn(engine)).state, { type: 'text', text: '둘이서 먹을 거 추천해줘' }, noGemini);
  const budget = await engine.handle(ask.state, ask.reply.buttons.find(b => b.label === '치킨').action, noGemini);
  assert.equal(budget.reply.cards, undefined);
  assert.match(budget.reply.text, /좋아요, 치킨으로 찾아볼게요! 예산은 얼마 정도로 생각하고 있나요\?/);
  assert.deepEqual(budget.reply.buttons.map(b => b.label), ['2인 2만 원', '2인 3만 원', '2인 4만 원', '정하지 않을래요']);
  assert.equal(budget.reply.placeholder, '예: 인당 1만 5천 원, 총 3만 원');
  assert.equal(budget.state.step, 'askBudget');
  const result = await engine.handle(budget.state, { type: 'text', text: '3만 원' }, noGemini);
  assert.ok(result.reply.cards.length >= 1);
  assert.equal(result.state.cond.budget, 30000);
  assert.equal(result.state.cond.budget_unit, 'total');
  assert.equal(result.state.step, 'search');
  const labels = result.reply.chips.map(c => c.label);
  for (const want of ['2인', '치킨', '총 30,000원 이하']) assert.ok(labels.includes(want), labels.join());
});

test('[대화형] [정하지 않을래요] → 가성비 모드로 추천, 금액을 못 읽으면 한 번만 다시 묻는다', async () => {
  const engine = hwayang();
  const ask = await engine.handle((await homeTurn(engine)).state, { type: 'text', text: '치킨 먹고 싶어' }, noGemini);
  assert.equal(ask.state.step, 'askBudget');
  const skip = await engine.handle(ask.state, ask.reply.buttons.at(-1).action, noGemini);
  assert.ok(skip.reply.cards.length >= 1);
  assert.equal(skip.state.cond.budget, null);
  assert.ok(skip.reply.chips.some(c => c.label === '가성비 우선'));
  const retry = await engine.handle(ask.state, { type: 'text', text: '음 글쎄' }, noGemini);
  assert.equal(retry.reply.text, '금액으로 알려 주세요. 예: 2만 원');
  const giveUp = await engine.handle(retry.state, { type: 'text', text: '음 글쎄' }, noGemini);
  assert.ok(giveUp.reply.cards.length >= 1); // 그래도 못 읽으면 예산 없이
});

test('[대화형] "치킨 둘이서 3만 원" 한 문장 → 질문 없이 바로 추천', async () => {
  const engine = hwayang();
  const turn = await engine.handle((await homeTurn(engine)).state, { type: 'text', text: '치킨 둘이서 3만 원' }, noGemini);
  assert.ok(turn.reply.cards.length >= 1);
  assert.equal(turn.state.cond.budget, 30000);
  assert.equal(turn.state.cond.people, 2);
});

test('[대화형] [아무거나 괜찮아요] → 예산 질문 → 기존 규칙(2인 이상)대로 업종 섞어 추천, "처음부터"도 질문만', async () => {
  const engine = hwayang();
  const ask = await engine.handle((await homeTurn(engine)).state, { type: 'text', text: '둘이서 먹을 거 추천해줘' }, noGemini);
  const budget = await engine.handle(ask.state, ask.reply.buttons.at(-1).action, noGemini);
  assert.equal(budget.state.step, 'askBudget');
  const turn = await engine.handle(budget.state, { type: 'text', text: '3만 원' }, noGemini);
  assert.equal(turn.state.cond.menu, null);
  assert.equal(turn.state.cond.anyMenu, true);
  const restart = await engine.handle(turn.state, { type: 'text', text: '처음부터' }, noGemini);
  assert.match(restart.reply.text, /뭐가 먹고 싶어요/);
  assert.ok(!restart.reply.buttons?.length);
});

// ---------- 맥락 조건: 먹은 것·피할 것·끼니·계절·배달팁 (규칙 모드·AI 모드 모두) ----------
import { SEASON_HINTS } from '../lib/engine.js';

const contextTown = () => {
  const stores = [], menus = [];
  const add = (id, category, name, desc, tip = 0, region = '서초구', dong = '서초4동') => {
    stores.push({ id, region, dong, category, name: id + '가게', tip, rating: 4.5, franchise: false });
    menus.push({ id: id + '-1', store: id, name, price: 9000, desc });
  };
  add('gukbap', '한식', '순대국밥', '든든한 한 그릇');
  add('jjigae', '한식', '김치찌개', '얼큰한 찌개');
  add('dosirak', '도시락·죽', '불고기 도시락', '');
  add('juk', '도시락·죽', '전복죽', '따뜻한 죽');
  add('jjamppong', '중식', '짬뽕', '얼큰한 국물');
  add('pho', '아시안', '쌀국수', '진한 육수');
  add('kimbap', '분식', '참치김밥', '고소한 김밥');
  add('salad', '양식', '시저샐러드', '상큼한 샐러드');
  add('burger', '패스트푸드', '치즈버거', '두툼한 패티');
  add('tipJjamppong', '중식', '해물짬뽕', '얼큰한 국물', 3000); // 배달팁 있음
  add('spicyTteok', '분식', '매운 떡볶이', '매운 떡볶이');
  add('spicyChicken', '치킨', '매운 양념치킨', '매운 양념');
  add('spicyPizza', '피자', '매운 페퍼로니 피자', '매운 피자');
  add('coldNoodle', '한식', '물냉면', '시원한 냉면', 1500);
  add('gangnamChicken', '치킨', '후라이드치킨', '바삭', 2000, '강남구', '역삼동'); // 강남구: 배달팁 0원 가게 없음
  return { engine: createEngine({ stores, menus }), tipOf: new Map(stores.map(s => [s.id, s.tip])), categoryOf: new Map(stores.map(s => [s.id, s.category])) };
};
// AI 모드: 가짜 provider가 돌려주는 조건 (모든 키 required)
const aiCond = over => ({ menu: null, dish: null, people: null, budget: null, budget_unit: 'total', price_pref: null, taste: [], franchise: 'none',
  eaten: [], avoid: [], meal_time: null, season: null, delivery_tip_max: null, ...over });
const fakeAI = parsed => ({ parse: async () => parsed, question: async () => { throw Error('LLM unavailable'); }, judge: async () => { throw Error('LLM unavailable'); } });
const modes = parsed => [['규칙 모드', noGemini], ['AI 모드', fakeAI(aiCond(parsed))]];
const DEMO = '아침에는 국밥을 먹었고, 점심은 도시락을 먹었는데 저녁 추천 좀 해봐 겨울 날씨에 맞춰서 배달팁 안 내는 곳으로';
const inSeocho = async (engine, text, ai) => engine.handle((await engine.handle(undefined, { type: 'dong', dong: '서초구' }, noGemini)).state, { type: 'text', text }, ai);

test('[맥락 1] 먹은 것·저녁·겨울·배달팁 무료 → 국밥 제외, 도시락·죽은 상위 X, 국물 근거 메뉴가 위, 모두 배달팁 0원', async () => {
  // AI가 먹은 "국밥"을 원하는 음식으로 잘못 내도 버린다
  for (const [mode, ai] of modes({ menu: '한식', dish: '국밥', eaten: [{ meal: 'breakfast', menu: '한식', dish: '국밥' }, { meal: 'lunch', menu: '도시락·죽', dish: '도시락' }], meal_time: 'dinner', season: 'winter', delivery_tip_max: 0 })) {
    const { engine, tipOf, categoryOf } = contextTown();
    const turn = await inSeocho(engine, DEMO, ai);
    const c = turn.state.cond;
    assert.deepEqual(c.eaten, [{ meal: 'breakfast', menu: '한식', dish: '국밥' }, { meal: 'lunch', menu: '도시락·죽', dish: '도시락' }], mode);
    assert.deepEqual([c.meal_time, c.season, c.delivery_tip_max, c.menu, c.dish], ['dinner', 'winter', 0, null, null], mode);
    const cards = turn.reply.cards;
    assert.ok(cards.length >= 3, mode);
    assert.ok(cards.every(card => tipOf.get(card.storeId) === 0), mode);
    assert.ok(cards.every(card => !/국밥/.test(card.menu)), mode);
    assert.ok(cards.every(card => categoryOf.get(card.storeId) !== '도시락·죽'), mode);
    // 국물·따뜻한 근거가 있는 메뉴가 근거 없는 메뉴보다 위
    const evidence = cards.map(card => SEASON_HINTS.winter.boost.test(card.menu));
    const firstWithout = evidence.indexOf(false);
    assert.ok(evidence[0] && (firstWithout === -1 || evidence.lastIndexOf(true) < firstWithout), `${mode}: ${cards.map(x => x.menu)}`);
    assert.match(turn.reply.text, /아침 국밥·점심 도시락과 겹치지 않게, 겨울에 어울리는 따뜻한 메뉴 위주로, 배달팁 없는 가게만 골랐어요/, mode);
    for (const want of ['저녁', '겨울', '배달팁 무료', '제외: 국밥']) assert.ok(turn.reply.chips.some(x => x.label === want), `${mode}: ${want}`);
  }
});

test('[맥락 2] "국밥 먹고 싶어" → 원하는 음식, 먹은 것으로 오인하지 않음', async () => {
  for (const [mode, ai] of modes({ menu: '한식', dish: '국밥' })) {
    const turn = await inSeocho(contextTown().engine, '국밥 먹고 싶어', ai);
    assert.equal(turn.state.cond.dish, '국밥', mode);
    assert.deepEqual(turn.state.cond.eaten, [], mode);
  }
});

test('[맥락 3] "아침에 국밥 먹었는데 또 국밥 땡겨" → dish 국밥, 국밥을 제외하지 않음', async () => {
  for (const [mode, ai] of modes({ menu: '한식', dish: '국밥', eaten: [{ meal: 'breakfast', menu: '한식', dish: '국밥' }] })) {
    const turn = await inSeocho(contextTown().engine, '아침에 국밥 먹었는데 또 국밥 땡겨', ai);
    assert.equal(turn.state.cond.dish, '국밥', mode);
    assert.ok(turn.reply.cards.some(card => /국밥/.test(card.menu)), mode);
  }
});

test('[맥락 4] "점심에 치킨 먹었어. 저녁은 매운 걸로, 피자는 싫어" → 치킨 감점, 피자 제외, 매운', async () => {
  for (const [mode, ai] of modes({ eaten: [{ meal: 'lunch', menu: '치킨', dish: null }], avoid: [{ menu: '피자', dish: null }], meal_time: 'dinner', taste: ['매운'] })) {
    const { engine, categoryOf } = contextTown();
    const turn = await inSeocho(engine, '점심에 치킨 먹었어. 저녁은 매운 걸로, 피자는 싫어', ai);
    const c = turn.state.cond;
    assert.deepEqual(c.eaten, [{ meal: 'lunch', menu: '치킨', dish: null }], mode);
    assert.deepEqual(c.avoid, [{ menu: '피자', dish: null }], mode);
    assert.ok(c.taste.includes('매운'), mode);
    const categories = turn.reply.cards.map(card => categoryOf.get(card.storeId));
    assert.ok(!categories.includes('피자'), `${mode}: ${categories}`);
    assert.notEqual(categories[0], '치킨', `${mode}: ${categories}`);
  }
});

test('[맥락 5] "더우니까 시원한 거, 배달비 2천원 이하로" → 여름, 배달팁 2,000원 이하 (예산으로 읽지 않음)', async () => {
  for (const [mode, ai] of modes({ season: 'summer', delivery_tip_max: 2000 })) {
    const { engine, tipOf } = contextTown();
    const turn = await inSeocho(engine, '더우니까 시원한 거, 배달비 2천원 이하로', ai);
    assert.equal(turn.state.cond.season, 'summer', mode);
    assert.equal(turn.state.cond.delivery_tip_max, 2000, mode);
    assert.equal(turn.state.cond.budget, null, mode);
    assert.ok(turn.reply.cards.every(card => tipOf.get(card.storeId) <= 2000), mode);
  }
});

test('[맥락 6] 결과 뒤 "배달팁 무료인 곳으로" → delivery_tip_max만 0, 나머지 조건 유지', async () => {
  const { engine } = contextTown();
  const first = await inSeocho(engine, '더우니까 시원한 거, 배달비 2천원 이하로', noGemini);
  const next = await engine.handle(first.state, { type: 'text', text: '배달팁 무료인 곳으로' }, noGemini);
  assert.equal(next.state.cond.delivery_tip_max, 0);
  assert.deepEqual({ ...next.state.cond, delivery_tip_max: 2000 }, first.state.cond);
});

test('[맥락 7] 배달팁 0원 가게가 없는 지역 → 0곳 안내 + "배달팁 조건 풀기" 대안', async () => {
  const { engine } = contextTown();
  const turn = await engine.handle(undefined, { type: 'text', text: '강남구 저녁 추천해줘 배달팁 없는 곳으로' }, noGemini);
  assert.equal(turn.reply.zero, true);
  const loosen = turn.reply.buttons.find(b => /배달팁 조건 풀면/.test(b.label));
  assert.ok(loosen, JSON.stringify(turn.reply.buttons.map(b => b.label)));
  assert.deepEqual(loosen.change, { label: '배달팁', from: '무료만', to: '상관없음' });
  const after = await engine.handle(turn.state, loosen.action, noGemini);
  assert.ok(after.reply.cards.length >= 1);
});

test('[맥락] 대화형: 음식 없이 맥락만 말하면 카테고리는 건너뛰고 예산만 묻는다', async () => {
  const engine = hwayang();
  const turn = await engine.handle((await homeTurn(engine)).state, { type: 'text', text: '아침에 국밥 먹었는데 저녁 추천해줘, 배달팁 없는 곳으로' }, noGemini);
  assert.equal(turn.state.step, 'askBudget');
  assert.match(turn.reply.text, /좋아요, 저녁 메뉴로 골라 볼게요! 예산은 얼마 정도로 생각하고 있나요\?/);
});
