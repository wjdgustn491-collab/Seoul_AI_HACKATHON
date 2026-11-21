export const maxMenuGrams = 100000;
export const maxMenuServings = 20;
export const maxSauceShu = 16000000;
export const shortAnswerLimits = { composition: 32, taste: 24, features: 24 };

export const heatLevels = [
  { number: 1, example: '진라면 순한맛', label: '살짝 매움' },
  { number: 2, example: '진라면 매운맛', label: '가볍게 매움' },
  { number: 3, example: '신라면', label: '보통 매움', shu: 3400 },
  { number: 4, example: '불닭볶음면 오리지널', label: '많이 매움', shu: 4404 },
  { number: 5, example: '핵불닭볶음면 2X', label: '아주 매움', shu: 10000 },
];
export const heatReferenceUrl = 'https://github.com/park9896012-prog/K-Food-Guide-1/blob/main/src/data/kFoodData.ts#L370-L444';

const recordedHeat = /(?:^|\s*·\s*)맵기 ([1-5])\/5$/;

export function readRecordedTaste(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  const match = text.match(recordedHeat);
  return { taste: match ? text.slice(0, match.index).trimEnd() : text, heat: Number(match?.[1]) || null };
}

export function mentionsHeat(value) {
  const withoutNegations = value
    .replace(/안\s*매(?:운|워|움)|맵지\s*않[가-힣]*|(?:맵기|매운\s*맛)(?:가|이|은|도)?\s*없[가-힣]*/g, '')
    .replace(/(?:청양고추|고춧?가루|고추장|핫소스|캡사이신)(?:이|을|는)?\s*(?:없이|제외|빼고)/g, '');
  return /매(?:운|콤|워|움)|맵기|얼큰|칼칼|불닭|마라|청양고추|고춧?가루|고추기름|고추장|핫소스|캡사이신|할라피뇨|페퍼론치노/.test(withoutNegations);
}

export function estimateMenuHeat(shu, sauceGrams, totalGrams) {
  if (!Number.isInteger(shu) || shu < 1 || shu > maxSauceShu ||
      !Number.isFinite(sauceGrams) || sauceGrams < 0.01 ||
      !Number.isInteger(totalGrams) || totalGrams < sauceGrams || totalGrams > maxMenuGrams) return null;
  // Compare an approximate mass-weighted concentration to the examples.
  const diluted = shu * sauceGrams / totalGrams;
  const [, , shin, buldak, haekBuldak] = heatLevels;
  const minimumShu = [0, 1000, 2700, (shin.shu + buldak.shu) / 2, (buldak.shu + haekBuldak.shu) / 2];
  return heatLevels.findLast((_, index) => diluted >= minimumShu[index]);
}
