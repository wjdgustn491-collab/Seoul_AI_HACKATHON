// 상황 추천: 시간·날씨·나이대로 오늘의 메뉴 한 가지와 한 줄 문장을 고른다 (AI 없이 코드 규칙).

import { GU_BOUNDS } from './seoul-gu.js';

// 서울 25개 구 중심 좌표 (날씨 조회용)
export const GU = {
  강남구: [37.5172, 127.0473], 강동구: [37.5301, 127.1238], 강북구: [37.6396, 127.0257], 강서구: [37.5509, 126.8495],
  관악구: [37.4784, 126.9516], 광진구: [37.5385, 127.0823], 구로구: [37.4954, 126.8874], 금천구: [37.4569, 126.8955],
  노원구: [37.6542, 127.0568], 도봉구: [37.6688, 127.0471], 동대문구: [37.5744, 127.0400], 동작구: [37.5124, 126.9393],
  마포구: [37.5663, 126.9019], 서대문구: [37.5791, 126.9368], 서초구: [37.4837, 127.0324], 성동구: [37.5633, 127.0371],
  성북구: [37.5894, 127.0167], 송파구: [37.5145, 127.1059], 양천구: [37.5170, 126.8665], 영등포구: [37.5264, 126.8962],
  용산구: [37.5324, 126.9900], 은평구: [37.6027, 126.9291], 종로구: [37.5735, 126.9790], 중구: [37.5641, 126.9979],
  중랑구: [37.6066, 127.0927],
};
const SEOUL = [37.5665, 126.9780];

// 점이 다각형 안에 있는지 (ray casting). ring: [[lat, lon], ...]
const inRing = (lat, lon, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ai, oi] = ring[i], [aj, oj] = ring[j];
    if ((ai > lat) !== (aj > lat) && lon < (oj - oi) * (lat - ai) / (aj - ai) + oi) inside = !inside;
  }
  return inside;
};

// 현재 위치가 속한 구: 실제 구 경계 안인지로 판정. 경계 단순화로 생긴 틈(경계선 근처)만 가까운 구 중심으로 보정.
export function nearestGu(lat, lon) {
  for (const [gu, rings] of Object.entries(GU_BOUNDS)) if (rings.some(ring => inRing(lat, lon, ring))) return gu;
  let best = null, dist = Infinity;
  for (const [gu, [a, b]] of Object.entries(GU)) {
    const d = (a - lat) ** 2 + ((b - lon) * Math.cos(lat * Math.PI / 180)) ** 2;
    if (d < dist) { dist = d; best = gu; }
  }
  // 어느 구에도 안 들어가고 중심에서도 멀면(약 8km 이상) 서울 밖
  return dist < (8 / 111) ** 2 ? best : null;
}

// 상황별 후보 (앞쪽일수록 우선). 규칙 기반 추천에서 서초·성동·관악 모두 결과가 나오는 메뉴만.
const BY_WEATHER = {
  rain: { why: '비가 오니', dishes: [['얼큰한', '짬뽕'], ['칼칼한', '김치찌개'], ['뜨끈한', '갈비탕']] },
  cold: { why: '오늘은 날씨가 추우니', dishes: [['따뜻한', '김치찌개'], ['뜨끈한', '갈비탕'], ['구수한', '된장찌개']] },
  hot: { why: '오늘은 날씨가 더우니', dishes: [['산뜻한', '초밥'], ['가볍게', '김밥'], ['입맛 도는', '비빔밥']] },
};
const BY_TIME = {
  morning: { why: '든든한 아침으로', dishes: [['간단한', '김밥'], ['든든한', '비빔밥']] },
  lunch: { why: '점심으로', dishes: [['든든한', '비빔밥'], ['간편한', '도시락'], ['바삭한', '돈까스']] },
  dinner: { why: '저녁으로', dishes: [['푸짐한', '삼겹살'], ['구수한', '된장찌개'], ['바삭한', '돈까스']] },
  night: { why: '출출한 밤엔', dishes: [['야식으로', '족발'], ['매콤한', '떡볶이'], ['얼얼한', '마라탕']] },
};
// 나이대가 좋아할 만한 메뉴: 상황 후보 중에 있으면 그걸 먼저 고른다
const BY_AGE = {
  '10대': ['떡볶이', '돈까스', '마라탕'],
  '20대': ['마라탕', '떡볶이', '초밥', '짬뽕'],
  '30대': ['초밥', '김치찌개', '짬뽕', '도시락'],
  '40대': ['김치찌개', '삼겹살', '된장찌개', '족발'],
  '50대 이상': ['갈비탕', '된장찌개', '비빔밥'],
};
export const AGE_GROUPS = Object.keys(BY_AGE);

export const timeSlot = hour => hour >= 5 && hour < 10 ? 'morning' : hour >= 10 && hour < 15 ? 'lunch'
  : hour >= 15 && hour < 21 ? 'dinner' : 'night';

export function weatherKind({ tempC, rain } = {}) {
  if (rain) return 'rain';
  if (tempC == null) return null;
  if (tempC <= 8) return 'cold';
  if (tempC >= 27) return 'hot';
  return null;
}

// → { dish, line, reasons }
export function suggest({ hour, tempC, rain, ageGroup } = {}) {
  const w = weatherKind({ tempC, rain });
  const t = timeSlot(hour);
  // 날씨가 뚜렷하면 날씨 우선, 아니면 시간대. 밤에는 날씨보다 야식.
  const pick = t === 'night' || !w ? BY_TIME[t] : BY_WEATHER[w];
  const liked = BY_AGE[ageGroup] ?? [];
  const [adj, dish] = pick.dishes.find(([, d]) => liked.includes(d)) ?? pick.dishes[0];
  const reasons = [w && t !== 'night' ? w : null, t, liked.includes(dish) ? ageGroup : null].filter(Boolean);
  return { dish, line: `${pick.why} ${adj} ${dish} 어때요?`, reasons };
}

// Open-Meteo 현재 날씨 (키 불필요). 실패하면 null → 시간대만으로 추천.
export async function fetchWeather(gu) {
  const [lat, lon] = GU[gu] ?? SEOUL;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,weather_code&timezone=Asia%2FSeoul`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const { current } = await res.json();
    // weather_code 51~67 이슬비·비, 80~82 소나기, 95~99 뇌우
    const code = current.weather_code;
    return { tempC: current.temperature_2m, rain: current.precipitation > 0 || (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95 };
  } catch { return null; }
}
