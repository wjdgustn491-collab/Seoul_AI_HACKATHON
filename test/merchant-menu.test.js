import assert from 'node:assert/strict';
import { test } from 'node:test';
import menuDescription from '../api/menu-description.js';
import recommend from '../api/recommend.js';
import { estimateMenuHeat, heatLevels, mentionsHeat, readRecordedTaste, readTasteProfile, tasteKinds } from '../dist/menu-interview.js';

async function post(handler, body) {
  const res = {
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; },
  };
  await handler({ method: 'POST', body }, res);
  return { status: res.statusCode, data: res.payload };
}

const draftInput = {
  name: '마늘간장 치킨', price: 18000, taste: '맵지 않은 간장 맛', servings: 3,
  portion: '닭다리살 350g', features: '순살', notes: '겉바속촉으로 튀깁니다',
};

function setGeminiKey(t, key) {
  const oldKey = process.env.GEMINI_API_KEY;
  if (key === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = key;
  t.after(() => {
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = oldKey;
  });
}

test('plans menu-specific questions from name and price even when Gemini is unavailable', async t => {
  setGeminiKey(t, undefined);
  const chicken = await post(menuDescription, { action: 'questions', name: '닭다리 치킨', price: 18000 });
  assert.equal(chicken.status, 200);
  assert.equal(chicken.data.provider, 'rules');
  assert.deepEqual(Object.keys(chicken.data.questions), ['portion', 'composition', 'taste', 'features']);
  assert.match(chicken.data.questions.portion, /닭다리.*몇 g/);
  assert.match(chicken.data.questions.taste, /소스|양념/);

  const lunchbox = await post(menuDescription, { action: 'questions', name: '치킨 도시락', price: 10500, category: '치킨' });
  assert.match(lunchbox.data.questions.portion, /도시락.*몇 인분/);
  assert.match(lunchbox.data.questions.composition, /메인 반찬/);
  assert.equal((await post(menuDescription, { action: 'questions', name: '치킨' })).status, 400);
});

test('uses one Gemini request to prepare all interview questions and rejects a compound prompt', async t => {
  setGeminiKey(t, 'test-key');
  const input = { name: '간장 닭다리 치킨', price: 18000, category: '치킨' };
  let plan = {
    portion: '닭다리는 한 주문에 몇 g 들어가나요?',
    composition: '기본으로 함께 제공하는 것은 무엇인가요?',
    taste: '간장 양념에는 어떤 맛이 나나요?',
    features: '치킨의 식감은 어떤가요?',
  };
  const fetch = t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(new URL(url).hostname, 'generativelanguage.googleapis.com');
    const body = JSON.parse(init.body);
    assert.deepEqual(JSON.parse(body.contents[0].parts[0].text), input);
    assert.deepEqual(body.generationConfig.responseJsonSchema.required, Object.keys(plan));
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(plan) }] } }] });
  });
  assert.deepEqual(await post(menuDescription, { action: 'questions', ...input }), {
    status: 200, data: { questions: plan, provider: 'gemini' },
  });
  assert.equal(fetch.mock.callCount(), 1);
  plan = { ...plan, taste: '맵나요? 무슨 소스를 쓰나요?' };
  const fallback = await post(menuDescription, { action: 'questions', ...input });
  assert.equal(fallback.data.provider, 'rules');
  assert.match(fallback.data.questions.taste, /소스나 양념/);
});

test('interview answers produce editable details, an explicit serving count and a draft', async t => {
  setGeminiKey(t, undefined);
  const menu = { name: '제육 도시락', price: 12500 };
  const answers = { portion: '2인분 300g', composition: '제육볶음, 밥과 계란말이', taste: '매콤한 고추장 양념', features: '' };
  const result = await post(menuDescription, { ...menu, answers });
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.details, {
    portion: answers.portion, servings: 2, notes: answers.composition, taste: answers.taste, features: '',
  });
  assert.match(result.data.description, /제육 도시락.*매콤한 고추장 양념.*2인분 300g.*제육볶음, 밥과 계란말이/);
  assert.equal(result.data.description.match(/2인분/g).length, 1);
  const weightOnly = await post(menuDescription, { ...menu, answers: { portion: '300g' } });
  assert.equal(weightOnly.data.details.servings, null);
  assert.equal((await post(menuDescription, { ...menu, answers: {} })).status, 400);
});

