import { heatLevels, maxMenuGrams, maxMenuServings, readRecordedTaste, shortAnswerLimits } from '../dist/menu-interview.js';

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

export function readShortMenuInterview(body) {
  const identity = readMenuIdentity(body);
  const { answers } = body;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new Error('메뉴 질문에 답해 주세요.');
  const grams = answers.portion?.grams ?? null;
  const servings = answers.portion?.servings ?? null;
  if (grams === null && servings === null) throw new Error('양은 g 또는 인분으로 입력해 주세요.');
  if (grams !== null && (!Number.isInteger(grams) || grams < 1 || grams > maxMenuGrams)) {
    throw new Error('중량은 1~100000g 사이의 정수로 입력해 주세요.');
  }
  if (servings !== null && (!Number.isInteger(servings) || servings < 1 || servings > maxMenuServings)) {
    throw new Error('인분은 1~20 사이의 정수로 입력해 주세요.');
  }
  const heat = answers.heat ?? null;
  if (heat !== null && !heatLevels.some(level => level.number === heat)) throw new Error('맵기는 1~5단계 중 골라 주세요.');
  const notes = readText(answers.composition, shortAnswerLimits.composition);
  const { taste } = readRecordedTaste(readText(answers.taste, shortAnswerLimits.taste));
  const features = readText(answers.features, shortAnswerLimits.features);
  if (!notes || !taste) throw new Error('구성과 맛을 한 줄씩 입력해 주세요.');
  return {
    ...identity, servings, notes, taste, heat, features,
    portion: [grams && `${grams}g`, servings && `${servings}인분`].filter(Boolean).join(' / '),
  };
}

export function formatShortMenuDraft({ portion, notes, taste, heat, servings, features }, suggestion) {
  const heatLabel = heat && `맵기 ${heat}/5`;
  const draftFeature = features || suggestion?.text || '';
  return {
    description: [portion, notes, taste, heatLabel, draftFeature].filter(Boolean).join(' · '),
    details: { portion, notes, taste: [taste, heatLabel].filter(Boolean).join(' · '), servings, features: draftFeature },
    ...(suggestion && { suggestion }),
  };
}

export function readMenuQuestionsInput(body) {
  return { ...readMenuIdentity(body), category: readText(body.category, 40) };
}

const generalQuestions = {
  portion: '한 주문은 몇 g 또는 몇 인분인가요?',
  composition: '기본 구성은 무엇인가요?',
  taste: '어떤 맛인가요?',
  features: '식감이나 조리 특징이 있나요?',
};
const chickenQuestions = {
  portion: '치킨 한 주문은 몇 g인가요?',
  composition: '닭 부위와 기본 구성은 무엇인가요?',
  taste: '어떤 소스나 양념을 쓰나요?',
  features: '튀김옷이나 식감에 특징이 있나요?',
};
const questionsByDish = [
  [/도시락|벤토/, {
    portion: '도시락은 몇 인분인가요?',
    composition: '메인 반찬과 기본 구성은 무엇인가요?',
    taste: '메인 반찬은 어떤 맛인가요?',
    features: '반찬이나 조리에 특징이 있나요?',
  }],
  [/치킨|통닭|닭다리|후라이드|프라이드/, chickenQuestions],
  [/떡볶이|떡뽁이|엽떡|라볶이/, {
    portion: '떡볶이 한 주문은 몇 인분인가요?',
    composition: '떡 외에 무엇이 들어가나요?',
    taste: '떡볶이 소스는 어떤 맛인가요?',
    features: '떡 종류나 식감은 어떤가요?',
  }],
  [/피자/, {
    portion: '피자 한 판은 몇 인분인가요?',
    composition: '주요 토핑은 무엇인가요?',
    taste: '어떤 소스를 쓰나요?',
    features: '도우나 굽기에 특징이 있나요?',
  }],
];

export function ruleMenuQuestions({ name, category }) {
  const questions = questionsByDish.find(([pattern]) => pattern.test(name))?.[1]
    ?? questionsByDish.find(([pattern]) => pattern.test(category))?.[1]
    ?? generalQuestions;
  if (questions === chickenQuestions && /닭다리/.test(name)) {
    return { ...questions, portion: '닭다리 한 주문은 몇 g인가요?' };
  }
  return questions;
}

export function validateMenuQuestions(output) {
  const entries = Object.keys(generalQuestions).map(field => {
    const value = output?.[field];
    return [field, typeof value === 'string' ? singleLine(value) : ''];
  });
  const values = entries.map(([, question]) => question);
  return values.every(question => question.length <= 48 && /^[^?？<>]+[?？]$/u.test(question)) &&
    /g\b|그램|인분/i.test(values[0]) &&
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
