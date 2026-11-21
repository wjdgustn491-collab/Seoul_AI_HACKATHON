const textLimits = { taste: 60, portion: 60, features: 100, notes: 240 };
const descriptionLimit = 240;
const singleLine = value => value.trim().replace(/\s+/gu, ' ');

function readText(value, max) {
  const text = value ?? '';
  if (typeof text !== 'string' || text.length > max) throw new Error('메뉴 정보의 글자 수를 확인해 주세요.');
  return singleLine(text);
}

function readMenuIdentity(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('메뉴 정보를 입력해 주세요.');
  const name = readText(body.name, 80);
  if (!name) throw new Error('메뉴명을 입력해 주세요.');
  if (!Number.isInteger(body.price) || body.price < 1 || body.price > 1000000) throw new Error('가격을 확인해 주세요.');
  return { name, price: body.price };
}

export function readMenuDescriptionInput(body) {
  const identity = readMenuIdentity(body);
  const details = Object.fromEntries(Object.entries(textLimits).map(([field, max]) => [field, readText(body[field], max)]));
  const servings = body.servings ?? null;
  if (servings !== null && (!Number.isInteger(servings) || servings < 1 || servings > 20)) {
    throw new Error('인분은 1~20 사이의 숫자로 입력해 주세요.');
  }
  if (!(details.taste || servings || details.portion || details.features || details.notes)) {
    throw new Error('맛, 분량, 특징, 설명 메모 중 한 가지 이상 입력해 주세요.');
  }
  return { ...identity, ...details, servings };
}

const declaredServings = portion => {
  const match = portion.match(/(?:^|[^\d.,])(\d{1,2})(?:\s*[~∼–-]\s*\d{1,2})?\s*인(?:분|용)/);
  const count = Number(match?.[1]);
  return count >= 1 && count <= 20 ? count : null;
};

export function readMenuInterviewAnswers(body) {
  const { answers } = body;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new Error('메뉴 질문에 답해 주세요.');
  const portion = readText(answers.portion, textLimits.portion);
  return readMenuDescriptionInput({
    name: body.name, price: body.price, portion,
    taste: answers.taste, notes: answers.composition, features: answers.features,
    servings: declaredServings(portion) ?? body.servings,
  });
}

export function readMenuQuestionsInput(body) {
  return { ...readMenuIdentity(body), category: readText(body.category, 40) };
}

const generalQuestions = {
  portion: '한 주문은 몇 인분 또는 어느 정도 양인가요?',
  composition: '한 주문에 기본으로 무엇이 들어가나요?',
  taste: '어떤 맛이나 양념이 이 메뉴를 잘 설명하나요?',
  features: '조리 방식이나 식감에서 손님에게 알려 줄 특징이 있나요?',
};
const chickenQuestions = {
  portion: '치킨 한 주문은 몇 g 또는 몇 조각인가요?',
  composition: '치킨과 함께 기본으로 제공하는 메뉴가 있나요?',
  taste: '어떤 소스나 양념을 사용하나요?',
  features: '이 치킨만의 조리 방식이나 식감 특징이 있나요?',
};
const questionsByDish = [
  [/도시락|벤토/, {
    portion: '도시락 하나는 몇 인분인가요?',
    composition: '메인 반찬을 포함해 도시락에 무엇이 들어가나요?',
    taste: '메인 반찬은 어떤 맛인가요?',
    features: '이 도시락만의 조리 방식이나 구성 특징이 있나요?',
  }],
  [/치킨|통닭|닭다리|후라이드|프라이드/, chickenQuestions],
  [/떡볶이|떡뽁이|엽떡|라볶이/, {
    portion: '떡볶이 한 주문은 몇 인분인가요?',
    composition: '떡과 함께 기본으로 들어가는 재료는 무엇인가요?',
    taste: '떡볶이 소스는 어떤 맛인가요?',
    features: '떡 종류나 식감에서 이 메뉴만의 특징이 있나요?',
  }],
  [/피자/, {
    portion: '피자 한 판은 몇 인분 또는 어떤 크기인가요?',
    composition: '기본으로 올라가는 주요 토핑은 무엇인가요?',
    taste: '소스나 토핑에서 어떤 맛이 가장 잘 느껴지나요?',
    features: '도우나 굽는 방식에 어떤 특징이 있나요?',
  }],
];

export function ruleMenuQuestions({ name, category }) {
  const questions = questionsByDish.find(([pattern]) => pattern.test(name))?.[1]
    ?? questionsByDish.find(([pattern]) => pattern.test(category))?.[1]
    ?? generalQuestions;
  if (questions === chickenQuestions && /닭다리/.test(name)) {
    return { ...questions, portion: '한 주문에 닭다리는 몇 g 들어가나요?' };
  }
  return questions;
}

export function validateMenuQuestions(output) {
  const entries = Object.keys(generalQuestions).map(field => {
    const value = output?.[field];
    return [field, typeof value === 'string' ? singleLine(value) : ''];
  });
  const values = entries.map(([, question]) => question);
  return values.every(question => question.length <= 100 && /^[^?？<>]+[?？]$/u.test(question)) &&
    new Set(values).size === values.length ? Object.fromEntries(entries) : null;
}

export function formatMenuDescription({ name, taste, servings, portion, features, notes }) {
  const sentence = value => value && /[.!?。？！]$/u.test(value) ? value : `${value}.`;
  const facts = [taste, servings && declaredServings(portion) !== servings && `${servings}인분`, portion, features].filter(Boolean).join(' · ');
  const description = [sentence(`${name}입니다`), facts && sentence(facts), notes && sentence(notes)].filter(Boolean).join(' ');
  if (description.length <= descriptionLimit) return description;
  return description.slice(0, descriptionLimit - 1).replace(/[\uD800-\uDBFF]$/, '').trimEnd() + '…';
}

export function validateMenuDraft(output, menu) {
  if (typeof output?.description !== 'string') return null;
  const description = singleLine(output.description);
  if (!description || description.length > descriptionLimit || /[<>\u0000-\u001f]/.test(description)) return null;
  const numbers = value => value.match(/\d[\d,]*(?:\.\d+)?/g)?.map(match => match.replace(/,/g, '')) ?? [];
  const enteredNumbers = new Set(numbers(Object.values(menu).filter(value => value !== null).join(' ')));
  return numbers(description).every(number => enteredNumbers.has(number)) ? description : null;
}