test('menu drafts use the seller input with Gemini and fall back on unsupported numbers or missing credentials', async t => {
  setGeminiKey(t, 'test-key');
  let calls = 0;
  let output = '맵지 않은 간장 맛을 입힌 순살 치킨으로, 3인분을 제공합니다.';
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls++;
    assert.equal(new URL(url).hostname, 'generativelanguage.googleapis.com');
    const body = JSON.parse(init.body);
    assert.deepEqual(JSON.parse(body.contents[0].parts[0].text), draftInput);
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ description: output }) }] } }] });
  });

  const generated = await post(menuDescription, draftInput);
  assert.deepEqual(generated, { status: 200, data: { description: output, provider: 'gemini' } });
  output = '12인분입니다.';
  const fallback = await post(menuDescription, draftInput);
  assert.equal(fallback.data.provider, 'rules');
  assert.match(fallback.data.description, /맵지 않은 간장 맛.*3인분.*350g.*순살.*겉바속촉/);
  assert.doesNotMatch(fallback.data.description, /12인분/);

  delete process.env.GEMINI_API_KEY;
  assert.deepEqual(await post(menuDescription, draftInput), fallback);
  assert.equal((await post(menuDescription, { ...draftInput, servings: 21 })).status, 400);
  assert.equal(calls, 2);
});

const shortDraft = {
  action: 'short-draft', name: '마라로제엽떡', price: 15000,
  answers: { portion: { grams: 320, servings: 2 }, composition: '밀떡, 어묵, 마라소스', taste: '크리미한 로제', heat: 3 },
};

test('short drafts store numbers, confirmed heat, and the approved draft text together', async t => {
  setGeminiKey(t, undefined);
  const result = await post(menuDescription, shortDraft);
  assert.equal(result.status, 200);
  assert.equal(result.data.provider, 'rules');
  assert.equal(result.data.description, '320g / 2인분 · 밀떡, 어묵, 마라소스 · 크리미한 로제 · 맵기 3/5 · 쫄깃한 떡');
  assert.equal(result.data.suggestion.text, result.data.details.features);
  assert.equal(new URL(result.data.suggestion.url).hostname, 'github.com');
  assert.deepEqual(readRecordedTaste(result.data.details.taste), { taste: '크리미한 로제', heat: 3 });
  assert.equal(result.data.details.servings, 2);
  assert.equal(result.data.details.notes, shortDraft.answers.composition);

  const draftWith = answers => post(menuDescription, { ...shortDraft, answers: { ...shortDraft.answers, ...answers } });
  for (const answers of [
    { portion: {} }, { portion: { grams: '320' } }, { portion: { grams: 0, servings: 2 } },
    { portion: { servings: 21 } }, { heat: 6 }, { taste: '맛'.repeat(25) }, { composition: '' },
  ]) assert.equal((await draftWith(answers)).status, 400);

  const entered = await draftWith({ portion: { servings: 1 }, taste: '순한 로제', heat: null, features: '통밀떡' });
  assert.equal(entered.data.description, '1인분 · 밀떡, 어묵, 마라소스 · 순한 로제 · 통밀떡');
  assert.equal(entered.data.suggestion, undefined);
  const incompatible = await post(menuDescription, { ...shortDraft, name: '오븐치킨', answers: { ...shortDraft.answers, heat: null } });
  assert.equal(incompatible.data.suggestion, undefined);
});

test('Gemini selects only referenced features and can omit incompatible suggestions', async t => {
  setGeminiKey(t, 'test-key');
  let choice = 2;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(new URL(url).hostname, 'generativelanguage.googleapis.com');
    const body = JSON.parse(init.body);
    const payload = JSON.parse(body.contents[0].parts[0].text);
    assert.deepEqual(payload.options, ['쫄깃한 떡', '걸쭉한 소스']);
    assert.equal(payload.taste, shortDraft.answers.taste);
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ choice }) }] } }] });
  });
  const result = await post(menuDescription, shortDraft);
  assert.equal(result.data.provider, 'gemini');
  assert.equal(result.data.suggestion.text, '걸쭉한 소스');
  choice = 0;
  assert.equal((await post(menuDescription, shortDraft)).data.suggestion, undefined);
  choice = 12;
  const fallback = await post(menuDescription, shortDraft);
  assert.equal(fallback.data.provider, 'rules');
  assert.equal(fallback.data.details.features, '쫄깃한 떡');
});

test('heat only estimates from valid quantities and offers recognizable anchors', () => {
  assert.equal(mentionsHeat('마라로제엽떡'), true);
  assert.equal(mentionsHeat('맵지 않은 간장 소스'), false);
  assert.equal(mentionsHeat('고춧가루 없이 간장'), false);
  assert.deepEqual(heatLevels.map(({ number }) => number), [1, 2, 3, 4, 5]);
  assert.equal(estimateMenuHeat(12000, 90, 320).example, '신라면');
  assert.equal(estimateMenuHeat(4404, 25, 25).number, 4);
  assert.equal(estimateMenuHeat(10000, 40, 40).number, 5);
  assert.equal(estimateMenuHeat(10000, 41, 40), null);
  assert.equal(estimateMenuHeat(0, 20, 300), null);
  assert.equal(estimateMenuHeat(NaN, 20, 300), null);
});

const detailedDraft = {
  action: 'interview-draft', name: '자몽허니블랙티', price: 5200,
  answers: {
    portion: { grams: 350, servings: 1 }, composition: ['자몽', '꿀', '홍차'],
    ratings: { sweet: 4, sour: 2 },
  },
};

test('taste suggestions use menu and composition cues without assigning strengths', async t => {
  setGeminiKey(t, undefined);
  const suggest = (name, composition) => post(menuDescription, { action: 'taste-suggestions', name, composition });
  assert.deepEqual((await suggest('자몽허니블랙티', ['홍차'])).data.suggestions, ['sweet', 'sour']);
  assert.deepEqual((await suggest('불막창', ['막창'])).data.suggestions, ['spicy']);
  assert.deepEqual((await suggest('오늘의 메뉴', ['두부', '참깨', '간장'])).data.suggestions, ['nutty', 'salty']);
  assert.deepEqual((await suggest('안 매운 불막창', ['막창'])).data.suggestions, []);
  assert.equal((await suggest('차', '꿀과 자몽')).status, 400);

  process.env.GEMINI_API_KEY = 'test-key';
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(new URL(url).hostname, 'generativelanguage.googleapis.com');
    const input = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text);
    assert.deepEqual(input, { name: '오늘의 차', composition: ['찻잎'] });
    return Response.json({ candidates: [{ content: { parts: [{ text: '{"suggestions":["bitter"]}' }] } }] });
  });
  assert.deepEqual((await suggest('오늘의 차', ['찻잎'])).data, { suggestions: ['bitter'], provider: 'gemini' });
});

test('detailed interview drafts keep ingredient rows and confirmed taste ratings in the existing storage fields', async t => {
  setGeminiKey(t, undefined);
  const draftWith = answers => post(menuDescription, { ...detailedDraft, answers: { ...detailedDraft.answers, ...answers } });
  const result = await draftWith({});
  assert.equal(result.status, 200);
  assert.equal(result.data.details.portion, '350g / 1인분');
  assert.equal(result.data.details.notes, '자몽, 꿀, 홍차');
  assert.deepEqual(readTasteProfile(result.data.details.taste), { note: '', ratings: { sweet: 4, sour: 2 } });
  assert.deepEqual(readTasteProfile('크리미한 로제 · 맵기 3/5'), { note: '크리미한 로제', ratings: { spicy: 3 } });
  assert.match(result.data.description, /350g, 1인분입니다\. 기본 구성은 자몽, 꿀, 홍차입니다\. 뚜렷한 단맛과 은은한 신맛/);
  assert.doesNotMatch(result.data.description, /쓴맛|매운맛/);

  const full = await draftWith({
    composition: Array.from({ length: 8 }, (_, index) => (index + 1) + '가'.repeat(27)),
    ratings: Object.fromEntries(tasteKinds.map(({ key }) => [key, 1])),
    features: '살짝 말린 재료를 씁니다',
  });
  assert.equal(full.status, 200);
  assert.ok(full.data.description.length <= 240);
  assert.ok(full.data.details.notes.length <= 240);
  assert.ok(full.data.details.taste.length <= 60);
  assert.match(full.data.description, /살짝 말린 재료를 씁니다\.$/);
  for (const answers of [
    { composition: [] }, { composition: ['가'.repeat(29)] }, { composition: Array(9).fill('자몽') },
    { ratings: { sour: 0 } }, { ratings: { sour: '2' } }, { ratings: { unknown: 2 } }, { ratings: {} },
  ]) assert.equal((await draftWith(answers)).status, 400);
});

test('Gemini writes detailed prose from confirmed facts and keeps an optional recipe phrase removable', async t => {
  setGeminiKey(t, 'test-key');
  const payload = {
    ...detailedDraft, name: '마라로제엽떡',
    answers: {
      portion: { servings: 2 }, composition: ['밀떡', '로제 소스'], ratings: { spicy: 4 }, tasteNote: '크리미한 로제',
    },
  };
  let description = '밀떡과 로제 소스를 담은 2인분 메뉴예요. 크리미한 로제에 뚜렷한 매운맛을 느낄 수 있어요.';
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(new URL(url).hostname, 'generativelanguage.googleapis.com');
    const payload = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text);
    assert.deepEqual(payload.tastes, [{ label: '매운맛', level: 4, strength: '뚜렷한' }]);
    assert.deepEqual(payload.featureOptions, ['쫄깃한 떡', '걸쭉한 소스']);
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ description, choice: 2 }) }] } }] });
  });
  const result = await post(menuDescription, payload);
  assert.equal(result.data.provider, 'gemini');
  assert.equal(result.data.details.taste, '크리미한 로제 · 맵기 4/5');
  assert.equal(result.data.suggestion.text, '걸쭉한 소스');
  assert.equal(result.data.description, description + ' ' + result.data.suggestion.sentence);
  description = description.replace('뚜렷한 매운맛', '은은한 매운맛');
  const fallback = await post(menuDescription, payload);
  assert.equal(fallback.data.provider, 'rules');
  assert.match(fallback.data.description, /뚜렷한 매운맛/);
});

test('recommendations apply saved menu details, prices and removals only to the matching browser', async t => {
  const shop = { id: 'merchant', name: '동네부엌', region: '서초구', dong: '서초4동', category: '치킨', tip: 1000, rating: 4.5 };
  const original = { id: 'original', store: shop.id, name: '뼈 후라이드치킨', price: 19000, desc: '', main: true };
  const approved = {
    id: 'new', store: shop.id, name: '오늘의 한 접시', price: 18000, desc: '겉바속촉으로 튀긴 한 접시예요.', available: true, removed: false,
    details: { taste: '맵지 않은 간장 맛', servings: 3, features: '순살' },
  };
  const merchantBrowser = '10000000-0000-4000-8000-000000000001';
  const guestBrowser = '10000000-0000-4000-8000-000000000002';
  let edits = [approved, { ...approved, id: 'salad', name: '치킨 샐러드', price: 3000 }];
  let baseReads = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/seoul_recommendation_snapshot')) {
      baseReads++;
      return Response.json({ stores: [shop], menus: [original] });
    }
    assert.ok(path.endsWith('/seoul_delivery_demo'));
    const { action, browser_key: browserKey } = JSON.parse(init.body);
    assert.equal(action, 'recommendation_menu_changes');
    return Response.json(browserKey === merchantBrowser ? edits : []);
  });

  const search = (browserKey, text) => post(recommend, { browserKey, action: { type: 'text', text } });
  const request = '서초구에서 셋이 2만 원 이하로 바삭하고 안 매운 순살 치킨 추천해줘';
  const first = await search(merchantBrowser, request);
  assert.equal(first.status, 200);
  const [card] = first.data.reply.cards;
  assert.equal(card.menuId, approved.id);
  assert.equal(card.qty, 1);
  assert.equal(card.total, 19000);
  assert.equal(card.portionNote, '3인분 표기 기준');
  assert.equal(card.quote, approved.desc);
  assert.ok(card.checks.includes('바삭'));
  assert.ok(card.checks.includes('순살'));
  assert.equal(first.data.reply.cards.length, 1);

  const other = await search(guestBrowser, request);
  assert.deepEqual(other.data.reply.cards ?? [], []);
  edits = [{ ...approved, price: 21000 }];
  const overBudget = await search(merchantBrowser, request);
  assert.equal(overBudget.data.reply.cards[0].budgetNote, '예산보다 2,000원 높아요');

  edits = [{ ...approved, details: { ...approved.details, taste: '간장 · 맵기 3/5' } }];
  const spicy = await search(merchantBrowser, '서초구에서 매운 치킨 추천해줘');
  assert.equal(spicy.data.reply.cards[0].menuId, approved.id);
  assert.equal(spicy.data.reply.cards[0].heat, 3);
  assert.ok(spicy.data.reply.cards[0].checks.includes('매운'));
  const mild = await search(merchantBrowser, request);
  assert.deepEqual(mild.data.reply.cards ?? [], []);

  edits = [{ ...approved, available: false }, { ...original, removed: true, available: false }];
  const noMenus = await search(merchantBrowser, '서초구 치킨 추천해줘');
  assert.equal(noMenus.status, 200);
  assert.deepEqual(noMenus.data.reply.cards ?? [], []);
  const unaffected = await search(guestBrowser, '서초구 치킨 추천해줘');
  assert.deepEqual(unaffected.data.reply.cards.map(result => result.menuId), ['original']);
  assert.equal(baseReads, 1);
});
