import { readRecordedTaste } from '../dist/menu-interview.js';

// Menu recommendation engine adapted from feature/ai-recommend.
import {
  stripFillers, SLANG, isForeign, FOREIGN_NOTE, TASTE_CANON, TASTE_EVIDENCE, canonTaste, KEEP_TASTES,
  NEG, AVOID_INGREDIENTS, AVOID_WORDS, NOT_AVOID, SITUATIONS, SITUATION_WEIGHT, KOREAN_COUNT, EATERS_RE, COMPANION_TWO, SOLO,
  MAYBE_MISSING, PRICEY_RE, ZERO_PRICE_RE, VAGUE_RE, USUAL_RE, CATEGORY_BY_HOUR,
} from './vocab.js';
import { classifyIntent } from './intent.js';
export const CATEGORIES = [
  '치킨', '한식', '중식', '분식', '피자', '카페·디저트', '일식', '양식', '아시안',
  '고기·구이', '패스트푸드', '족발·보쌈', '야식', '도시락·죽', '샐러드', '편의점',
];
const CATEGORY_MAP = new Map([
  ['치킨·튀김','치킨'], ['국·탕','한식'], ['밥·덮밥','한식'], ['양식·일식','양식'],
  ['돈까스·일식','일식'], ['버거','패스트푸드'],
]);
// 데이터 업종 이름 → 엔진 업종 이름 (예: 돈까스·일식 → 일식)
export const normalizeCategory = category => CATEGORY_MAP.get(category) ?? category;
const portionEvidence = /푸짐|넉넉|대용량|곱빼기|[2-9]\s*인분|두\s*마리|[2-9]\s*마리/;
const wholeChickenEvidence = /한\s*마리|1\s*마리/;
const EXTRA_CHEESE = '치즈 듬뿍';
// AI 입력 상한 (토큰·지연 관리). ② 좁히기 질문, ③ 맞음 판단. 벤치마크(scripts/bench.js) 보고 조정.
export const AI2_MAX_STORES = 12, AI2_MAX_MENUS_PER_STORE = 3, AI2_DESC_MAX_CHARS = 60;
export const AI3_MAX_CANDIDATES = 8, AI3_MAX_MENUS_PER_STORE = 5, AI3_DESC_MAX_CHARS = 100;
const cheeseRequest = /(?:치[즈츠]|모짜렐라|모차렐라)(?:를|을|가|는|은|도)?\s*(?:많|듬뿍|가득|푸짐|넉넉|두\s*배|2\s*배|추가|더\s*올린)|(?:듬뿍|가득|두\s*배|2\s*배)\s*치[즈츠]|(?:더블|엑스트라)\s*치[즈츠]/;
const cheeseAmount = /(?:치즈|모짜렐라|모차렐라)(?:를|을|가|는|은|도)?\s*(?:두\s*배|2\s*배|듬뿍|가득|푸짐|넉넉|많이|많은|많아요|수북)|(?:더블|엑스트라|듬뿍|가득|두\s*배|2\s*배)\s*치즈/;
const cheeseAmountDenied = /(?:치즈|모짜렐라|모차렐라)(?:가|는|은)?\s*(?:양(?:이|은|는)?\s*)?(?:(?:많지|넉넉하지)\s*않|(?:듬뿍|가득|두\s*배|2\s*배)(?:은|는|이|가)?\s*아니)/;
const MILD = '안 매운';
const SPICY = '매운';
const CHICKEN_CUTS = ['순살', '뼈'];
const mildWords = /안\s*매(?:운|워|움)|맵지\s*않(?:은|아요|아|게|고|습니다|음)?|순한\s*맛|순한(?=\s|치킨|$)|매운\s*맛(?:이|은|도)?\s*없(?:는|어요|어|음)?/g;
const spicyWords = /매(?:운|콤|워|움)|맵(?:다|고|게|습니다|기\s*(?:있|[1-5]\/5(?!\d)))|얼큰|칼칼|불닭|청양고추/;
const noBone = /뼈(?:가|를)?\s*(?:없(?:는|이|어요|어|음)?|제거(?:한)?|발라낸)/g;
const boneIn = /뼈(?:가|는)?(?=\s*(?:있|치킨|닭|통닭|후라이드|프라이드|양념|간장|[()\/·,]|$))/;
const tasteAliases = new Map([['마늘', /마늘|갈릭/]]);
const omitMildWords = text => text.replace(mildWords, ' ');
const hasMildWords = text => omitMildWords(text) !== text;
const hasSpicyWords = text => spicyWords.test(omitMildWords(text));
const tasteMatching = new Map([
  [MILD, hasMildWords], [SPICY, hasSpicyWords],
  ['푸짐', text => portionEvidence.test(text)], [EXTRA_CHEESE, text => cheeseAmount.test(text)],
]);
const LESS_SPICY = /(?:매운\s*맛|맵기|매운\s*거|매운\s*정도)\s*(?:이|을|를|은|는)?\s*(?:좀\s*|조금\s*|더\s*)?(?:덜|줄|약하게|낮춰|낮게)|덜\s*(?:맵게|매운|매콤)|안\s*맵게|순하게/;
const SPICY_ASK = TASTE_CANON.find(t => t.canon === '매운').ask;
const normalizeTasteRequests = text => text
  .replace(LESS_SPICY, ' 안 매운 ')
  .replace(/(?:매운|매콤한|매운\s*맛)\s*(?:맛|음식|것|거|건)?(?:이|은|는|을|도)?\s*(?:안\s*돼|안\s*되|못\s*먹|싫|빼\s*주세요)[가-힣]*/g, '안 매운 ')
  .replace(/매운\s*(?:맛|음식|것|거|건)(?:이|은|는|을|도)?\s*(?:말고|빼고|빼\s*줘|제외(?:하고|해\s*줘)?)/g, '안 매운 ')
  .replace(/뼈(?:는|를)?\s*(?:빼고|빼\s*줘|제외(?:하고|해\s*줘)?)/g, '순살 ');
const withoutDishModifiers = text => omitMildWords(text).replace(noBone, ' ')
  .replace(/뼈(?:가|는)?\s*있는/g, ' ')
  .replace(/(^|\s)(?:매운|매콤한|바삭한|크리스피|순살|뼈)\s*(?=(?:치킨|통닭|피자|떡볶이)(?:\s|$))/g, '$1').trim();

function chickenCut(text) {
  // A choice of variants does not identify the SKU that will be added to the cart.
  if (/(?:순살|뼈)(?:로|도)?\s*(?:변경|옵션|선택)/.test(text)) return null;
  const boneless = /순살/.test(text) || text.replace(noBone, ' ') !== text;
  const bone = boneIn.test(text.replace(noBone, ' '));
  if (boneless === bone) return null;
  return boneless ? '순살' : '뼈';
}

function mergeTaste(current, requested) {
  const cut = requested.find(term => CHICKEN_CUTS.includes(term));
  const mild = requested.includes(MILD);
  const spicy = requested.some(hasSpicyWords);
  const kept = current.filter(term =>
    !(cut && term !== cut && CHICKEN_CUTS.includes(term)) &&
    !(mild && hasSpicyWords(term)) && !(spicy && term === MILD));
  const terms = [...new Set([...kept, ...requested])];
  return terms.includes(EXTRA_CHEESE) ? terms.filter(term => term !== '치즈') : terms;
}

const franchiseQuestion = /프[랜렌]차이즈(?:\s*(?:가|는|도))?\s*(?:아니(?:야|에요|죠)|아닌(?:가|지)|맞(?:아|나요|죠|는지)|인(?:가|지)|예요|에요|야|입니까|[?？])/;
const sideOrDrink = /^(?:공기밥|공깃?밥|밥추가|계란말이|계란찜|콜라|사이다|탄산수|생수|제로콜라|주류)|모둠튀김|모듬튀김|감자튀김|치즈볼|군만두|음료|토핑|사리|소스추가|아이스크림|케이크|아메리카노|추가$/;
// 고기 1인분 기준 무게. 삼겹살(200g)=1인분, 대패삼겹살(100g)=0.5인분 → 혼자면 2개로 비교
export const MEAT_SERVING_G = 200;
const MEAT_CATEGORIES = new Set(['고기·구이']);
const SIZED_CATEGORIES = new Set(['한식', '족발·보쌈', '중식', '야식', '고기·구이', '분식']);
function menuPortion(menu, category) {
  const declared = menu.details?.servings;
  if (Number.isInteger(declared) && declared >= 1 && declared <= 20) return { servings: declared, estimated: false };
  const servings = /(?:^|[^\d])(\d{1,2})(?:\s*[~∼–-]\s*\d{1,2})?\s*인(?:분|용|\s*세트|\s*기준|(?=[\s)\]]|$))/;
  const knownCount = /(?:^|[^가-힣])(한|두|세|네)\s*명(?:이서|\s*기준)/;
  const descriptionCount = menu.desc.match(knownCount)?.[1];
  const explicit = Number(menu.name.match(servings)?.[1] || menu.desc.match(servings)?.[1] ||
    ({ 한: 1, 두: 2, 세: 3, 네: 4 })[descriptionCount]);
  if (explicit > 0 && explicit <= 20) return { servings: explicit, estimated: false };
  // 족발·찜·탕수육 등의 (소)/(중)/(대)는 2/3/4인분으로 본다 (추정)
  const size = menu.name.match(/\((소|중|대)\)/)?.[1];
  if (size && SIZED_CATEGORIES.has(category)) return { servings: { 소: 2, 중: 3, 대: 4 }[size], estimated: true };
  const grams = Number(menu.name.match(/(\d{2,4})\s*g(?![a-z])/i)?.[1]);
  if (MEAT_CATEGORIES.has(category) && grams >= 50 && grams <= 2000) return { servings: grams / MEAT_SERVING_G, estimated: false };
  const shareable = category === '치킨' || category === '피자';
  const count = menu.name.match(/(\d)\s*마리/);
  const chickens = Number(count?.[1] || (/두\s*마리/.test(menu.name) ? 2 : 1));
  return { servings: shareable ? Math.max(1, chickens) * 2 : 1, estimated: true };
}
const ALL_REGIONS = '서울 전체';
const GENDER_WORDS = /(?:남성|여성|남자|여자)(?!\s*친구)\s*/g; // 남자친구·여자친구는 인원(2명)으로만 읽는다
// 받침 있으면 "으로"(ㄹ 받침 제외), 없으면 "로"
const ro = word => {
  const code = String(word).charCodeAt(String(word).length - 1) - 0xac00;
  return code >= 0 && code < 11172 && code % 28 && code % 28 !== 8 ? '으로' : '로';
};
const PEOPLE_WORD = { 1: '혼자', 2: '둘이서', 3: '셋이서', 4: '넷이서' };

// ---------- 맥락 조건: 먹은 것·피할 것·끼니·계절·배달팁 ----------
// 계절별 메뉴 근거(이름·설명). 규칙 모드와 AI 모드가 같은 표를 쓴다.
export const SEASON_HINTS = {
  winter: { boost: /국물|탕(?!수육)|찌개|전골|국밥|칼국수|수제비|우동|라멘|쌀국수|마라탕|샤브|짬뽕|어묵|죽|뜨끈|따뜻|얼큰/, penalty: /냉면|콩국수|빙수|아이스|샐러드|물회|냉모밀/ },
  summer: { boost: /냉면|콩국수|모밀|메밀|물회|빙수|샐러드|시원|냉/, penalty: /전골|뚝배기|뜨끈/ },
  rainy: { boost: /전|파전|칼국수|수제비|짬뽕|국물|부침/, penalty: null },
};
// 소프트 가중치 (조건 일치 50/25, 가격 30, 별점 20을 뒤집지 않을 정도로 시작)
export const CONTEXT_WEIGHTS = { seasonBoost: 10, seasonPenalty: -10, eatenCategory: -12, mealCafe: -6, lateNightBoost: 6, newStoreBoost: 10 };
const MEAL_KO = { breakfast: '아침', lunch: '점심', dinner: '저녁', snack: '간식', late_night: '야식' };
const SEASON_KO = { winter: '겨울', summer: '여름', rainy: '비 오는 날' };
const SEASON_FOOD = { winter: '따뜻한', summer: '시원한', rainy: '비 오는 날 생각나는' };
const MEAL_ENUM = ['breakfast', 'lunch', 'dinner', 'snack'];
const MEAL_TIME_ENUM = ['breakfast', 'lunch', 'dinner', 'late_night'];
const SEASON_ENUM = ['winter', 'summer', 'rainy'];
// "먹었다"(과거). "먹고 싶/먹을래/먹자"는 해당하지 않는다.
const EATEN_VERB = /먹(?:었(?:고|는데|으니까?|어요|어|다|지만|거든|던)?|음|어서)/g;
// 먹은 절의 시작을 알려 주는 말 (끼니·시점)
const EATEN_MARKER = /(아침|점심|저녁|야식|간식|아까|어제|오늘|낮|밤)/g;
const EATEN_MEAL = { 아침: 'breakfast', 점심: 'lunch', 저녁: 'dinner', 야식: 'snack', 간식: 'snack', 밤: 'snack' };
// 카테고리 이름 그 자체(예: 치킨)는 구체 음식이 아니다 → 먹었으면 그 카테고리 감점만
const GENERIC_FOOD = /^(?:치킨|피자|한식|중식|일식|양식|분식|야식|아시안|패스트푸드|디저트|카페|편의점|고기|족발|보쌈|샐러드)$/;
const AVOID_RE = /([가-힣A-Za-z]+?)\s*(?:은|는|이|가|도)?\s*(?:싫어|싫고|싫은데|싫음|빼고|빼\s*줘|제외|안\s*먹을래)/g;
const MEAL_TIME_RE = /(아침|점심|저녁|야식|새벽|밤)\s*(?:에|엔|은|는|으로|메뉴|밥|식사|에는)?\s*(?:추천|뭐|먹|땡|걸로|메뉴|으로|로|은|는|,|$)/;
const MEAL_TIME_OF = { 아침: 'breakfast', 점심: 'lunch', 저녁: 'dinner', 야식: 'late_night', 새벽: 'late_night', 밤: 'late_night' };
const SEASON_RE = { winter: /겨울|추워|추운|추우|쌀쌀/, summer: /여름|더워|더운|더우|덥/, rainy: /비\s*(?:와|오|온|내리)|장마/ };
const SEASON_ASK = /날씨에?\s*(?:맞춰|맞게|어울리|따라)|날씨\s*생각/;
const TIP_FREE = /배달\s*(?:팁|비|료)\s*(?:은|는|이|가)?\s*(?:안\s*(?:내는|드는|나오는|내도|붙는)|없는|없이|없고|없으면|없었으면|무료|0\s*원(?:으로|인)?|공짜)(?:\s*(?:곳|가게|데)(?:만|으로|로)?)?(?:\s*(?:좋겠어|좋겠어요|해\s*줘|만))?|무료\s*배달/;
const TIP_MAX = /배달\s*(?:팁|비|료)\s*(?:은|는|이|가)?\s*([\d,.]+\s*(?:천\s*)?원?|[일이삼사오육칠팔구]?\s*천\s*원?)\s*(?:이하|까지|아래|안쪽|밑)/;
const sameDish = (a, b) => !!a && !!b && (dishMatches(a, b) || dishMatches(b, a));
// 카테고리를 고른 뒤 먼저 고르는 세부 메뉴. 로컬 메뉴 데이터에서 자주 나오는 메뉴로 채웠다.
// 실제 버튼은 선택한 지역에서 그 메뉴를 대표 메뉴로 파는 가게가 있는 것만, 많은 순으로 최대 8개.
export const SUBMENUS = {
  치킨: [['후라이드', /후라이드|프라이드/], ['양념', /양념/], ['간장', /간장/], ['시즈닝', /시즈닝|뿌링/], ['반반', /반반/], ['마늘', /마늘/], ['오븐구이', /오븐/], ['닭강정', /닭강정/]],
  피자: [['페퍼로니', /페퍼로니/], ['불고기', /불고기/], ['포테이토', /포테이토|감자/], ['고구마', /고구마/], ['치즈', /치즈피자/], ['콤비네이션', /콤비네이션|슈퍼디럭스/], ['하와이안', /하와이안/], ['쉬림프', /쉬림프|새우/]],
  중식: [['짜장', /짜장|자장/], ['짬뽕', /짬뽕/], ['탕수육', /탕수육/], ['볶음밥', /볶음밥/], ['마라', /마라/], ['꿔바로우', /꿔바로우/], ['마파두부', /마파/], ['깐풍기', /깐풍/]],
  분식: [['떡볶이', /떡볶이/], ['김밥', /김밥/], ['순대', /순대/], ['튀김', /튀김/], ['라볶이', /라볶이/], ['쫄면', /쫄면/], ['라면', /라면/], ['돈까스', /돈까스|돈가스/]],
  한식: [['찌개', /찌개/], ['비빔밥', /비빔밥/], ['국밥·해장국', /국밥|해장국/], ['탕', /탕$|탕\(|탕 /], ['찜', /찜/], ['정식', /정식/], ['볶음', /볶음/], ['국수', /국수|칼국수/]],
  일식: [['돈까스', /돈까스|돈가스/], ['초밥', /초밥|스시/], ['우동', /우동/], ['덮밥', /덮밥|규동|가츠동|동$/], ['모밀', /모밀|소바/], ['회', /회$|회\(|사시미/]],
  양식: [['파스타', /파스타|스파게티|알리오|까르보|올리오/], ['스테이크', /스테이크/], ['리조또', /리조또|리소토/], ['샐러드', /샐러드/]],
  아시안: [['쌀국수', /쌀국수/], ['팟타이', /팟타이/], ['마라샹궈', /마라/], ['나시고랭', /나시고랭/], ['분짜', /분짜/], ['월남쌈', /월남쌈/], ['똠얌꿍', /똠얌/], ['반미', /반미/]],
  '고기·구이': [['삼겹살', /삼겹|오겹|삼결/], ['목살', /목살/], ['돼지갈비', /돼지갈비|왕갈비/], ['소불고기', /불고기/], ['항정살', /항정/], ['닭갈비', /닭갈비/], ['곱창', /곱창|막창|대창/]],
  '족발·보쌈': [['족발', /족발/], ['보쌈', /보쌈/], ['반반', /반반|족보/], ['불족발', /불족발/], ['냉채족발', /냉채/]],
  패스트푸드: [['치즈버거', /치즈버거/], ['치킨버거', /치킨버거/], ['새우버거', /새우버거/], ['베이컨버거', /베이컨/], ['더블패티', /더블/], ['클래식버거', /클래식/]],
  야식: [['곱창·막창', /곱창|막창/], ['닭발', /닭발/], ['오돌뼈', /오돌뼈/], ['불닭', /불닭/]],
  '도시락·죽': [['죽', /죽/], ['도시락', /도시락/]],
  '카페·디저트': [['커피', /아메리카노|라떼|커피|에스프레소/], ['케이크', /케이크|티라미수/], ['빙수', /빙수/], ['빵·크로플', /크로플|빵|쿠키|마카롱/], ['에이드·차', /에이드|티$|차$/]],
  샐러드: [['닭가슴살', /닭가슴살/], ['연어', /연어/], ['포케', /포케/], ['리코타', /리코타/], ['두부', /두부/]],
};
const SUBMENU_MAX = 8;
const subRegex = (menu, label) => SUBMENUS[menu]?.find(([l]) => l === label)?.[1] ?? null;

// 업종 안에서 성격이 다른 메뉴 종류. 남은 후보에 섞여 있으면 "빼고 보기" 버튼을 준다.
const VARIANTS = { 치킨: ['닭강정'] };
const isExcluded = (menu, exclude = []) => exclude.some(word => compact(menu.name).includes(compact(word)));
const menuText = menu => [menu.name, menu.desc ?? '', ...Object.values(menu.details ?? {}).filter(v => typeof v === 'string')].join(' ');
// 메뉴 단위 빼기에서 이름 일부만 같은 메뉴(예: 회오리감자)를 잘못 빼지 않게
const DISH_BLOCK = { 회: /(?:^|[^가-힣])회(?![가-힣])|회덮밥|물회|사시미|생선회|모듬회|모둠회|광어|우럭|연어회|참치회/ };
const SEOUL_DISTRICTS = new Set('강남구 강동구 강북구 강서구 관악구 광진구 구로구 금천구 노원구 도봉구 동대문구 동작구 마포구 서대문구 서초구 성동구 성북구 송파구 양천구 영등포구 용산구 은평구 종로구 중구 중랑구'.split(' '));
const compact = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const TTEOKBOKKI_VARIANT = /(?:마라(?:로제)?|로제(?:마라)?)(?:엽떡|떡볶이|떡뽁이)/;
const DISH_ALIASES = [
  /짜장면|자장면|짜장/, /짬뽕/, /탕수육/, /꿔바로우/, /닭강정/, /(?:후라이드|프라이드)(?:순살|뼈)?(?:치킨)?/,
  /간장(?:순살|뼈)?치킨/, /양념(?:순살|뼈)?치킨/, /마늘(?:순살|뼈)?치킨/, /김치찌개/, /된장찌개/, /순두부찌개/, /부대찌개/,
  /김치찜/, /찜닭/, /옻닭/, /감자탕/, /국밥/, /제육볶음|제육/, /비빔밥/, /갈비탕/,
  /떡볶이|떡뽁이/, /라볶이/, /김밥/, /순대/, /초밥|스시/, /돈가스|돈까스/,
  /우동/, /라멘/, /마라탕/, /마라샹궈/, /쌀국수/, /팟타이/, /파스타/, /스테이크/, /리소토/,
];
const dishMatches = (requested, name) => {
  const term = compact(requested);
  const item = compact(name);
  const aliases = DISH_ALIASES.find(pattern => pattern.test(term) && term.match(pattern)?.[0] === term);
  return !!term && (item.includes(term) || !!aliases?.test(item));
};
const GRILL_MEAT = /삼겹|삼결|오겹|목살|항정|가브리|갈매기|꽃살|대패|갈비|등심|안심|채끝|차돌|우삼겹|불고기|주물럭|곱창|막창|대창|양꼬치|닭갈비|닭발|생고기|흑돼지|구이|모듬|모둠|제육|쇠고기|소고기|오리|닭한마리|보쌈|족발|불백/;
const GRILL_NOT_MAIN = /찌개|짜개|탕|냉면|국수|도시락|세트|정식|볶음밥|비빔밥|공기|카레|추가/;
const mainMenuFor = (category, menu) => {
  const { name } = menu;
  const declaredMain = menu.details?.servings > 0 && !sideOrDrink.test(compact(name));
  if (category === '치킨') return !/까스|가스|버거|샐러드/.test(name) &&
    (declaredMain || /치킨|통닭|닭강정|후라이드|프라이드|닭다리|닭날개|텐더|순살/.test(name));
  if (category === '피자') return /피자/.test(name) || (declaredMain && !/샐러드|파스타|스파게티/.test(name));
  // 패스트푸드 대표 메뉴는 버거. 너겟·코울슬로·감자튀김·음료는 사이드, 핫도그는 "핫도그"라고 말하면 메뉴 검색으로 찾는다
  if (category === '패스트푸드') return /버거/.test(name);
  if (category === '족발·보쌈') return /족발|보쌈/.test(name);
  // 고깃집 대표 메뉴는 고기·부위·구이. 된장찌개·냉면·도시락·세트·정식 등 식사 메뉴는 비교 기준이 아니다
  if (category === '고기·구이') return GRILL_MEAT.test(name) && !GRILL_NOT_MAIN.test(name);
  if (category === '샐러드') return /샐러드|포케/.test(name);
  return true;
};

const median = a => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};
const clamp = v => Math.max(0, Math.min(1, v));

function menuFacts(menu) {
  const { taste, servings, portion, features } = menu.details ?? {};
  return [
    ['맛 정보', taste], ['분량 정보', servings && `${servings}인분`],
    ['분량 정보', portion], ['특징 정보', features],
  ].filter(([, value]) => typeof value === 'string' && value);
}

// opts.zone: { 주문자 동: { 가게 동: km } } — 주면 '동 단위 검색'(같은 동 → 3km 확장)을 쓴다 (dist/searchRule.js와 같은 규칙)
// opts.exposure: { day, counts } — 여러 엔진 인스턴스가 노출 횟수를 같이 쓸 때
// opts.guided: 대화형 단계 — 동네 → "뭐가 먹고 싶어요?" → (음식 없으면) 카테고리 → (세부 메뉴) → 예산 → 추천
export function createEngine(snapshot, opts = {}) {
  const zone = opts.zone ?? null;
  const guided = !!opts.guided;
  const random = opts.random ?? Math.random; // 평가·테스트에서는 고정 시드 함수를 넘긴다
  const menuGroups = new Map();
  for (const menu of snapshot.menus) {
    if (!menuGroups.has(menu.store)) menuGroups.set(menu.store, []);
    menuGroups.get(menu.store).push(menu);
  }
  const openStores = snapshot.stores.filter(store => store.is_open !== false);
  const stores = openStores.filter(store => menuGroups.has(store.id)).map(store => ({
    ...store, category: CATEGORY_MAP.get(store.category) ?? store.category, minOrder: store.minOrder ?? 0,
  }));
  const storesById = new Map(stores.map(store => [store.id, store]));
  const regions = [...new Set(openStores.map(store => store.region))].sort((a,b) => a.localeCompare(b,'ko'));
  const areas = new Map();
  for (const { region, dong } of openStores) {
    if (!areas.has(dong)) areas.set(dong, new Set());
    areas.get(dong).add(region);
  }
  // 동 단위 검색: 주문자 동이 정해지면 1단계 같은 동, 2단계(0곳·더 보기) 3km 안의 동
  const dongMode = state => !!(zone && state.neighborhood && zone[state.neighborhood]);
  const distanceOf = (state, store) => dongMode(state) ? zone[state.neighborhood][store.dong] ?? null : null;
  const inArea = (store, state) => dongMode(state)
    ? (state.expand || state.wide ? distanceOf(state, store) != null : store.dong === state.neighborhood)
    : (state.dong === ALL_REGIONS ? SEOUL_DISTRICTS.has(store.region) : store.region === state.dong) &&
      store.region !== state.excludedRegion && (!state.neighborhood || store.dong === state.neighborhood);
  const mains = Object.fromEntries(stores.map(store => {
    const menus = menuGroups.get(store.id);
    if (menus.some(menu => menu.main === true)) {
      const marked = menus.filter(menu => menu.main === true || (menu.details?.servings > 0 && mainMenuFor(store.category, menu)));
      return [store.id, marked.sort((a,b) => a.price-b.price)];
    }
    // 사이드·음료·추가 메뉴는 대표 메뉴가 아니다 (카페·디저트는 케이크·음료가 대표)
    const items = menus.filter(menu => mainMenuFor(store.category, menu) &&
      (store.category === '카페·디저트' || !sideOrDrink.test(compact(menu.name))));
    const cutoff = median(items.map(menu => menu.price)) * 0.5;
    return [store.id, items.filter(menu => menu.details?.servings > 0 || menu.price >= cutoff).sort((a,b) => a.price-b.price)];
  }));

  // ---------- 노출 횟수 (가게별, 매일 0시 초기화) ----------
  // ponytail: 서버 메모리라 재시작/서버리스 인스턴스마다 초기화됨. 유지가 필요하면 Supabase 테이블로.
  const exposure = opts.exposure ?? { day: '', counts: {} };
  const dateFormat = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul' });
  function expo(id) {
    const day = dateFormat.format();
    if (exposure.day !== day) { exposure.day = day; exposure.counts = {}; }
    return (storesById.get(id)?.exposure_count ?? 0) + (exposure.counts[id] ?? 0);
  }

  // ---------- 가격 패턴 (숫자+원/만/천, 한글 수사+원/만) ----------
  const PRICE_RE = /\d[\d,]*(?:\.\d+)?\s*(?:만\s*(?:[\d일이삼사오육칠팔구]+\s*천)?\s*원?|천\s*원?|원)|[일이삼사오육칠팔구십백]*[만천]\s*[일이삼사오육칠팔구십백천]*\s*원|[일이삼사오육칠팔구]만(?=\s|$)/;
  const hasPrice = t => PRICE_RE.test(String(t || ''));
  const DIG = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };
  function parseAmount(text) {
    const m = String(text).match(PRICE_RE);
    if (!m) return null;
    let total = 0, cur = 0, d = 0;
    for (const [, n, h, u] of m[0].replace(/[,\s원]/g, '').matchAll(/(\d+(?:\.\d+)?)|([일이삼사오육칠팔구])|([십백천만])/g)) {
      if (n) d = Number(n);
      else if (h) d = DIG[h];
      else if (u === '만') { total += (cur + d || 1) * 10000; cur = 0; d = 0; }
      else { cur += (d || 1) * { 십: 10, 백: 100, 천: 1000 }[u]; d = 0; }
    }
    return Math.round(total + cur + d) || null;
  }

  // ---------- 상태 ----------
  const freshCond = () => ({ menu: null, dish: null, foods: [], store: null, people: null, budget: null, budget_floor: null, budget_unit: 'total', price_pref: 'none', taste: [], franchise: 'none', budget_under: false, exclude: [], sub: null, goodPrice: false, anyMenu: false,
    eaten: [], avoid: [], meal_time: null, season: null, season_auto: false, delivery_tip_max: null, min_rating: null, new_store: 'none', situation: [], sameStore: false });
  const fresh = dong => ({ dong, neighborhood: null, excludedRegion: null, awaitingRegion: false, cond: freshCond(), chosen: [], questions: 0, asked: [], pending: null, seen: [], excludeSeen: false, exposed: [], cheapBoost: 1, lastMin: null, lastTop: [], lastRecommendations: [], preferredMenu: null, expand: false, wide: false, step: 'askFood', budgetAsked: false, budgetRetry: false, cheaper: false, clarifyCount: 0 });
  const isGroupMeal = c => c.people > 1 && c.budget != null;
  // "두 명이서 먹을 만한 메뉴": 인원만 있고 음식 종류가 없으면 묻지 않고 업종을 섞어 추천
  const isGroupPick = c => c.people > 1 && !c.menu && !c.dish && !c.store && !c.foods?.length;
  // 여러 명이 나눠 먹는 식사로 보기 어려운 업종
  const NOT_GROUP_MEAL = ['카페·디저트', '편의점', '샐러드', '도시락·죽'];
  const hasFood = c => !!(c.menu || c.dish || c.foods.length || c.store);
  const hasContext = c => !!(c.new_store === 'prefer' || c.eaten?.length || c.avoid?.length || c.meal_time || c.season || c.delivery_tip_max != null || c.situation?.length);
  // 대화형: 음식을 정하거나 [아무거나 괜찮아요]를 골라야 검색 (그때 2인 이상이면 기존 isGroupMeal·isGroupPick 규칙대로)
  const canSearch = ({ cond, dong }) => !!dong && (guided ? hasFood(cond) || cond.anyMenu || hasContext(cond)
    : !!(hasFood(cond) || isGroupMeal(cond) || isGroupPick(cond) || cond.goodPrice || hasContext(cond)));
  // 업종을 섞어 고르는 경우: 2인 이상 "골고루"(isGroupPick) 또는 혼자 [아무거나 괜찮아요]
  const mixedPick = c => isGroupPick(c) || ((c.anyMenu || hasContext(c)) && !hasFood(c));
  const areaLabel = state => state.neighborhood ? `${state.dong} ${state.neighborhood}` : state.excludedRegion ? `서울 전체 (${state.excludedRegion} 제외)` : state.dong;

  const validOption = option => option && typeof option.label === 'string' && Array.isArray(option.store_ids);

  function load(raw) {
    const s = { ...fresh(null), ...(raw && typeof raw === 'object' ? raw : {}) };
    if (s.dong !== ALL_REGIONS && !regions.includes(s.dong)) s.dong = null;
    if (!areas.get(s.neighborhood)?.has(s.dong)) s.neighborhood = null;
    if (s.dong !== ALL_REGIONS || !regions.includes(s.excludedRegion)) s.excludedRegion = null;
    s.cond = { ...freshCond(), ...(s.cond && typeof s.cond === 'object' ? s.cond : {}) };
    for (const k of ['chosen', 'asked', 'seen', 'exposed', 'lastTop']) s[k] = Array.isArray(s[k]) ? s[k].slice(-500) : [];
    s.expand = s.expand === true;
    for (const k of ['wide', 'budgetAsked', 'budgetRetry', 'cheaper']) s[k] = s[k] === true;
    s.clarifyCount = Math.min(Number(s.clarifyCount) || 0, 9);
    if (!['askFood', 'pickCategory', 'askBudget', 'search'].includes(s.step)) s.step = 'askFood';
    s.chosen = s.chosen.filter(validOption).slice(0, 3);
    s.pending = Array.isArray(s.pending) ? s.pending.filter(validOption).slice(0, 5) : null;
    const validLine = item => typeof item?.menuId === 'string' && Number.isInteger(item.qty) && item.qty >= 1 && item.qty <= 20;
    s.lastRecommendations = Array.isArray(s.lastRecommendations) ? s.lastRecommendations.slice(0, 36).filter(item =>
      typeof item?.storeId === 'string' && validLine(item) &&
      (item.items == null || (Array.isArray(item.items) && item.items.length <= 2 && item.items.every(validLine)))) : [];
    if (typeof s.preferredMenu !== 'string') s.preferredMenu = null;
    const inputCond = s.cond;
    s.cond = freshCond();
    setCond(s, inputCond, true);
    s.questions = Number(s.questions) || 0;
    s.cheapBoost = Math.min(Math.max(Number(s.cheapBoost) || 1, 1), 1.5);
    return s;
  }

  function resetSearch(state) {
    Object.assign(state, { awaitingRegion: false, chosen: [], questions: 0, asked: [], pending: null, seen: [], excludeSeen: false, cheapBoost: 1, lastMin: null, lastTop: [], lastRecommendations: [], preferredMenu: null, expand: false, cheaper: false });
  }

  function setCond(state, next, rehydrate = false) {
    const prev = state.cond;
    const c = { ...prev };
    for (const k of ['menu', 'dish', 'store', 'people', 'budget', 'budget_unit', 'price_pref', 'taste', 'franchise', 'exclude', 'sub', 'goodPrice', 'anyMenu',
      'eaten', 'avoid', 'meal_time', 'season', 'season_auto', 'delivery_tip_max', 'min_rating', 'new_store', 'situation', 'sameStore']) if (k in next) c[k] = next[k];
    // 맥락 조건 정리
    const foodItem = (x, withMeal) => {
      if (!x || typeof x !== 'object') return null;
      const menu = CATEGORIES.includes(normalizeCategory(x.menu)) ? normalizeCategory(x.menu) : null;
      const dish = typeof x.dish === 'string' && x.dish.trim() ? x.dish.trim().slice(0, 20) : null;
      const ingredient = !withMeal && Object.hasOwn(AVOID_INGREDIENTS, x.ingredient ?? '') ? x.ingredient : null;
      if (!menu && !dish && !ingredient) return null;
      if (withMeal) return { meal: MEAL_ENUM.includes(x.meal) ? x.meal : null, menu, dish };
      return ingredient ? { menu: null, dish: null, ingredient } : { menu, dish };
    };
    const uniqueFoods = list => [...new Map(list.map(x => [compact(x.dish || x.menu || x.ingredient), x])).values()].slice(-8);
    c.eaten = Array.isArray(c.eaten) ? uniqueFoods(c.eaten.map(x => foodItem(x, true)).filter(Boolean)) : [];
    c.avoid = Array.isArray(c.avoid) ? uniqueFoods(c.avoid.map(x => foodItem(x, false)).filter(Boolean)) : [];
    // 피하겠다던 음식을 직접 다시 원하면 그 "피하기"는 푼다
    if (next.menu) c.avoid = c.avoid.filter(a => a.dish || a.menu !== next.menu);
    if (next.dish) c.avoid = c.avoid.filter(a => !sameDish(a.dish, next.dish));
    if (!MEAL_TIME_ENUM.includes(c.meal_time)) c.meal_time = null;
    if (!SEASON_ENUM.includes(c.season)) c.season = null;
    c.season_auto = !!c.season && c.season_auto === true;
    c.delivery_tip_max = Number.isInteger(c.delivery_tip_max) && c.delivery_tip_max >= 0 && c.delivery_tip_max <= 20000 ? c.delivery_tip_max : null;
    c.min_rating = Number.isFinite(c.min_rating) && c.min_rating > 0 && c.min_rating <= 5 ? Math.round(c.min_rating * 10) / 10 : null;
    if (!['none', 'prefer', 'allow'].includes(c.new_store)) c.new_store = 'none';
    c.situation = Array.isArray(c.situation) ? [...new Set(c.situation.filter(k => SITUATIONS.some(x => x.key === k)))] : [];
    c.sameStore = c.sameStore === true;
    c.goodPrice = c.goodPrice === true;
    if (next.menu || next.dish) c.anyMenu = false; // 음식을 정하면 "아무거나"는 끝
    c.anyMenu = c.anyMenu === true;
    // 카테고리가 바뀌면 세부 메뉴 선택도 처음부터
    if ('menu' in next && next.menu !== prev.menu && !('sub' in next)) c.sub = null;
    c.sub = c.sub === '' ? '' : subRegex(c.menu, c.sub) ? c.sub : null;
    // 고른 세부 메뉴를 "빼기"로 막고 있으면 풀어 준다 (예: 닭강정 선택 ↔ 닭강정 제외)
    if (c.sub && 'sub' in next) c.exclude = (c.exclude ?? []).filter(w => !subRegex(c.menu, c.sub).test(w));
    // 업종이 바뀌면 그 업종용 "빼기"는 의미가 없다
    if ('menu' in next && next.menu !== prev.menu && !('exclude' in next)) c.exclude = [];
    c.exclude = Array.isArray(c.exclude) ? [...new Set(c.exclude.filter(w => typeof w === 'string' && w.trim()).map(w => w.trim().slice(0, 20)))].slice(0, 5) : [];
    if (!CATEGORIES.includes(c.menu)) c.menu = null;
    for (const k of ['dish', 'store']) c[k] = typeof c[k] === 'string' ? c[k].trim().slice(0, 80) || null : null;
    if (/^(?:너가|네가|니가|당신이)$/.test(c.dish ?? '')) c.dish = null;
    if ('foods' in next || 'menu' in next || 'dish' in next || 'store' in next) {
      c.foods = Array.isArray(next.foods) ? next.foods.slice(0, 3).flatMap(food => {
        const menu = CATEGORIES.includes(food?.menu) ? food.menu : null;
        const dish = typeof food?.dish === 'string' ? food.dish.trim().slice(0, 80) || null : null;
        // 사람별 맛("나는 매운 거, 친구는 안 매운 거")은 음식 항목마다 맛을 따로 둔다
        const taste = Array.isArray(food?.taste) ? [...new Set(food.taste.map(canonTaste))].slice(0, 4) : null;
        return menu || dish || taste?.length ? [{ menu, dish, ...(taste?.length ? { taste } : {}) }] : [];
      }) : [];
    }
    c.people = Number.isInteger(c.people) && c.people > 0 && c.people <= 20 ? c.people : null;
    c.budget = Number.isFinite(c.budget) && c.budget > 0 ? Math.round(c.budget) : null;
    const floor = next.budget_floor ?? ('budget' in next ? null : prev.budget_floor);
    c.budget_floor = Number.isInteger(floor) && floor > 0 && floor <= c.budget ? floor : null;
    if (!['total', 'per_person'].includes(c.budget_unit)) c.budget_unit = 'total';
    if (!['none', 'cheap', 'any'].includes(c.price_pref)) c.price_pref = 'none';
    // 맛은 표준어로만 저장한다 (AI가 '매콤'을 돌려줘도 '매운' 하나)
    c.taste = Array.isArray(c.taste) ? [...new Set(c.taste.map(t => canonTaste(t)).filter(Boolean))].slice(0, 8) : [];
    if (c.taste.includes(MILD)) c.taste = c.taste.filter(t => t !== SPICY);
    if (!['none', 'exclude', 'only'].includes(c.franchise)) c.franchise = 'none';
    if ('budget_under' in next || c.budget !== prev.budget || c.budget_unit !== prev.budget_unit) c.budget_under = !!next.budget_under;
    if (rehydrate) { state.cond = c; return; }
    if (JSON.stringify(c) !== JSON.stringify(prev)) resetSearch(state);
    state.cond = c; state.pending = null; state.excludeSeen = false; state.cheapBoost = 1;
  }

  // ---------- 1.5단계: 수량·기준가·가격 모드 ----------
  function ctx(state, alternatives = false) {
    const c = state.cond, people = c.people || 1;
    const exact = !alternatives && !!(c.dish || c.store);
    const primaryMenus = s => {
      if (exact && c.dish) return menuGroups.get(s.id).filter(m => dishMatches(c.dish, m.name));
      if (!c.menu && !exact && (isGroupMeal(c) || isGroupPick(c)) && NOT_GROUP_MEAL.includes(s.category)) return [];
      if (!c.menu && !exact && c.anyMenu && ['카페·디저트', '편의점'].includes(s.category)) return [];
      if (!exact && people > 1) return mains[s.id].filter(m => !sideOrDrink.test(compact(m.name)));
      return exact && c.store && !mains[s.id].length ? menuGroups.get(s.id) : mains[s.id];
    };
    const shareable = (m, s) => menuPortion(m, s.category).servings >= 2;
    const sub = !exact && c.sub ? subRegex(c.menu, c.sub) : null;
    const blocked = m => c.avoid.some(a => (a.dish && (DISH_BLOCK[a.dish] ? DISH_BLOCK[a.dish].test(m.name) : dishMatches(a.dish, m.name))) ||
        (a.ingredient && AVOID_INGREDIENTS[a.ingredient].test(menuText(m))) ||
        (a.menu && !a.dish && a.menu !== c.menu && categoryPattern(a.menu)?.test(m.name))) ||
      c.eaten.some(e => e.dish && !sameDish(e.dish, c.dish) && dishMatches(e.dish, m.name));
    const strictTastes = [...new Set([...c.taste, ...state.chosen.map(choice => choice.label)])]
      .filter(term => term === MILD || CHICKEN_CUTS.includes(term));
    const meetsStrictTastes = (menu, store) => strictTastes.every(term => tasteOk(menu, term, store));
    const items = s => primaryMenus(s).filter(m => !isExcluded(m, c.exclude) && (!isGroupPick(c) || shareable(m, s)) &&
      (!sub || sub.test(m.name)) && !blocked(m) && meetsStrictTastes(m, s) &&
      (!c.taste.includes(EXTRA_CHEESE) || menuEvidence(m, EXTRA_CHEESE)));
    const plansByStore = new Map();
    const plans = store => {
      if (plansByStore.has(store.id)) return plansByStore.get(store.id);
      const mainMenus = items(store);
      const otherMeals = people > 1 ? menuGroups.get(store.id).filter(menu =>
        !sideOrDrink.test(compact(menu.name)) && mainMenuFor(store.category, menu) && !isExcluded(menu, c.exclude) &&
        (!isGroupPick(c) || shareable(menu, store)) && (!sub || sub.test(menu.name)) && !blocked(menu) && meetsStrictTastes(menu, store)) : [];
      const portions = new Map([...mainMenus, ...otherMeals].map(menu => [menu.id, menuPortion(menu, store.category)]));
      const options = [];
      const add = (menu, qty, other, otherQty) => {
        const lines = [{ menu, qty }];
        if (other) lines.push({ menu: other, qty: otherQty });
        const subtotal = lines.reduce((sum, line) => sum + line.menu.price * line.qty, 0);
        if (subtotal < store.minOrder) return;
        const servings = lines.reduce((sum, line) => sum + portions.get(line.menu.id).servings * line.qty, 0);
        options.push({
          menu, qty, lines, total: subtotal + store.tip, servings,
          estimated: lines.some(line => portions.get(line.menu.id).estimated),
          extraServings: servings - people,
        });
      };
      for (const menu of mainMenus) {
        const portion = portions.get(menu.id).servings;
        add(menu, Math.ceil(people / portion));
        if (portion >= people) continue;
        for (const other of otherMeals) {
          if (other.id === menu.id) continue;
          for (let qty = 1; qty * portion < people; qty += 1) {
            add(menu, qty, other, Math.ceil((people - qty * portion) / portions.get(other.id).servings));
          }
        }
      }
      plansByStore.set(store.id, options);
      return options;
    };
    const totalBudget = c.budget == null ? null : c.budget * (c.budget_unit === 'per_person' ? people : 1) - Number(c.budget_under);
    const budgetFloor = (c.budget_floor || 0) * (c.budget_unit === 'per_person' ? people : 1);
    const fitsBudget = (total, cap = totalBudget) => cap == null || (total >= budgetFloor && total <= cap);
    // 업종 안의 변형 메뉴(치킨의 닭강정 등). 손님이 메뉴를 직접 말했으면 구분하지 않는다
    const variantWords = c.dish ? [] : VARIANTS[c.menu] ?? [];
    const isVariant = plan => plan.lines.some(line => isExcluded(line.menu, variantWords));
    // 가게를 대표하는 주문안: 조건(예산)에 맞는 업종 대표 메뉴 → 없으면 맞는 변형 메뉴 → 없으면 전체
    const signaturePlans = (s, budgeted = true) => {
      const all = plans(s);
      const fits = budgeted ? all.filter(plan => fitsBudget(plan.total)) : all;
      const main = fits.filter(plan => !isVariant(plan));
      return main.length ? main : fits.length ? fits : all;
    };
    const minTotal = s => signaturePlans(s).reduce((lowest, plan) => Math.min(lowest, plan.total), Infinity);
    const mode = c.budget != null ? 'budget' : c.price_pref === 'any' ? 'any' : c.price_pref === 'cheap' ? 'cheap' : 'value';
    // 비교 가격: 가성비·예산은 받는 양 대비(1인분당, 배달비 포함). 예산은 총액으로 상한만 거른다.
    // 싸게는 실제로 내는 총액이 낮은 순.
    const perServing = mode === 'value' || mode === 'budget';
    // 남는 양은 인원의 약 1.5배까지만 인정 (혼자: 2인분까지 → 치킨 한 마리는 공정하게, 족발(중)·감자탕(중)은 과한 양)
    const usableServings = Math.max(people + 1, Math.ceil(people * 1.5));
    const cost = plan => perServing ? Math.round(plan.total / Math.max(people, Math.min(plan.servings, usableServings))) : plan.total;
    const minCost = s => signaturePlans(s).reduce((lowest, plan) => Math.min(lowest, cost(plan)), Infinity);
    // 기준가: 영업·프랜차이즈 무관, 같은 동+업종 → 5곳 미만이면 3개 동 → 그래도 5곳 미만이면 없음
    let pool = stores.filter(s => s.category === c.menu && inArea(s, state));
    if (pool.length < 5) pool = stores.filter(s => s.category === c.menu);
    // 동네 보통 가격은 손님 예산과 무관하게 같은 기준(업종 대표 메뉴)으로 잡는다
    const baseCost = s => signaturePlans(s, false).reduce((lowest, plan) => Math.min(lowest, cost(plan)), Infinity);
    const base = pool.length >= 5 ? median(pool.map(baseCost).filter(Number.isFinite)) : null;
    const baseByCategory = new Map();
    const baseFor = s => {
      if (c.menu) return base;
      if (!baseByCategory.has(s.category)) {
        let same = stores.filter(t => t.category === s.category && inArea(t, state));
        if (same.length < 5) same = stores.filter(t => t.category === s.category);
        baseByCategory.set(s.category, same.length >= 5 ? median(same.map(baseCost).filter(Number.isFinite)) : null);
      }
      return baseByCategory.get(s.category);
    };
    const rated = stores.filter(s => inArea(s, state) && s.rating != null);
    const avgRating = rated.length ? rated.reduce((a, s) => a + s.rating, 0) / rated.length : 4.3;
    return { plans, items, exact, people, base, totalBudget, budgetFloor, fitsBudget, mode, avgRating, minTotal, cost, minCost, isVariant, baseFor };
  }

  // ---------- 2단계: 필터 ----------
  function filterStores(state, x, o = {}) {
    const c = { ...state.cond, ...o.cond };
    const chosen = o.chosen ?? state.chosen;
    const seen = (o.excludeSeen ?? state.excludeSeen) ? state.seen : [];
    const tb = o.totalBudget ?? x.totalBudget;
    return stores.filter(s => inArea(s, state) && (!c.menu || s.category === c.menu)
      && (!x.exact || !c.store || matchesStore(c.store, s))
      && !(c.franchise === 'exclude' && s.franchise) && !(c.franchise === 'only' && !s.franchise)
      && (!c.goodPrice || s.is_good_price === true)
      && (c.delivery_tip_max == null || s.tip <= c.delivery_tip_max)
      && !c.avoid.some(a => a.menu && !a.dish && a.menu === s.category && c.menu !== s.category)
      && (c.min_rating == null || (s.rating == null ? c.new_store !== 'none' : s.rating >= c.min_rating))
      && (x.mode !== 'cheap' || x.baseFor(s) == null || x.minCost(s) <= x.baseFor(s) * (o.cheapBoost ?? state.cheapBoost))
      && x.plans(s).some(plan => o.ignoreBudget || x.fitsBudget(plan.total, tb))
      && (s.rating == null || s.rating >= 3.5)
      && !seen.includes(s.id)
      && chosen.every(ch => ch.store_ids.includes(s.id)));
  }

  // ---------- 맥락 점수 (소프트): 계절 근거, 오늘 먹은 카테고리, 끼니 ----------
  const seasonOf = (menu, c) => {
    const hint = SEASON_HINTS[c.season];
    if (!hint) return 0;
    const text = [menu.name, ...menuFacts(menu).map(([, value]) => value), menu.desc ?? ''].join(' ');
    return hint.boost.test(text) ? 1 : hint.penalty?.test(text) ? -1 : 0;
  };
  function contextScore(store, menu, c) {
    let score = 0;
    const season = seasonOf(menu, c);
    if (season > 0) score += CONTEXT_WEIGHTS.seasonBoost;
    if (season < 0) score += CONTEXT_WEIGHTS.seasonPenalty;
    if (c.menu !== store.category && c.eaten.some(e => e.menu === store.category)) score += CONTEXT_WEIGHTS.eatenCategory;
    if ((c.meal_time === 'lunch' || c.meal_time === 'dinner') && c.menu !== store.category && ['카페·디저트', '편의점'].includes(store.category)) score += CONTEXT_WEIGHTS.mealCafe;
    if (c.meal_time === 'late_night' && store.category === '야식') score += CONTEXT_WEIGHTS.lateNightBoost;
    for (const key of c.situation ?? []) {
      const x = SITUATIONS.find(item => item.key === key);
      if (x?.categories?.includes(store.category) || x?.tastes?.some(term => menuEvidence(menu, term))) score += SITUATION_WEIGHT;
    }
    if (c.new_store === 'prefer' && (store.rating == null || store.review_count === 0)) score += CONTEXT_WEIGHTS.newStoreBoost;
    return score;
  }

  // ---------- 5단계: 점수 ----------
  function priceScore(total, x, s) {
    const base = s ? x.baseFor(s) : x.base;
    // 가성비·예산은 1인분당, 싸게는 총액을 같은 기준의 동네 보통 가격(base)과 비교. 예산은 상한으로만 쓴다.
    if (x.mode !== 'any' && base) return clamp((base * 1.2 - total) / (base * 0.4));
    if (x.mode === 'budget' && x.totalBudget > 0) { const cap = x.totalBudget / x.people; return clamp((cap - total) / (cap * 0.3)); }
    return 0.5;
  }
  // 보정 별점: 리뷰가 적을수록 동네 평균 쪽으로 당긴다. 리뷰 수 데이터가 없으면 원래 별점.
  const RATING_PRIOR_REVIEWS = 10;
  function adjustedRating(s, avg) {
    const n = s.review_count;
    if (s.rating == null || n === 0) return avg;
    if (n == null) return s.rating;
    return (n * s.rating + RATING_PRIOR_REVIEWS * avg) / (n + RATING_PRIOR_REVIEWS);
  }
  function ratingScore(s, avg) {
    return clamp((adjustedRating(s, avg) - 3.5) / 1.5);
  }

  // ---------- AI 실패 시 코드만으로 판단 (메뉴 이름·설명 키워드) ----------
  function menuEvidence(menu, term) {
    const fields = [['메뉴명', menu.name], ...menuFacts(menu), ['메뉴 설명', menu.desc]];
    if (CHICKEN_CUTS.includes(term)) {
      for (const [source, value] of fields) {
        const cut = chickenCut(value);
        if (cut) return cut === term ? source : undefined;
      }
      return;
    }
    if (term === MILD && fields.some(([, value]) => hasSpicyWords(value))) return;
    if (term === EXTRA_CHEESE && fields.some(([, value]) => cheeseAmountDenied.test(value))) return;
    const matches = tasteMatching.get(term);
    if (matches) return fields.find(([, value]) => matches(value))?.[0];
    const alias = tasteAliases.get(term) ?? TASTE_EVIDENCE.get(term);
    if (alias) return fields.find(([, value]) => alias.test(value))?.[0];
    const key = compact(term);
    return key ? fields.find(([, value]) => compact(value).includes(key))?.[0] : undefined;
  }

  // 맛 조건 충족: 안 매운은 치킨이면 '안 매운' 표기가 있어야 하고(팀 규칙), 그 밖의 업종은 매운 근거가 없으면 충족
  function tasteOk(menu, term, store) {
    if (term === MILD) return store?.category === '치킨' ? !!menuEvidence(menu, MILD)
      : ![menu.name, ...menuFacts(menu).map(([, v]) => v), menu.desc].some(v => hasSpicyWords(v ?? ''));
    if (CHICKEN_CUTS.includes(term) && store && store.category !== '치킨') return true;
    return !!menuEvidence(menu, term);
  }
  const categoryPattern = category => MENU_WORDS.find(([name]) => name === category)?.[1] ?? null;

  const menuHint = (menu, maxChars) => [...menuFacts(menu).map(([, value]) => value), menu.desc].filter(Boolean).join(' · ').slice(0, maxChars);

  function menuReason(menu, terms) {
    const term = [MILD, EXTRA_CHEESE, ...CHICKEN_CUTS].find(label => terms.includes(label)) ?? terms[0];
    return term ? `${menuEvidence(menu, term)}에서 ‘${term}’ 조건을 확인했어요.` : '';
  }
  // terms의 각 항목은 단어 하나, 또는 "이 중 하나면 됨" 단어 배열 (비슷한 맛 대체용)
  function keywordJudge(ms, terms) {
    if (!terms.length) return { match: '맞음', menu_ids: ms.slice(0, 5).map(m => m.id) };
    const hits = m => terms.map(t => [t].flat().find(w => menuEvidence(m, w))).filter(Boolean);
    const best = Math.max(0, ...ms.map(m => hits(m).length));
    if (!best) return { match: '안 맞음', menu_ids: [] };
    const top = ms.filter(m => hits(m).length === best);
    return {
      match: best === terms.length ? '맞음' : '일부',
      menu_ids: top.slice(0, 5).map(m => m.id),
    };
  }

  // 원하는 맛의 메뉴가 없을 때 대신 찾아볼 비슷한 맛 [제안 · 리허설에서 조정]
  const SIMILAR = {
    크림: ['로제', '크리미', '치즈', '갈릭', '마늘'], 로제: ['크림', '크리미', '치즈'], 치즈: ['크림', '모짜렐라', '체다', '로제'],
    매운: ['매콤', '양념', '마라', '칼칼', '얼큰', '청양', '얼얼'], 마라: ['얼얼', '매운', '칼칼'], 칼칼: ['얼큰', '매콤', '짬뽕'], 얼큰: ['칼칼', '매콤'],
    간장: ['마늘', '데리야끼'], 마늘: ['갈릭', '간장'], 달콤: ['양념', '꿀', '단짠', '달큰'], 양념: ['달콤', '매콤'],
    담백: ['후라이드', '맑', '깔끔'], 바삭: ['튀김', '크리스피', '겉바속촉'], 불향: ['불맛', '화덕', '직화'], 해물: ['해산물', '새우', '오징어', '홍합'],
    트러플: ['버섯', '머쉬룸'],
  };

  const TASTES = ['간장', '양념', '치즈', '로제', '짜장', '짬뽕', '마라', '반반', '해물', '크림', '화덕', '세트'];
  const MENU_WORDS = [
    // 상황 표현(해장하고 싶어서·야식으로)은 readContext가 먼저 떼어 내므로 여기서 업종을 정하지 않는다
    ['치킨', /치킨|통닭|후라이드|닭강정/], ['중식', /중식|중국|짜장|짬뽕|탕수육|마라|꿔바로우/],
    ['분식', /분식|떡볶이|엽떡|김밥|순대|라볶이/], ['피자', /피자/],
    ['한식', /한식|국밥|해장국|제육|비빔밥|찌개|갈비탕|찜|탕(?!수)|집밥|백반|불백/], ['카페·디저트', /카페|디저트|커피|케이크|빵|베이커리|마카롱|크로플|와플|빙수/],
    ['일식', /일식|초밥|스시|우동|돈가스|돈까스|라멘|사시미|오마카세/], ['양식', /양식|파스타|스테이크|리소토/],
    ['아시안', /아시안|동남아|베트남|태국|쌀국수|팟타이|분짜|월남쌈|나시고랭|커리|카레/], ['고기·구이', /고기[·/ ]구이|(?<![불소])고기|삼겹|목살|항정|갈비(?!탕)/],
    ['패스트푸드', /패스트푸드|햄버거|버거/], ['족발·보쌈', /족발|보쌈/], ['야식', /곱창|막창|대창|닭발|오돌뼈|야식/],
    ['도시락·죽', /도시락|(?:^|[\s가-힣])죽(?!고\s*싶|겠|을\s*것|어)/], ['샐러드', /샐러드|포케/], ['편의점', /편의점/],
  ];
  // ---------- 오타 바로잡기 (자모 단위 편집 거리) ----------
  const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ', JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ', JONG = ' ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ';
  const jamo = s => [...s].map(ch => {
    const c = ch.charCodeAt(0) - 0xac00;
    return c < 0 || c > 11171 ? ch : CHO[(c / 588) | 0] + JUNG[((c % 588) / 28) | 0] + (c % 28 ? JONG[c % 28] : '');
  }).join('');
  // 소리가 비슷한 자모끼리는 0.5 (치긴→치킨, 깐장→간장, 피짜→피자, 프렌→프랜, 저럼→저렴), ㅇ 넣고 빼기도 0.5 (두리서→둘이서)
  const ALIKE = ['ㄱㄲㅋ', 'ㄷㄸㅌ', 'ㅂㅃㅍ', 'ㅅㅆ', 'ㅈㅉㅊ', 'ㅐㅔ', 'ㅒㅖ', 'ㅙㅞㅚ', 'ㅓㅕ', 'ㅏㅑ', 'ㅗㅛ', 'ㅜㅠ'];
  const subCost = (x, y) => (x === y ? 0 : ALIKE.some(g => g.includes(x) && g.includes(y)) ? 0.5 : 1);
  const gapCost = x => (x === 'ㅇ' ? 0.5 : 1);
  function lev(a, b) {
    let prev = [0];
    for (let j = 1; j <= b.length; j++) prev[j] = prev[j - 1] + gapCost(b[j - 1]);
    for (let i = 1; i <= a.length; i++) {
      const cur = [prev[0] + gapCost(a[i - 1])];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + gapCost(a[i - 1]), cur[j - 1] + gapCost(b[j - 1]), prev[j - 1] + subCost(a[i - 1], b[j - 1]));
      prev = cur;
    }
    return prev[b.length];
  }
  // ponytail: 아는 단어 목록과 같은 음절 수 구간만, 소리 비슷한 오타만 교체(2음절 0.5 · 3~4음절 1 · 5음절 1.5). 메뉴 데이터 문장 374개로 오탐 0 확인.
  // 흔한 다른 단어와 헷갈리는 말(한식↔간식, 반반↔반찬 등)은 목록에서 뺐다. 더 넓은 오타는 Claude(AI ①)가 맡는다.
  const FUZZY = ['프랜차이즈', '꿔바로우', '후라이드', '처음부터', '떡볶이', '라볶이', '탕수육', '닭강정', '감자탕', '둘이서', '셋이서', '넷이서', '가성비',
    '치킨', '피자', '짜장', '짬뽕', '김밥', '순대', '분식', '중식', '찜닭', '국밥', '간장', '양념', '마늘', '바삭', '순살', '매운', '매콤', '치즈', '로제',
    '국물', '담백', '불향', '해물', '얼큰', '칼칼', '달콤', '화덕', '저렴'].map(w => [w, jamo(w)]);
  function fixTypos(text) {
    let s = String(text);
    const locked = new Array(s.length).fill(false); // 이미 맞게 쓴 단어 안쪽은 건드리지 않는다 (프랜차이즈의 '이즈'→치즈 방지)
    const lock = (i, n) => locked.fill(true, i, i + n);
    for (const [w] of FUZZY) for (let i = s.indexOf(w); i >= 0; i = s.indexOf(w, i + 1)) lock(i, w.length);
    for (const [w, wj] of FUZZY) {
      const max = w.length <= 2 ? 0.5 : w.length <= 4 ? 1 : 1.5;
      for (let i = 0; i + w.length <= s.length; i++) {
        const win = s.slice(i, i + w.length);
        if (locked.slice(i, i + w.length).some(Boolean) || !/^[가-힣]+$/.test(win) || lev(jamo(win), wj) > max) continue;
        s = s.slice(0, i) + w + s.slice(i + w.length);
        lock(i, w.length);
      }
    }
    return s;
  }

  function readArea(text) {
    const broad = text.match(/(?:지역|동네)\s*(?:은|는|도)?\s*(?:상관\s*없|무관|아무|어디든)|(?:다른|주변)\s*(?:지역|동네|구)\s*(?:도|까지|에서|로|검색|괜찮|상관|추천|넓혀)|서울\s*(?:전체|전역|어디든)|어느\s*(?:지역|동네)든|어디(?:든|라도)\s*(?:괜찮|좋아)/);
    const hits = [];
    let excludedRegion = null;
    const add = (label, dong, neighborhood) => {
      const at = text.lastIndexOf(label);
      if (at < 0) return;
      if (/^\s*(?:에서(?:는)?|은|는|을|를|도)?\s*(?:말고|빼고|제외)/.test(text.slice(at + label.length))) {
        excludedRegion = dong;
        return;
      }
      hits.push({ dong, neighborhood, at, label });
    };
    for (const region of regions) {
      if (text.includes(region)) add(region, region, null);
      else if (region.endsWith('구')) {
        const short = region.slice(0, -1);
        if (text.match(new RegExp(`(?:^|\\s)${short}(?:으로|에서|쪽|로|\\s|$)`))) add(short, region, null);
      }
    }
    for (const [area, parents] of areas) {
      if (!area || !text.includes(area)) continue;
      const parent = [...parents].find(r => hits.some(hit => hit.dong === r && !hit.neighborhood));
      if (parent || parents.size === 1) add(area, parent || [...parents][0], area);
    }
    const missing = [...text.matchAll(/(?:^|\s)([가-힣]{2,10}구|[가-힣]{1,10}\d*동)(?=\s*(?:으로|에서|에도|에는|이랑|쪽|으로는|으로도|로|에\s|도\s|만\s|[?!.,]|$))/g)]
      .filter(([, label]) => !regions.includes(label) && !areas.has(label) && !['다른동', '같은동'].includes(label)).at(-1);
    const hit = hits.sort((a, b) => (b.at + b.label.length) - (a.at + a.label.length) || b.label.length - a.label.length)[0];
    if (broad && !hit && !missing) return { dong: ALL_REGIONS, neighborhood: null, excludedRegion };
    return missing && (!hit || missing.index > hit.at) ? { missing: missing[1] } : hit;
  }

  const catalogDishes = new Map();
  for (const s of stores) {
    for (const m of menuGroups.get(s.id)) {
      const key = compact(m.name);
      if (key.length < 3 || CATEGORIES.some(category => compact(category) === key)) continue;
      const item = catalogDishes.get(key) || { name: m.name, categories: new Set() };
      item.categories.add(s.category);
      catalogDishes.set(key, item);
    }
  }
  const dishEntries = [...catalogDishes].sort(([a], [b]) => b.length - a.length);

  function readFood(raw) {
    const either = raw.match(/([가-힣]{1,8}?)(?:이나|나)\s+([가-힣]{1,8})/);
    if (either) {
      const [a, b] = [either[1], either[2]].map(word => readFood(word.replace(/(?:이나|나)$/, '')));
      if (a?.menu && a.menu === b?.menu) return { menu: a.menu, dish: null, text: raw, either: true };
    }
    const parts = raw.split(/\s*(?:대신(?:에)?|말고|아니라|아니[, ]+)\s*/);
    for (const part of parts.reverse()) {
      const text = fixTypos(part);
      const key = compact(part);
      const normalized = compact(text);
      const variant = key.match(TTEOKBOKKI_VARIANT)?.[0] ?? normalized.match(TTEOKBOKKI_VARIANT)?.[0];
      const named = dishEntries.find(([name]) => key.includes(name) && (!variant || name.includes(variant)))?.[1];
      const known = DISH_ALIASES.map(pattern => normalized.match(pattern)).filter(Boolean).sort((a, b) =>
        (b.index + b[0].length) - (a.index + a[0].length) || b[0].length - a[0].length)[0]?.[0];
      const category = MENU_WORDS.map(([name, pattern]) => [name, text.match(pattern)]).filter(([, match]) => match)
        .sort(([, a], [, b]) => b[0].length - a[0].length || b.index - a.index)[0]?.[0];
      const clauses = part.split(/(?:에서(?:는)?|으로\s*바꾸고|로\s*바꾸고|바꿔서|[,.;!?])\s*/);
      const lastFoodClause = clauses.findLast(clause => MENU_WORDS.some(([, pattern]) => pattern.test(clause)));
      const localText = withoutDishModifiers(lastFoodClause ?? part);
      const literal = localText.match(/^([가-힣A-Za-z\d]+(?:\s+[가-힣A-Za-z\d]+){0,2}?)\s*(?:이|가|을|를)?\s+(?:먹고\s*싶|추천해|찾아)/)?.[1] ||
        localText.match(/^([가-힣A-Za-z\d]+(?:\s+[가-힣A-Za-z\d]+){0,2})$/)?.[1];
      const literalFood = literal && category && !cheeseRequest.test(literal) && !readArea(literal) && compact(literal) !== compact(category) &&
        /(?:치킨|피자|탕|찌개|찜|스테이크|파스타|우동|라멘|국밥|김밥|초밥|짜장면|짬뽕|떡볶이)$/.test(compact(literal)) &&
        !/^(?:양|가격|예산)|[은는한]\s/.test(literal) ? literal : null;
      const menu = named?.categories.size === 1 ? [...named.categories][0] : variant ? '분식' : category ?? null;
      const dish = variant ? named?.name ?? variant
        : literalFood || (named && compact(withoutDishModifiers(named.name)) !== compact(menu) ? named.name : null) || known;
      if (dish || menu) return { menu, dish: dish ?? null, text };
    }
    return null;
  }

  function readFoodList(text) {
    const parts = text.split(/(?:이랑|하고|(?:랑|와|과)(?=\s)|\s및\s|\s그리고\s|,\s+|\s*[＋+]\s*)/);
    if (parts.length < 2) return [];
    const foods = parts.flatMap(part => {
      const food = readFood(part);
      return food ? [{ menu: food.menu, dish: food.dish }] : [];
    });
    return [...new Map(foods.map(food => [compact(food.dish || food.menu), food])).values()].slice(0, 3);
  }

  // "먹은 것" 절을 먼저 떼어낸다. rest만 원하는 음식 판정(readFood·가게 이름·AI dish 검사)에 쓴다.
  function splitEatenClauses(text) {
    const eaten = [];
    const cuts = [];
    let prevEnd = 0;
    for (const m of text.matchAll(EATEN_VERB)) {
      const before = text.slice(prevEnd, m.index);
      // 절 시작: 끼니·시점 말이 있으면 거기서, 없으면 마지막 구분자(쉼표·마침표) 뒤의 마지막 두 단어
      const boundary = Math.max(before.lastIndexOf(','), before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?')) + 1;
      const segment = before.slice(boundary);
      const marker = [...segment.matchAll(EATEN_MARKER)].at(-1);
      const start = prevEnd + boundary + (marker ? marker.index : Math.max(0, segment.trimEnd().split(/\s+/).slice(0, -2).join(' ').length));
      const clause = text.slice(start, m.index);
      const food = readFood(clause);
      const word = clause.trim().match(/([가-힣A-Za-z]+?)(?:을|를|이|가|은|는|도)?$/)?.[1];
      if (food) {
        // 음식 이름은 마지막 낱말만 (예: "아침에 국밥" → 국밥), 카테고리 이름 그 자체(치킨 등)는 구체 음식이 아니다
        const last = (food.dish ?? word ?? '').trim().split(/\s+/).at(-1).replace(/(?:을|를|이|가|은|는|도)$/, '');
        const dish = !last || GENERIC_FOOD.test(compact(last)) || (marker && last === marker[1]) ? null : last;
        eaten.push({ meal: marker ? EATEN_MEAL[marker[1]] ?? null : null, menu: food.menu ?? null, dish });
        cuts.push([start, m.index + m[0].length]);
      }
      prevEnd = m.index + m[0].length;
    }
    let rest = text;
    for (const [a, b] of cuts.reverse()) rest = rest.slice(0, a) + ' ' + rest.slice(b);
    return { eaten, rest: rest.replace(/^[\s,.]+/, '').replace(/\s+/g, ' ').trim() };
  }

  // 빼달라는 말 → 빼기 항목. 업종(menu)·메뉴(dish)·재료(ingredient) 중 하나. 모르는 말이면 null.
  function avoidItem(word) {
    // 조사를 떼기 전 말부터 본다 ("떡볶이"의 '이'는 조사가 아니다)
    for (const w of [word.trim(), word.trim().replace(/\s*(?:은|는|이|가|도|을|를)$/, '').trim()]) {
      if (!w || NOT_AVOID.test(w)) return null;
      for (const [re, item] of AVOID_WORDS) if (re.test(w)) return { ...item };
      const food = readFood(w);
      if (food) return { menu: food.dish ? null : food.menu ?? null, dish: food.dish && !GENERIC_FOOD.test(compact(food.dish)) ? food.dish : null };
    }
    return null;
  }
  const AVOID_CLAUSE = new RegExp(String.raw`(^|[\s,.!?])((?:[가-힣A-Za-z]{1,10}\s)?[가-힣A-Za-z]{1,10}(?:\s*(?:거|것|음식|종류|요리))?)\s*(?:은|는|이|가|도|을|를)?\s*` + NEG + String.raw`[가-힣]*`, 'g');
  const SEASON_PHRASE = /날(?:이|씨가)?\s*(?:추워서|추운데|더워서|더운데|쌀쌀해서|추우니까|더우니까)|비\s*오는\s*날(?:이라|인데)?|비(?:가)?\s*(?:와서|오니까|오는데|오니)/g;

  // 맥락 조건: 먹은 것·피할 것·끼니·계절·상황·배달팁. 반환한 rest에는 먹은 것·피할 것·상황·배달팁 표현이 빠져 있다.
  function readContext(text) {
    const rules = {};
    let { eaten, rest } = splitEatenClauses(text);
    if (eaten.length) rules.eaten = eaten;
    // 배달팁 (예산 금액으로 잘못 읽히지 않게 먼저 뺀다)
    const tipMax = rest.match(TIP_MAX);
    if (TIP_FREE.test(rest)) { rules.delivery_tip_max = 0; rest = rest.replace(TIP_FREE, ' '); }
    else if (tipMax) { rules.delivery_tip_max = parseAmount(tipMax[1].includes('원') ? tipMax[1] : tipMax[1] + '원'); rest = rest.replace(tipMax[0], ' '); }
    // 별점 조건의 숫자가 예산으로 읽히지 않게 (예: "별점 4.5 이상")
    // 피할 음식 ("피자는 안 돼", "고기 못 먹어", "회 말고."). "A 말고 B"는 음식 바꾸기라서 여기서 다루지 않는다
    const avoid = [];
    for (const m of [...rest.matchAll(AVOID_CLAUSE)]) {
      let item = avoidItem(m[2]);
      // "회사 팀원 다섯 명이 먹을 건데 고기 못 먹어"처럼 앞 낱말이 붙어 잡히면 마지막 낱말만 다시 본다
      if (!item && /\s/.test(m[2].trim())) item = avoidItem(m[2].trim().split(/\s+/).slice(-1)[0]) ?? avoidItem(m[2].trim().split(/\s+/).slice(-2).join(' '));
      if (!item) continue;
      avoid.push(item);
      rest = rest.replace(m[0], m[1] + ' ');
    }
    if (avoid.length) rules.avoid = avoid;
    const meal = rest.match(MEAL_TIME_RE);
    if (meal) rules.meal_time = MEAL_TIME_OF[meal[1]];
    const season = SEASON_ENUM.find(k => SEASON_RE[k].test(rest));
    if (season) { rules.season = season; rules.season_auto = false; }
    else if (SEASON_ASK.test(rest)) { // 계절을 말하지 않고 "날씨에 맞춰서"만 하면 요청 시각(서울) 기준 월로 추정
      const month = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', month: 'numeric' }).format(opts.now?.() ?? new Date()));
      const auto = [12, 1, 2].includes(month) ? 'winter' : [6, 7, 8].includes(month) ? 'summer' : null;
      if (auto) { rules.season = auto; rules.season_auto = true; }
    }
    // 상황 표현은 업종으로 읽지 않는다 (해장 → 한식, 야식으로 → 야식 같은 오인 방지). 소프트 가중치로만 쓴다.
    const situation = SITUATIONS.filter(x => x.re.test(rest)).map(x => x.key);
    if (situation.length) {
      rules.situation = situation;
      for (const x of SITUATIONS) rest = rest.replace(new RegExp(x.re.source, 'g'), ' ');
    }
    rest = rest.replace(SEASON_PHRASE, ' ');
    return { rules, rest: rest.replace(/\s+/g, ' ').replace(/^[\s,.]+|[\s,]+$/g, '').trim() };
  }

  // 먹는 사람 수: "아이 둘 있는 집이라 넷이 먹을"처럼 집안 설명보다 먹는 사람 표현(~이/~이서/~명이)을 우선
  function readPeople(t) {
    const eaters = [...t.matchAll(EATERS_RE)].map(m => {
      const word = m[1] ?? m[2] ?? m[3];
      return /^\d+$/.test(word) ? Number(word) : KOREAN_COUNT[word];
    }).filter(n => n > 0 && n <= 100);
    if (eaters.length) return eaters.at(-1);
    if (COMPANION_TWO.test(t)) return 2;
    if (SOLO.test(t) || /한\s*명(?!에|당)/.test(t)) return 1;
    return null;
  }

  // 규칙 기반 조건 정리
  function ruleParse(raw, cur) {
    const t = fixTypos(raw);
    const out = {};
    const food = readFood(raw);
    if (food) { out.menu = food.menu; out.dish = food.dish; }
    const p = readPeople(t);
    if (p) out.people = Math.min(p, 20);
    if (hasPrice(t)) {
      out.budget = parseAmount(t);
      if (/인당|1\s*인(?!\s*(?:분|세트|메뉴|용))|한\s*명(에|당)/.test(t)) out.budget_unit = 'per_person';
      else if (/총(?:액|합)?(?:\s|(?=\d)|$)|전체\s*예산|합계/.test(t)) out.budget_unit = 'total';
      else out.budget_unit = cur.budget ? cur.budget_unit : 'total';
      out.price_pref = 'none';
      out.budget_under = /미만/.test(t);
      const band = t.match(/(?:\d+|[일이삼사오육칠팔구십]+)?\s*만\s*원\s*대/);
      if (band) {
        out.budget_floor = parseAmount(band[0]);
        out.budget = out.budget_floor + 9999;
      }
    }
    if (/(?:가격|예산|금액|비용)\s*(은|는)?\s*(?:상관\s*없|무관)|비싸도/.test(t)) { out.price_pref = 'any'; out.budget = null; }
    else if (/가성비/.test(t)) out.price_pref = 'none'; // 가성비 모드: 1인분당 가격으로 비교
    else if (/싸게|저렴|싼\s*가격|낮은\s*가격/.test(t)) out.price_pref = 'cheap';
    if (/프[랜렌]차이즈\s*(?:는|를|가)?\s*(?:말고|빼|제외|싫|x)|프[랜렌]차이즈\s*(?:가\s*)?아닌\s*(?:가게|곳|집|매장|걸로|데로|피자집|치킨집)|개인\s*(?:가게|매장|피자집)\s*(?:만|으로)|체인(?:점)?\s*(?:은|는)?\s*(?:말고|빼|제외|싫|아닌)|동네\s*가게(?:로|만|에서|였으면)/i.test(t)) out.franchise = 'exclude';
    else if (/프[랜렌]차이즈\s*만/.test(t)) out.franchise = 'only';
    else if (/프[랜렌]차이즈(도|는)?\s*(괜찮|상관)|프[랜렌]차이즈\s*포함/.test(t)) out.franchise = 'none';
    if (/착한\s*가(?:게|격\s*업소)\s*(?:도|는|아니어도)?\s*(?:상관|괜찮|말고)/.test(t)) out.goodPrice = false;
    else if (/착한\s*가게|착한\s*가격\s*업소|착한\s*가격/.test(t)) out.goodPrice = true;
    const rating = t.match(/(?:별점|평점)\s*(?:이|은|은요)?\s*([0-5](?:\.\d)?)\s*점?\s*(?:이상|넘는|넘|초과|보다\s*높|부터|위)/);
    if (rating) out.min_rating = Number(rating[1]);
    if (/(?:신규|새로\s*생긴|새로\s*연|오픈한\s*지\s*얼마\s*안\s*된)\s*(?:가게|곳|집)?\s*(?:위주|우선|만|으로|로\s*(?:추천|골라|보여))/.test(t)) out.new_store = 'prefer';
    else if (/(?:신규|새로\s*생긴|새로\s*연)\s*(?:가게|곳|집)?\s*(?:도|는)?\s*(?:괜찮|상관|ok|좋아)/i.test(t)) out.new_store = 'allow';
    const foodText = food?.text || t.replace(/(?:프[랜렌]차이즈|체인점?)\s*(?:는|은)?\s*말고/g, ' ').split(/말고|대신(?:에)?/).at(-1);
    // "짜장면이나 짬뽕"의 짜장·짬뽕은 맛 조건이 아니다
    const either = food?.either ? foodText.match(/([가-힣]{1,8}?)(?:이나|나)\s+([가-힣]{1,8})/) : null;
    const found = TASTES.filter(w => foodText.includes(w) && !(either && (either[1].includes(w) || either[2].includes(w))));
    for (const [term, words] of tasteAliases) if (words.test(foodText)) found.push(term);
    // 표준 맛 (매운·안 매운은 아래에서 따로)
    for (const { canon, ask } of TASTE_CANON) if (canon !== '매운' && ask.test(omitMildWords(foodText))) found.push(canon);
    if (hasMildWords(foodText) || LESS_SPICY.test(foodText)) found.push(MILD);
    else if (SPICY_ASK.test(foodText)) found.push(SPICY);
    const cut = chickenCut(foodText);
    if (cut) found.push(cut);
    if (cheeseRequest.test(foodText)) found.push(EXTRA_CHEESE);
    if (/양[이가은도]?\s*많|푸짐|넉넉|배부르|배불/.test(foodText)) found.push('푸짐');
    const hadFood = cur.menu || cur.dish || cur.foods.length || cur.store;
    if (/(?:맛|취향)\s*(?:은|는)?\s*(?:아무\s*거나|상관\s*없)/.test(t)) out.taste = [];
    // 음식을 바꾸면 그 음식에 붙은 조건(순살·치즈 듬뿍 등)만 지우고 일반 맛 조건은 유지한다
    else if ((hadFood && food && (food.menu !== cur.menu || food.dish !== cur.dish)) || (found.length && /말고|대신/.test(t))) out.taste = mergeTaste(keepGeneral(cur.taste), found);
    else if (found.length) out.taste = mergeTaste(cur.taste, found);
    return out;
  }
  const keepGeneral = taste => taste.filter(term => KEEP_TASTES.includes(term));

  // ---------- 화면용 ----------
  const won = n => `${n.toLocaleString('ko-KR')}원`;
  // 업종 버튼은 데이터에서 뽑는다: 이 엔진(주문자 동 + 3km)에 있는 업종, 가게 많은 순
  const categoryCounts = new Map();
  for (const s of stores) if (CATEGORIES.includes(s.category)) categoryCounts.set(s.category, (categoryCounts.get(s.category) ?? 0) + 1);
  const dataCategories = [...categoryCounts.keys()].sort((a, b) => categoryCounts.get(b) - categoryCounts.get(a));
  const menuButtons = () => (dataCategories.length ? dataCategories : CATEGORIES).map(c => ({ label: c, action: { type: 'apply', cond: { menu: c } } }));
  const followUps = () => ['다른 데는?', '더 싸게', '다른 지역도 괜찮아요', '처음부터'].map(t => ({ label: t, action: { type: 'text', text: t }, ghost: true }));
  const moreButton = count => ({
    label: count > 36 ? `후보 더 보기 · ${count}곳 남음` : `남은 후보 ${count}곳 더 보기`,
    action: { type: 'text', text: `나머지 ${Math.min(count, 36)}곳도 보여줘` },
    ghost: true,
  });
  const moreRequest = /^(?:(?:나머지|남은|다른|추가로)\s*(\d{1,4})\s*(?:곳|개|가지)(?:의\s*)?(?:후보|가게|메뉴)?(?:도|은|는|을|를)?\s*(?:다\s*)?(?:보여|알려|추천).*|(?:아직\s*)?(?:안\s*본|나머지|남은|다른)\s*(?:후보|데|대|곳|가게|집|메뉴)?(?:도|는|은|를|을)?\s*(?:전부\s*|모두\s*|더\s*|다\s*)?(?:(?:있어|추천|보여|알려)[가-힣\s]*)?[?! .]*|(?:더|전부|모두)\s*(?:보여|알려).*)$/;

  function contextChips(c) {
    const out = [];
    if (c.meal_time) out.push({ label: MEAL_KO[c.meal_time], remove: { type: 'apply', cond: { meal_time: null } } });
    if (c.season) out.push({ label: SEASON_KO[c.season] + (c.season_auto ? ' (오늘 기준)' : ''), remove: { type: 'apply', cond: { season: null, season_auto: false } } });
    if (c.delivery_tip_max != null) out.push({ label: c.delivery_tip_max === 0 ? '배달팁 무료' : `배달팁 ${won(c.delivery_tip_max)} 이하`, remove: { type: 'apply', cond: { delivery_tip_max: null } } });
    for (const e of c.eaten) out.push({ label: e.dish && sameDish(e.dish, c.dish) ? `오늘 먹음: ${e.dish}` : e.dish ? `제외: ${e.dish}` : `덜 추천: ${e.menu}`,
      remove: { type: 'apply', cond: { eaten: c.eaten.filter(x => x !== e) } } });
    for (const a of c.avoid) out.push({ label: `제외: ${a.dish ?? a.menu ?? a.ingredient}`, remove: { type: 'apply', cond: { avoid: c.avoid.filter(x => x !== a) } } });
    if (c.min_rating != null) out.push({ label: `별점 ${c.min_rating} 이상`, remove: { type: 'apply', cond: { min_rating: null } } });
    if (c.new_store === 'prefer') out.push({ label: '신규 가게 위주', remove: { type: 'apply', cond: { new_store: 'none' } } });
    for (const key of c.situation ?? []) out.push({ label: SITUATIONS.find(x => x.key === key)?.label ?? key, remove: { type: 'apply', cond: { situation: c.situation.filter(k => k !== key) } } });
    return out;
  }

  function chips(state) {
    const c = state.cond;
    if (!state.dong) return [];
    const out = [{ label: areaLabel(state) }];
    if (!canSearch(state)) {
      // 대화형: 음식을 정하기 전에도 말한 조건(인원·맛·프랜차이즈·착한가게·예산)은 보여 준다
      if (!guided) return out;
      if (c.people) out.push({ label: `${c.people}인` });
      if (c.budget) out.push({ label: `총 ${won(c.budget * (c.budget_unit === 'per_person' ? c.people || 1 : 1))} 이하`, kind: 'price', remove: { type: 'apply', cond: { budget: null, price_pref: 'none' } } });
      for (const t of c.taste) out.push({ label: t, remove: { type: 'apply', cond: { taste: c.taste.filter(x => x !== t) } } });
      if (c.franchise !== 'none') out.push({ label: c.franchise === 'exclude' ? '프랜차이즈 X' : '프랜차이즈만', remove: { type: 'apply', cond: { franchise: 'none' } } });
      if (c.goodPrice) out.push({ label: '착한가게만', remove: { type: 'apply', cond: { goodPrice: false } } });
      return [...out, ...contextChips(c)];
    }
    if (c.menu) out.push({ label: c.menu, kind: 'menu' });
    else if (c.anyMenu && !hasFood(c)) out.push({ label: '음식 아무거나', remove: { type: 'apply', cond: { anyMenu: false } } });
    if (c.sub) out.push({ label: c.sub, kind: 'sub', change: { type: 'apply', cond: { sub: null } }, remove: { type: 'apply', cond: { sub: '' } } });
    for (const food of c.foods) out.push({ label: food.dish || food.menu });
    for (const field of ['dish', 'store']) if (c[field]) out.push({ label: c[field], remove: { type: 'apply', cond: { [field]: null } } });
    out.push({ label: `${c.people || 1}인` });
    if (c.budget) {
      const tb = c.budget_unit === 'per_person' ? c.budget * (c.people || 1) : c.budget;
      const low = c.budget_floor * (c.budget_unit === 'per_person' ? c.people || 1 : 1);
      const label = low ? `총 ${won(low)}~${won(tb)}` : c.budget_under ? `${won(tb)} 미만` : `총 ${won(tb)} 이하`;
      out.push({ label, kind: 'price', remove: { type: 'apply', cond: { budget: null, price_pref: 'none' } } });
    } else if (c.price_pref === 'cheap') out.push({ label: '싸게', kind: 'price', remove: { type: 'apply', cond: { price_pref: 'none' } } });
    else if (c.price_pref === 'any') out.push({ label: '가격 무관', kind: 'price', remove: { type: 'apply', cond: { price_pref: 'none' } } });
    else out.push({ label: '가성비 우선', kind: 'price', accent: true, remove: { type: 'apply', cond: { price_pref: 'any' } } });
    for (const t of c.taste.filter(t => !state.chosen.some(ch => ch.label === t))) out.push({ label: t, remove: { type: 'apply', cond: { taste: c.taste.filter(x => x !== t) } } });
    for (const w of c.exclude ?? []) out.push({ label: `${w} 제외`, remove: { type: 'apply', cond: { exclude: c.exclude.filter(x => x !== w) } } });
    if (c.franchise !== 'none') out.push({ label: c.franchise === 'exclude' ? '프랜차이즈 X' : '프랜차이즈만', remove: { type: 'apply', cond: { franchise: 'none' } } });
    if (c.goodPrice) out.push({ label: '착한가게만', remove: { type: 'apply', cond: { goodPrice: false } } });
    out.push(...contextChips(c));
    if (dongMode(state)) out.push({ label: state.expand || state.wide ? '3km 확장' : '같은 동', kind: 'step' });
    for (const ch of state.chosen) out.push({ label: ch.label, remove: { type: 'apply', chosenRemove: ch.label } });
    return out;
  }

  const storeBase = name => name.replace(/\s+\S+점$/, '');
  const brandKey = store => store.franchise ? compact(storeBase(store.name)) : store.id;
  function diversify(rows, getStore) {
    const brands = new Set();
    const distinct = [];
    const repeated = [];
    for (const row of rows) {
      const brand = brandKey(getStore(row));
      (brands.has(brand) ? repeated : distinct).push(row);
      brands.add(brand);
    }
    return { distinct, repeated };
  }
  const matchesStore = (query, store) => [store.name, storeBase(store.name)].some(name => compact(name) === compact(query));
  const storeNames = [...new Set(stores.flatMap(s => [s.name, storeBase(s.name)]))]
    .map(name => [compact(name), name]).filter(([key]) => key.length >= 2 && !CATEGORIES.some(c => compact(c) === key))
    .sort(([a], [b]) => b.length - a.length);
  function findStoreName(text, dish) {
    const normalized = compact(text);
    const dishName = compact(dish);
    const searchable = dishName ? normalized.replaceAll(dishName, ' ') : normalized;
    return storeNames.find(([key]) => searchable.includes(key) || normalized.includes(`${key}에서`))?.[1];
  }

  // 가게 정보에서 오는 표시: 착한가게, 신규(별점 없음), 주문자 동에서의 거리
  const withStoreBadge = (card, state) => {
    const store = storesById.get(card.storeId);
    return { ...card, isGoodPrice: store?.is_good_price === true, isNew: card.isNew || (store && store.rating == null),
      ...(dongMode(state) && store ? { distanceKm: distanceOf(state, store) } : {}) };
  };
  // reply.kind: recommend · ask_region · ask_clarify · concession · refuse · role_keep · out_of_scope · out_of_area · explain · limit_notice · caution · substitute · split
  const out = (state, reply) => ({
    state,
    reply: {
      kind: reply.cards?.length || reply.selected ? 'recommend' : reply.zero ? 'concession' : 'ask_clarify',
      ...reply,
      ...(dongMode(state) ? { step: state.expand || state.wide ? '3km 확장' : '같은 동' } : {}),
      ...(reply.cards ? { cards: reply.cards.map(card => withStoreBadge(card, state)) } : {}),
      ...(reply.selected ? { selected: withStoreBadge(reply.selected, state) } : {}),
      chips: chips(state),
    },
  });

  function answerFranchiseQuestion(state, text) {
    const recommended = state.lastRecommendations.map(item => stores.find(store => store.id === item.storeId)).filter(Boolean);
    const named = findStoreName(text);
    const rank = text.match(/(\d{1,2})\s*(?:번|번째|위)|첫\s*번째|두\s*번째|세\s*번째/);
    const index = rank && (rank[1] ? Number(rank[1]) - 1 : /첫/.test(rank[0]) ? 0 : /두/.test(rank[0]) ? 1 : 2);
    const candidates = rank ? [recommended[index]].filter(Boolean) : named ? stores.filter(store => matchesStore(named, store)) : recommended;
    if (!candidates.length) return out(state, {
      kind: 'explain',
      text: '어느 가게가 궁금하신가요? 가게 이름이나 추천 번호를 알려 주세요.',
      preserveResults: true,
    });
    const names = [...new Set(candidates.map(store => store.name))];
    const franchise = candidates.filter(store => store.franchise);
    const sameBrand = franchise.length > 1 && new Set(franchise.map(brandKey)).size === 1;
    const status = franchise.length === candidates.length
      ? sameBrand ? `네, DB 기준으로 ‘${storeBase(franchise[0].name)}’의 프랜차이즈 지점들이에요.`
        : `DB에서 프랜차이즈로 분류된 가게예요. ${names.join(' · ')}`
      : franchise.length ? `DB에서 프랜차이즈로 분류된 가게는 ${franchise.map(store => store.name).join(' · ')}이고, 나머지는 프랜차이즈가 아니에요.`
        : `DB에서 비프랜차이즈로 분류된 가게예요. ${names.join(' · ')}`;
    return out(state, {
      kind: 'explain',
      text: status,
      preserveResults: true,
      buttons: franchise.length ? [{ label: '같은 조건으로 프랜차이즈 빼기', action: { type: 'apply', cond: { franchise: 'exclude' } } }] : [],
    });
  }

  function planCard({ menu, qty, lines, total, estimated, extraServings }, people) {
    const heat = lines.length === 1 ? readRecordedTaste(menu.details?.taste).heat : null;
    return {
      menuId: menu.id, menu: menu.name, qty, total,
      ...(heat ? { heat } : {}),
      ...(menu.details && menu.desc ? { menuDescription: menu.desc } : {}),
      ...(lines.length > 1 ? { items: lines.map(line => ({ menuId: line.menu.id, name: line.menu.name, qty: line.qty })) } : {}),
      ...(people > 1 ? {
        portionNote: estimated ? `${people}인 기준 예상 구성` : `${people + extraServings}인분 표기 기준`,
        setMenu: lines.length === 1 && /세트|콤보/.test(menu.name),
      } : {}),
    };
  }

  function eligibleMenus(store, x) {
    const cheapest = new Map();
    for (const plan of x.plans(store)) {
      if (x.fitsBudget(plan.total) && plan.total < (cheapest.get(plan.menu.id)?.total ?? Infinity)) {
        cheapest.set(plan.menu.id, plan);
      }
    }
    return [...cheapest.values()].sort((a, b) => a.total - b.total).map(plan => plan.menu);
  }

  function confirmRecommendation(state, text) {
    const approval = text.match(/(?:마음|맘)에\s*들|그(?:거|걸)(?:로)?\s*(?:할래|할게|좋아|괜찮)|(?:괜찮|좋)(?:아|아요|네|네요|습니다|은데)|(?:저|이|그)(?:걸|거)로\s*(?:할래|할게|정할게)/);
    if (!approval || !state.lastRecommendations.length || hasPrice(text) ||
      /말고|대신|바꿔|다시\s*(?:찾|검색)|다른\s*(?:지역|동네|데|가게|메뉴)|안\s*(?:좋|괜찮|들)|(?:좋지|들지|들진)\s*않/.test(text)) return null;
    const rank = text.match(/(\d{1,2})\s*(?:번|번째|위)|첫\s*번(?:째)?|두\s*번째|세\s*번째|맨\s*(?:위|아래)|마지막/);
    const ranked = rank && (rank[1] ? Number(rank[1]) - 1 : /첫|맨\s*위/.test(rank[0]) ? 0 : /두/.test(rank[0]) ? 1 : /세/.test(rank[0]) ? 2 : state.lastRecommendations.length - 1);
    const choices = state.lastRecommendations.flatMap((item, index) => {
      const store = stores.find(s => s.id === item.storeId);
      if (!store) return [];
      const lines = (item.items ?? [item]).map(line => ({
        menu: menuGroups.get(store.id).find(menu => menu.id === line.menuId), qty: line.qty,
      }));
      if (!lines.length || lines.some(line => !line.menu)) return [];
      return [{ index, store, lines, menu: lines[0].menu }];
    });
    const mentioned = compact(text);
    const named = choices.filter(({ store, lines }) => [store.name, storeBase(store.name), ...lines.map(line => line.menu.name)]
      .some(name => compact(name) && mentioned.includes(compact(name))));
    const general = /(?:마음|맘)에\s*들|^(?:좋아(?:요)?|괜찮(?:아|아요|네|네요))[!. ]*$|(?:이|그|저)(?:거|걸|\s*가게|\s*메뉴|\s*추천)|(?:방금|직전|아까)\s*(?:추천|보여)/.test(text);
    if (!rank && !named.length && !general) return null;
    const preferred = choices.find(c => c.menu.id === state.preferredMenu);
    const candidates = rank ? choices.filter(c => c.index === ranked) : named.length ? named : preferred ? [preferred] : choices;
    state.pending = null;
    state.awaitingRegion = false;
    if (candidates.length !== 1) return out(state, {
      text: '어느 추천이 마음에 들었나요? 가게나 메뉴 이름, 또는 추천 번호를 알려 주세요.',
      buttons: (candidates.length ? candidates : choices).map(c => ({ label: `${c.index + 1}번 · ${c.store.name}`, action: { type: 'text', text: `${c.index + 1}번이 마음에 들어` } })),
    });
    const { store, menu, lines } = candidates[0];
    const total = lines.reduce((sum, line) => sum + line.menu.price * line.qty, store.tip);
    const people = state.cond.people || 1;
    const portions = lines.map(line => ({ ...menuPortion(line.menu, store.category), qty: line.qty }));
    const estimated = portions.some(portion => portion.estimated);
    const extraServings = portions.reduce((sum, portion) => sum + portion.servings * portion.qty, 0) - people;
    const name = lines.map(line => line.menu.name).join(' + ');
    const confirmed = state.cond.taste.filter(term => menuEvidence(menu, term));
    state.preferredMenu = menu.id;
    return out(state, {
      text: `‘${store.name}’의 ‘${name}’이 마음에 드셨군요. 아래에서 바로 장바구니에 담거나 가게 메뉴를 볼 수 있어요.`,
      selected: {
        storeId: store.id, name: store.name,
        ...planCard({ menu, qty: lines[0].qty, lines, total, estimated, extraServings }, people),
        checks: [store.region + ' ' + store.dong, ...confirmed], rating: store.rating,
        reason: menuReason(menu, confirmed), quote: menu.desc, budgetNote: budgetNoteFor(state, total),
      },
    });
  }

  // ---------- 양보안 ----------
  // 양보안: 결과가 1곳 이상인 것만, 최대 3개. 버튼 1줄 = 짧은 문구, 2줄 = 바뀌는 조건(change)을 숫자로.
  // 12000 → "1만2천 원", 10000 → "1만 원", 9500 → "9,500원"
  const manwon = n => n >= 10000 && n % 1000 === 0
    ? `${Math.floor(n / 10000)}만${n % 10000 ? `${(n % 10000) / 1000}천` : ''} 원` : won(n);
  const chun = d => d % 10000 === 0 ? `${d / 10000}만 원` : d % 1000 === 0 ? `${d / 1000}천 원` : won(d);
  function concessions(state, x, leftIds) {
    const res = [];
    const more = leftIds.size ? ' 더' : '';
    const add = (text, o, action, change) => {
      const n = filterStores(state, x, o).filter(s => !leftIds.has(s.id)).length;
      if (n) { res.push({ label: text(n), action, change }); return true; }
      return false;
    };
    if (x.mode === 'budget') {
      // 인당 예산이면 총액으로 환산해서 보여 준다 ("예산 2인 24,000원 → 26,000원")
      const who = state.cond.budget_unit === 'per_person' && x.people > 1 ? ` ${x.people}인` : '';
      for (const d of [2000, 5000]) {
        if (add(n => dongMode(state) && !state.expand && !state.wide ? `${manwon(x.totalBudget + d)}으로 올리면 우리 동 ${n}곳${more}` : `${chun(d)} 더 쓰면 ${n}곳${more}`, { totalBudget: x.totalBudget + d },
          { type: 'apply', cond: { budget: x.totalBudget + d, budget_unit: 'total' } },
          { label: '예산' + who, from: won(x.totalBudget), to: won(x.totalBudget + d) })) break;
      }
    }
    if (dongMode(state) && !state.expand && !state.wide) {
      // 2단계 검색: 지금 조건 그대로 3km 안의 동까지
      const wide = { ...state, expand: true };
      const n = filterStores(wide, ctx(wide)).filter(s => !leftIds.has(s.id)).length;
      if (n) res.push({ label: `주변 동까지 보면 ${x.mode === 'budget' ? manwon(x.totalBudget) + '에 ' : ''}${n}곳${more}`,
        action: { type: 'apply', expand: true }, change: { label: '범위', from: '우리 동', to: '3km 이내' } });
    }
    if (x.mode === 'cheap' && x.base && state.cheapBoost < 1.1) {
      add(n => `보통 가격보다 10% 더 쓰면 ${n}곳${more}`, { cheapBoost: 1.1 }, { type: 'apply', cheapBoost: 1.1 },
        { label: '동네 보통 가격', from: won(Math.round(x.base / 100) * 100), to: won(Math.round(x.base * 1.1 / 100) * 100) });
    }
    if (state.chosen.length) {
      const last = state.chosen.at(-1);
      add(n => `'${last.label}' 아니어도 괜찮으면 ${n}곳${more}`, { chosen: state.chosen.slice(0, -1) }, { type: 'apply', chosenRemove: last.label },
        { label: '', from: `'${last.label}' 선택`, to: '상관없음' });
    }
    if (state.cond.sub && !x.exact) {
      // 세부 메뉴 조건은 ctx(대표 메뉴)에서 걸리므로 조건을 풀어 다시 센다
      const anySub = { ...state, cond: { ...state.cond, sub: '' } };
      const n = filterStores(anySub, ctx(anySub)).filter(s => !leftIds.has(s.id)).length;
      if (n) res.push({ label: `'${state.cond.sub}' 아니어도 괜찮으면 ${n}곳${more}`, action: { type: 'apply', cond: { sub: '' } },
        change: { label: '', from: `'${state.cond.sub}'`, to: '상관없음' } });
    }
    if (state.cond.delivery_tip_max != null) {
      const tip = state.cond.delivery_tip_max;
      add(n => `배달팁 조건 풀면 ${n}곳${more}`, { cond: { delivery_tip_max: null } }, { type: 'apply', cond: { delivery_tip_max: null } },
        { label: '배달팁', from: tip === 0 ? '무료만' : `${won(tip)} 이하`, to: '상관없음' });
    }
    if (state.cond.min_rating != null) {
      add(n => `별점 조건 풀면 ${n}곳${more}`, { cond: { min_rating: null } }, { type: 'apply', cond: { min_rating: null } },
        { label: '별점', from: `${state.cond.min_rating} 이상`, to: '상관없음' });
    }
    if (state.cond.goodPrice) {
      add(n => `착한가게 조건 풀면 ${n}곳${more}`, { cond: { goodPrice: false } }, { type: 'apply', cond: { goodPrice: false } },
        { label: '착한가게', from: '착한가게만', to: '상관없음' });
    }
    if (state.cond.franchise === 'exclude' && !state.cond.taste.includes(EXTRA_CHEESE)) {
      add(n => `프랜차이즈도 괜찮으면 ${n}곳${more}`, { cond: { franchise: 'none' } }, { type: 'apply', cond: { franchise: 'none' } },
        { label: '프랜차이즈', from: '제외', to: '포함' });
    }
    if (state.excludeSeen && !leftIds.size) {
      add(n => `아까 본 ${n}곳 다시 보기`, { excludeSeen: false }, { type: 'apply', seenAgain: true },
        { label: '', from: '새 가게만', to: '본 가게 포함' });
    }
    return res.slice(0, 4);
  }

  function zero(state, x, leftIds = new Set(), lead = null) {
    const cs = concessions(state, x, leftIds);
    const restart = followUps().find(b => b.label === '처음부터');
    return out(state, {
      zero: true,
      title: '조건에 맞는 가게가 없어요',
      hint: cs.length ? '조건을 조금 바꾸면 이런 가게가 있어요' : '지역이나 음식 조건을 바꿔 다시 찾아보세요',
      ...(lead ? { text: lead } : {}),
      buttons: [...cs, restart], // 양보안이 없으면 "처음부터"만
      remaining: 0,
    });
  }

  const gwa = word => { const code = String(word).charCodeAt(String(word).length - 1) - 0xac00; return code >= 0 && code < 11172 && code % 28 ? '과' : '와'; };
  const eunNeun = word => { const code = String(word).charCodeAt(String(word).length - 1) - 0xac00; return code >= 0 && code < 11172 && code % 28 ? '은' : '는'; };
  function contextLine(c) {
    const parts = [];
    if (c.eaten.length) {
      const eaten = c.eaten.map(e => [MEAL_KO[e.meal], e.dish ?? e.menu].filter(Boolean).join(' ')).join('·');
      parts.push(`${eaten}${gwa(eaten)} 겹치지 않게`);
    }
    if (c.avoid.length) {
      const avoid = c.avoid.map(a => a.dish ?? a.menu ?? a.ingredient).join('·');
      parts.push(`${avoid}${eunNeun(avoid)} 빼고${c.avoid.some(a => a.ingredient) ? '(메뉴 이름·설명 기준)' : ''}`);
    }
    if (c.season) parts.push(`${c.season_auto ? '오늘 날씨 기준 ' : ''}${SEASON_KO[c.season]}에 어울리는 ${SEASON_FOOD[c.season]} 메뉴 위주로`);
    else if (c.meal_time) parts.push(`${MEAL_KO[c.meal_time]} 메뉴로`);
    if (c.delivery_tip_max != null) parts.push(c.delivery_tip_max === 0 ? '배달팁 없는 가게만' : `배달팁 ${won(c.delivery_tip_max)} 이하 가게만`);
    return parts.length ? `${parts.join(', ')} 골랐어요.` : '';
  }

  function budgetNoteFor({ cond }, total) {
    if (cond.budget == null) return null;
    const people = cond.budget_unit === 'per_person' ? cond.people || 1 : 1;
    const cap = cond.budget * people;
    const floor = (cond.budget_floor || 0) * people;
    if (total > cap) return `예산보다 ${won(total - cap)} 높아요`;
    if (total === cap && cond.budget_under) return '입력한 예산과 같아요 · 미만 조건 제외';
    if (total < floor) return `최소 예산보다 ${won(floor - total)} 낮아요`;
    return null;
  }

  function rememberCards(state, cards, displayed = cards) {
    for (const { storeId } of cards) {
      if (!state.exposed.includes(storeId)) {
        expo(storeId);
        exposure.counts[storeId] = (exposure.counts[storeId] ?? 0) + 1;
        state.exposed.push(storeId);
      }
      if (!state.seen.includes(storeId)) state.seen.push(storeId);
    }
    state.lastMin = Math.min(...displayed.map(card => card.total));
    state.lastTop = cards.map(card => card.storeId);
    state.lastRecommendations = displayed.map(({ storeId, menuId, qty, items }) => ({
      storeId, menuId, qty, ...(items ? { items: items.map(({ menuId, qty }) => ({ menuId, qty })) } : {}),
    }));
    state.preferredMenu = null;
  }

  function budgetAlternatives(state, x, lead, limit = 3) {
    if (x.totalBudget == null) return null;
    const terms = [...new Set([...state.cond.taste, ...state.chosen.map(choice => choice.label)])];
    const compare = (a, b) => a.distance - b.distance || b.confirmed.length - a.confirmed.length ||
      a.total - b.total || (b.store.rating ?? 0) - (a.store.rating ?? 0);
    const closest = filterStores(state, x, { ignoreBudget: true }).map(store => {
      return x.plans(store).map(plan => {
        const { menu, total } = plan;
        const confirmed = terms.filter(term => menuEvidence(menu, term));
        const distance = total < x.budgetFloor ? x.budgetFloor - total : Math.abs(total - x.totalBudget);
        return { ...plan, store, confirmed, distance };
      }).sort(compare)[0];
    }).sort(compare);
    if (!closest.length) return null;
    const { distinct, repeated } = diversify(closest, plan => plan.store);
    const candidates = state.excludeSeen ? [...distinct, ...repeated] : distinct;
    const cards = candidates.slice(0, limit).map(plan => {
      const { store, menu, total, confirmed } = plan;
      const budgetNote = budgetNoteFor(state, total);
      return {
        storeId: store.id, name: store.name, ...planCard(plan, x.people),
        checks: [store.region + ' ' + store.dong, store.franchise ? '프랜차이즈' : '프랜차이즈 아님', ...confirmed],
        partial: !!lead || !!budgetNote || confirmed.length < terms.length,
        rating: store.rating, budgetNote,
        reason: menuReason(menu, confirmed) || (terms.length ? '메뉴 정보에서 요청한 맛이나 양을 확인할 수 없어요.' : ''),
        quote: menu.desc,
      };
    });
    rememberCards(state, cards);
    const remaining = closest.length - cards.length;
    const intro = lead || `${areaLabel(state)}에서 현재 조건을 모두 만족하는 메뉴를 찾지 못했어요.`;
    return out(state, {
      kind: 'concession',
      text: `${intro} 배달비를 포함해 입력하신 예산에 가까운 대안을 보여드릴게요.`,
      cards,
      remaining,
      buttons: [...(remaining ? [moreButton(remaining)] : []), ...followUps().filter(button =>
        button.label !== '다른 데는?' && (button.label !== '다른 지역도 괜찮아요' || state.dong !== ALL_REGIONS))],
    });
  }

  function combinedFoodResults(state, limit) {
    const { foods } = state.cond;
    if (state.cond.sameStore) {
      const together = sameStoreResults(state, limit);
      if (together) return together;
    }
    const groups = foods.map(food => {
      const taste = food.taste ?? state.cond.taste;
      const label = food.dish || food.menu || `${taste.join('·')} 메뉴`;
      const search = { ...state, cond: { ...state.cond, ...food, taste, anyMenu: !food.menu && !food.dish } };
      const x = ctx(search);
      const compare = (a, b) => Number(!!a.budgetNote) - Number(!!b.budgetNote) ||
        Number(a.partial) - Number(b.partial) || a.total - b.total || (b.rating ?? 0) - (a.rating ?? 0);
      const candidates = filterStores(search, x, { ignoreBudget: true }).flatMap(store => {
        const cards = x.plans(store).map(plan => {
          const { menu, total } = plan;
          const confirmed = taste.filter(term => tasteOk(menu, term, store));
          if (food.taste && confirmed.length < taste.length) return null; // 사람별 맛은 근거가 있는 메뉴만
          return {
            storeId: store.id, name: store.name, foodLabel: label, ...planCard(plan, x.people),
            checks: [store.region + ' ' + store.dong, ...confirmed], rating: store.rating,
            partial: confirmed.length < taste.length, budgetNote: budgetNoteFor(state, total),
            reason: menuReason(menu, confirmed), quote: menu.desc,
          };
        });
        const best = cards.filter(Boolean).sort(compare)[0];
        return best ? [best] : [];
      }).sort(compare);
      return { label, candidates };
    });
    const picked = new Map();
    const remaining = new Set(groups.flatMap(group => group.candidates.map(card => card.storeId)));
    const cursor = groups.map(() => 0);
    const firstGroup = state.excludeSeen ? state.seen.length % groups.length : 0;
    while (picked.size < limit && remaining.size) {
      for (let offset = 0; offset < groups.length && picked.size < limit; offset += 1) {
        const index = (firstGroup + offset) % groups.length;
        const { candidates } = groups[index];
        while (cursor[index] < candidates.length && !remaining.has(candidates[cursor[index]].storeId)) cursor[index] += 1;
        const candidate = candidates[cursor[index]];
        if (candidate) {
          picked.set(candidate.storeId, candidate);
          remaining.delete(candidate.storeId);
        }
      }
    }
    const cards = [...picked.values()];
    const missing = groups.filter(group => !group.candidates.length).map(group => group.label);
    const complete = `${groups.map(group => group.label).join('·')} 후보를 음식별로 골랐어요. 카드마다 배달비 포함 예상가를 표시했어요. 가게가 다르면 따로 주문해 주세요.`;
    const budgetDetail = state.cond.budget != null ? ' 함께 주문할 때의 총예산은 장바구니에서 확인해 주세요.' : '';
    const intro = state.excludeSeen ? '같은 조건에서 아직 보여드리지 않은 후보예요.' : complete;
    const unavailable = !state.excludeSeen && missing.length ? ` ${missing.join('·')}는 ${areaLabel(state)}에서 조건에 맞는 후보를 찾지 못했어요.` : '';
    if (cards.length) rememberCards(state, cards);
    state.awaitingRegion = state.dong !== ALL_REGIONS;
    return out(state, {
      kind: 'split',
      text: cards.length ? `${intro}${budgetDetail}${unavailable} 이번에 ${cards.length}곳을 보여드렸고, 남은 후보는 ${remaining.size}곳이에요.`
        : state.excludeSeen ? '같은 조건에서 더 보여드릴 후보가 없어요. 다른 지역이나 조건으로 찾아볼 수 있어요.'
          : `${areaLabel(state)}에서 ${groups.map(group => group.label).join('·')} 후보를 찾지 못했어요. 지역이나 조건을 바꿔 찾아볼 수 있어요.`,
      cards,
      lookup: true,
      remaining: remaining.size,
      buttons: [...(remaining.size ? [moreButton(remaining.size)] : []), ...followUps().filter(button =>
        ['다른 지역도 괜찮아요', '처음부터'].includes(button.label) && (button.label !== '다른 지역도 괜찮아요' || state.dong !== ALL_REGIONS))],
    });
  }

  // "한 가게에서 치킨이랑 떡볶이": 모든 음식을 파는 가게를 먼저 찾는다. 없으면 음식별로 나눠 보여 준다.
  function sameStoreResults(state, limit) {
    const { foods } = state.cond;
    const xs = foods.map(food => ctx({ ...state, cond: { ...state.cond, ...food, menu: null, dish: food.dish ?? food.menu } }));
    const rows = stores.filter(s => inArea(s, state)).flatMap(store => {
      const picks = xs.map((x, i) => {
        const pattern = foods[i].dish ? null : categoryPattern(foods[i].menu);
        return menuGroups.get(store.id).filter(m => (foods[i].dish ? dishMatches(foods[i].dish, m.name) : pattern?.test(m.name)) && !sideOrDrink.test(compact(m.name)))
          .sort((a, b) => a.price - b.price)[0];
      });
      if (picks.some(m => !m)) return [];
      const total = picks.reduce((sum, m) => sum + m.price, store.tip);
      if (state.cond.budget != null && total > state.cond.budget * (state.cond.budget_unit === 'per_person' ? state.cond.people || 1 : 1)) return [];
      return [{ store, picks, total }];
    }).sort((a, b) => a.total - b.total || (b.store.rating ?? 0) - (a.store.rating ?? 0)).slice(0, limit);
    if (!rows.length) return null;
    const cards = rows.map(({ store, picks, total }) => ({
      storeId: store.id, name: store.name, menuId: picks[0].id, menu: picks.map(m => m.name).join(' + '), qty: 1, total,
      items: picks.map(m => ({ menuId: m.id, name: m.name, qty: 1 })),
      checks: [store.region + ' ' + store.dong, '한 가게에서 주문'], rating: store.rating, quote: picks[0].desc,
    }));
    rememberCards(state, cards);
    return out(state, {
      kind: 'split',
      text: `${foods.map(f => f.dish || f.menu).join('·')}를 한 가게에서 같이 주문할 수 있는 곳이에요. 배달비 포함 합계로 보여드려요.`,
      cards, buttons: followUps().filter(b => b.label === '처음부터'),
    });
  }

  const aiCond = c => ({ menu: c.menu, people: c.people || 1, taste: c.sub ? [...new Set([c.sub, ...c.taste])] : c.taste, franchise: c.franchise }); // 가격 정보는 AI ②③에 안 넘긴다

  // ---------- 3단계: 좁히기 질문 ----------
  function ruleQuestion(state, left, x) {
    const question = '순살과 뼈 있는 치킨 중 어느 쪽이 좋으세요?';
    if (state.cond.menu !== '치킨' || state.asked.includes(question) ||
        state.cond.taste.some(term => CHICKEN_CUTS.includes(term))) return null;
    const options = CHICKEN_CUTS.map(label => ({
      label,
      store_ids: left.filter(store => x.plans(store).some(plan => x.fitsBudget(plan.total) &&
        state.cond.taste.every(term => menuEvidence(plan.menu, term)) &&
        plan.lines.every(({ menu }) => menuEvidence(menu, label)))).map(store => store.id),
    }));
    return { question, options };
  }

  async function modelQuestion(state, left, x, ai) {
    const sent = left.map(s => ({ s, score: priceScore(x.minCost(s), x, s) * 30 + ratingScore(s, x.avgRating) * 20 }))
      .sort((a, b) => b.score - a.score || expo(a.s.id) - expo(b.s.id))
      .slice(0, AI2_MAX_STORES).map(({ s }) => ({
        store_id: s.id,
        menus: eligibleMenus(s, x).slice(0, AI2_MAX_MENUS_PER_STORE)
          .map(menu => ({ name: menu.name, desc: menuHint(menu, AI2_DESC_MAX_CHARS) })),
      }));
    let q;
    try {
      q = await ai.question({
        cond: aiCond(state.cond), chosen: state.chosen.map(c => c.label), asked: state.asked,
        stores: sent,
      });
    } catch (e) { if (e.message !== 'LLM unavailable') console.warn('[AI ②] 실패 → 규칙 기반 후속 질문:', e.message); return null; }
    if (typeof q?.question !== 'string' || !q.question.trim() || !Array.isArray(q.options)) return null;
    const options = q.options
      .filter(o => o && typeof o.label === 'string' && o.label.trim() && !hasPrice(o.label) && o.label !== '상관없어요')
      .map(o => {
        const label = o.label.trim().slice(0, 30);
        const matching = left.filter(store => eligibleMenus(store, x).some(menu => menuEvidence(menu, label)));
        return { label, store_ids: matching.map(store => store.id) };
      })
      .filter(o => o.store_ids.length)
      .slice(0, 5);
    return { question: q.question, options };
  }

  async function question(state, left, x, ai) {
    const distinctOptions = q => {
      const options = q?.options.filter(option => option.store_ids.length);
      return options && new Set(options.map(o => JSON.stringify([...o.store_ids].sort()))).size >= 2
        ? { ...q, options } : null;
    };
    const model = left.length >= 4 && ai?.question ? await modelQuestion(state, left, x, ai) : null;
    const q = distinctOptions(model) ?? distinctOptions(ruleQuestion(state, left, x));
    if (!q) return null;
    state.questions++; state.asked.push(q.question); state.pending = q.options;
    return {
      text: q.question,
      buttons: [...q.options.map((o, i) => ({ label: `${o.label} (${o.store_ids.length}곳)`, action: { type: 'option', index: i } })),
        { label: '상관없어요', action: { type: 'option', index: -1 } }],
      remaining: left.length,
    };
  }

  // ---------- 4·5·6단계: 맞음 판단 → 대표 메뉴·점수·TOP3 → 카드 ----------
  async function results(state, x, left, ai, alternativeLead = '', limit = 3) {
    const terms = [...new Set([...state.cond.taste, ...state.chosen.map(c => c.label)])];
    const eligible = s => eligibleMenus(s, x);
    const { dish, menu } = state.cond;
    const related = alternativeLead && dish ? Object.entries(SIMILAR).filter(([word]) => dish.includes(word)).flatMap(([word, similar]) => [word, ...similar]) : [];
    const alternativeScore = m => related.some(word => menuEvidence(m, word)) ? 15 : 0;
    const evidence = (s, words) => Math.max(0, ...eligible(s).map(m => words.filter(w => menuEvidence(m, w)).length));
    const pre = s => {
      const hits = evidence(s, terms);
      return priceScore(x.minCost(s), x, s) * 30 + ratingScore(s, x.avgRating) * 20 + hits * 25 +
        (hasContext(state.cond) ? Math.max(...eligible(s).map(m => contextScore(s, m, state.cond)), -Infinity) : 0) +
        (hits > 0 && hits === terms.length ? 100 : 0) + Math.max(0, ...eligible(s).map(alternativeScore));
    };
    const candidateLimit = Math.max(8, limit);
    const ranked = left.map(store => ({ store, score: pre(store) }))
      .sort((a, b) => b.score - a.score || expo(a.store.id) - expo(b.store.id));
    const { distinct, repeated } = diversify(ranked, row => row.store);
    let candRows = [...distinct, ...repeated];
    if (mixedPick(state.cond)) { // 업종을 섞어 고를 때는 업종마다 1등 가게를 먼저 후보에 넣는다
      const seenCategories = new Set();
      const firstOfEach = candRows.filter(row => !seenCategories.has(row.store.category) && seenCategories.add(row.store.category));
      candRows = [...firstOfEach, ...candRows.filter(row => !firstOfEach.includes(row))];
    }
    const cands = candRows.slice(0, candidateLimit).map(row => row.store);

    const fullyVerified = terms.length ? new Map(cands.map(s => [s.id, eligible(s).filter(m => terms.every(term => menuEvidence(m, term)))])) : null;
    const hasVerifiedMatches = fullyVerified && [...fullyVerified.values()].some(list => list.length);
    const judged = new Map();
    try {
      const res = await ai?.judge?.({
        cond: aiCond(state.cond), chosen: state.chosen.map(c => c.label),
        stores: cands.slice(0, AI3_MAX_CANDIDATES).map(s => ({
          store_id: s.id,
          menus: eligible(s).slice(0, AI3_MAX_MENUS_PER_STORE)
            .map(m => ({ menu_id: m.id, name: m.name, desc: menuHint(m, AI3_DESC_MAX_CHARS) })),
        })),
      });
      const byId = new Map(cands.map(s => [s.id, s]));
      for (const j of res || []) {
        const s = byId.get(j?.store_id);
        if (!s || judged.has(s.id) || !['맞음', '일부', '안 맞음'].includes(j.match)) continue; // 없는 가게 버림
        const valid = new Map(eligible(s).map(m => [m.id, m]));
        const quotes = {};
        for (const q of j.quotes || []) {
          const m = valid.get(q?.menu_id);
          if (m && q.quote && m.desc.includes(q.quote)) quotes[m.id] = q.quote; // 원문 인용만
        }
        const menuIds = (Array.isArray(j.menu_ids) ? j.menu_ids : []).filter(id => valid.has(id)).slice(0, 5);
        const portionUnverified = terms.includes('푸짐') &&
          !menuIds.every(id => menuEvidence(valid.get(id), '푸짐'));
        judged.set(s.id, {
          match: portionUnverified && j.match === '맞음' ? '일부' : j.match,
          menu_ids: menuIds,
          quotes,
        });
      }
    } catch (e) { if (e.message !== 'LLM unavailable') console.warn('[AI ③] 실패 → 키워드 판단:', e.message); }
    for (const s of cands) {
      if (!judged.has(s.id) || (x.exact && !judged.get(s.id).menu_ids.length)) {
        // 계절 조건이 있으면 계절 근거가 있는 메뉴를 먼저 (AI에 보내는 가격순은 그대로)
        const pool = state.cond.season ? [...eligible(s)].sort((a, b) => seasonOf(b, state.cond) - seasonOf(a, state.cond)) : eligible(s);
        const matched = keywordJudge(pool, terms);
        judged.set(s.id, x.exact && !matched.menu_ids.length ? { ...keywordJudge(eligible(s), []), match: '일부' } : matched);
      }
      if (hasVerifiedMatches) {
        const verified = fullyVerified.get(s.id);
        judged.set(s.id, verified.length ? keywordJudge(verified, terms) : { match: '안 맞음' });
      }
    }

    const scoreAll = judgedMap => {
      const res = [];
      for (const s of cands) {
        const j = judgedMap.get(s.id);
        if (j.match === '안 맞음') continue;
        const allowed = new Set(j.menu_ids);
        const opts = x.plans(s).filter(plan => allowed.has(plan.menu.id) && x.fitsBudget(plan.total))
          .sort((a, b) => alternativeScore(b.menu) - alternativeScore(a.menu) || x.isVariant(a) - x.isVariant(b) ||
            seasonOf(b.menu, state.cond) - seasonOf(a.menu, state.cond) || x.cost(a) - x.cost(b) || a.total - b.total ||
            Number(a.estimated) - Number(b.estimated) || a.extraServings - b.extraServings || a.lines.length - b.lines.length);
        if (!opts.length) continue; // 대표 메뉴 없으면 제외
        const preferred = terms.includes('푸짐') && menu === '치킨'
          ? opts.find(({ menu }) => menuEvidence(menu, '푸짐')) ||
            opts.find(({ menu }) => wholeChickenEvidence.test(menu.name + ' ' + menu.desc))
          : null;
        const plan = preferred || opts[0];
        const { menu: m, total } = plan;
        const matchScore = alternativeLead ? 25 + alternativeScore(m) : j.match === '맞음' ? 50 : 25;
        const score = matchScore + priceScore(x.cost(plan), x, s) * 30 + ratingScore(s, x.avgRating) * 20 + contextScore(s, m, state.cond);
        res.push({ s, j, m, total, score, plan });
      }
      return res;
    };
    let scored = scoreAll(judged);
    // '다른 데는?'·'더 싼 걸로'처럼 이어서 고를 때는 맛 조건을 몰래 풀지 않는다: 모든 맛의 근거가 있는 메뉴만
    const noRelax = state.excludeSeen || state.cheaper;
    if (noRelax && terms.length) scored = scored.filter(row => terms.every(term => tasteOk(row.m, term, row.s)));

    // 맛 조건(예: 크림)을 가진 메뉴가 후보 어디에도 없어서 0곳이면: 그 조건만 비슷한 맛으로 바꿔서 → 그래도 없으면 빼고 다시 고른다.
    // 예산·프랜차이즈 등 필터는 그대로이고, 바꾼 사실은 화면에 밝힌다 (몰래 유지). 결과는 '일부'로만 표시.
    let swapped = null;
    const inMenus = w => left.some(s => eligible(s).some(m => menuEvidence(m, w)));
    const missing = terms.filter(t => !inMenus(t));
    if (!scored.length && terms.length && noRelax) return tasteMissing(state, terms);
    if (!scored.length && terms.length) {
      if (missing.length) {
        const kept = terms.filter(t => !missing.includes(t));
        const alike = [...new Set(missing.flatMap(t => SIMILAR[t] || []))].filter(inMenus);
        for (const tryTerms of alike.length ? [[...kept, alike], kept] : [kept]) {
          const relaxed = new Map(cands.map(s => {
            const j = keywordJudge(eligible(s), tryTerms);
            return [s.id, { ...j, match: j.match === '안 맞음' ? j.match : '일부' }];
          }));
          scored = scoreAll(relaxed);
          if (scored.length) { swapped = { missing, similar: tryTerms.find(Array.isArray) }; break; }
        }
      }
    }
    if (!scored.length && (x.exact || alternativeLead)) {
      scored = scoreAll(new Map(cands.map(s => [s.id, { ...keywordJudge(eligible(s), []), match: '일부' }])));
    }
    const leftIds = new Set(left.map(s => s.id));
    if (!scored.length) return budgetAlternatives(state, x, alternativeLead, limit) || zero(state, x, new Set(), alternativeLead || undefined);

    scored.sort((a, b) => b.score - a.score);
    const [first, ...rest] = scored;
    const peers = rest.filter(r => first.score - r.score <= 5).sort((a, b) => expo(a.s.id) - expo(b.s.id) || random() - 0.5);
    const priority = [first, ...peers, ...rest.filter(row => !peers.includes(row))];
    const brands = diversify(priority, row => row.s);
    let pool = state.excludeSeen ? [...brands.distinct, ...brands.repeated] : brands.distinct;
    if (mixedPick(state.cond)) { // 업종이 겹치지 않는 가게를 먼저
      const seenCategories = new Set();
      const firstOfEach = pool.filter(row => !seenCategories.has(row.s.category) && seenCategories.add(row.s.category));
      pool = [...firstOfEach, ...pool.filter(row => !firstOfEach.includes(row))];
    }
    const pick = pool.slice(0, limit);
    pick.sort((a, b) => b.score - a.score);

    const c = state.cond;
    const cards = pick.map(({ s, j, m, total, score, plan }) => {
      const checks = [s.region + ' ' + s.dong];
      checks.push(s.franchise ? '프랜차이즈' : '프랜차이즈 아님');
      const confirmed = terms.filter(t => tasteOk(m, t, s));
      checks.push(...confirmed);
      if (x.mode === 'budget') checks.push('예산');
      const unit = x.cost(plan);
      const base = x.baseFor(s);
      const save = base ? Math.round((base - unit) / 1000) * 1000 : 0;
      // 손님이 건 조건 중 충족한 것만 (영업 안 하는 가게는 이미 빠져 있으므로 영업중은 항상)
      const met = [
        ...(x.mode === 'budget' && x.fitsBudget(total) ? ['예산'] : []), '영업중',
        ...(c.franchise === 'exclude' && !s.franchise ? ['프랜차이즈 아님'] : c.franchise === 'only' && s.franchise ? ['프랜차이즈'] : []),
        ...confirmed,
      ];
      // AI가 이유를 못 줬으면 코드가 확인한 사실로 한 줄
      // (금액 차이는 카드의 가격 태그가 보여 주므로 여기선 반복하지 않는다)
      const fallbackReason = [
        save >= 1000 ? `동네 ${s.category} 보통 가격보다 싸고` : null,
        s.rating >= 4.5 ? `별점 ${s.rating}점으로 평이 좋아요` : null,
      ].filter(Boolean).join(', ').replace(/싸고$/, '싸요') || `${s.dong}에서 조건에 맞는 ${s.category} 가게예요`;
      const nearbyTaste = swapped?.similar?.find(term => menuEvidence(m, term));
      return {
        met, isNew: s.review_count === 0 || s.rating == null,
        storeId: s.id, name: s.name, ...planCard(plan, x.people), checks,
        partial: !!alternativeLead || j.match === '일부' || confirmed.length < terms.length,
        ...(confirmed.length < terms.length ? { missing: terms.filter(t => !confirmed.includes(t)) } : {}),
        valueLabel: base && save >= 1000 ? `${x.mode !== 'cheap' ? '1인분 기준 ' : ''}동네 ${s.category} 보통 가격보다 ${won(save)} 저렴` : null,
        ...(mixedPick(c) ? { foodLabel: s.category } : {}),
        rating: s.rating,
        reason: menuReason(m, confirmed) || (nearbyTaste ? `비슷한 ‘${nearbyTaste}’ 메뉴예요.` : '') || fallbackReason,
        quote: j.quotes?.[m.id] || m.desc,
        score: Math.round(score * 10) / 10,
      };
    });
    // 조건(예산 등)을 바꿨는데 TOP3가 그대로면, 고장처럼 보이지 않게 이유를 말해 준다
    const ids = pick.map(p => p.s.id);
    const same = state.lastTop.length === ids.length && ids.every(id => state.lastTop.includes(id));
    rememberCards(state, cards);
    const where = x.mode === 'budget' ? '예산 안에 드는' : '조건에 맞는';
    const missingNote = missing.length ? ` ‘${missing.join('·')}’ 조건은 메뉴 정보에서 확인하지 못했어요.` : '';
    const text = alternativeLead ? `${alternativeLead} 같은 ${c.menu} 카테고리에서 고른 대안이에요.${missingNote}`
      : swapped ? `'${swapped.missing.join('·')}' 조건을 확인할 수 있는 메뉴가 없어요. 대신 ${x.mode === 'budget' ? '같은 예산 안에서 ' : ''}${swapped.similar ? '비슷한 메뉴가 있는' : '다른 조건이 맞는'} 곳을 골랐어요.`
      : missing.length ? `‘${missing.join('·')}’ 조건은 메뉴 정보에서 확인하지 못했어요. 확인된 조건에 맞는 ${cards.length}곳을 골랐어요.`
      : cards.every(card => card.partial) ? `요청하신 조건을 모두 확인할 수는 없었어요. 확인 가능한 조건에 맞는 ${cards.length}곳이에요.`
      : contextLine(c) && !state.excludeSeen ? `${contextLine(c)} (${left.length}곳 중 ${cards.length}곳)`
      : isGroupPick(c) && !state.excludeSeen ? `${x.people}명이 함께 먹기 좋은 메뉴를 업종별로 ${cards.length}곳 골랐어요. 업종을 고르면 더 좁혀 드릴게요.`
      : mixedPick(c) && !state.excludeSeen ? `여러 음식 중에서 업종별로 ${cards.length}곳 골랐어요. 업종을 고르면 더 좁혀 드릴게요.`
      : !same ? `남은 ${left.length}곳 중 ${cards.length}곳을 골랐어요.`
      : left.length === cards.length ? `${where} 가게는 이 ${cards.length}곳이 전부라 결과가 그대로예요.`
      : `${where} ${left.length}곳 중에서는 이 ${cards.length}곳이 가장 잘 맞아요. 다른 곳도 보시려면 '다른 데는?'을 눌러 주세요.`;
    const remaining = left.filter(s => !state.seen.includes(s.id)).length;
    const variantButtons = (c.sub ? [] : VARIANTS[c.menu] ?? []).filter(w => !c.exclude.includes(w) &&
      left.some(s => x.items(s).some(m => isExcluded(m, [w])))).map(w => ({
        label: `${w} 빼고 보기`, action: { type: 'apply', cond: { exclude: [...c.exclude, w] } },
      }));
    const nextButton = left.length > cards.length || (dongMode(state) && !state.expand && !state.wide) ? { label: '다른 데 보기', action: { type: 'text', text: '다른 데는?' } } : null;
    // 맛 조건을 바꾸거나 못 맞춘 카드가 있으면 '같은 조건'이라고 말하지 않는다
    const allMatched = !swapped && !missing.length && cards.every(card => !card.missing);
    const unrated = c.min_rating != null && c.new_store === 'none' ? filterStores(state, x, { cond: { min_rating: null } }).filter(s => s.rating == null).length : 0;
    const ratingNote = unrated ? ` 별점이 아직 없는 신규 가게 ${unrated}곳은 별점 조건 때문에 뺐어요.` : '';
    const relaxButtons = !allMatched && terms.length ? tasteButtons(state, terms.filter(t => cards.some(card => card.missing?.includes(t)) || swapped?.missing.includes(t) || missing.includes(t))) : [];
    return out(state, {
      nextButton,
      text: (state.excludeSeen && allMatched ? `같은 조건에서 아직 보여드리지 않은 ${cards.length}곳이에요.` : text) + ratingNote,
      banner: x.mode === 'value' ? '예산을 말씀 안 하셔서 가성비 좋은 곳 위주로 골랐어요.' : null,
      cards,
      buttons: [...relaxButtons, ...variantButtons, ...(remaining ? [moreButton(remaining)] : []), ...(!alternativeLead && cards.length < 3 ? concessions(state, x, leftIds) : []), ...followUps().filter(b =>
        b.label !== '다른 데는?' && (state.dong !== ALL_REGIONS || b.label !== '다른 지역도 괜찮아요'))],
      remaining,
    });
  }

  // 맛 조건을 못 맞췄을 때 고르는 버튼: 그 조건 빼고 보기 / (같은 동이면) 주변 동네에서 그 맛 찾기
  function tasteButtons(state, unmet) {
    if (!unmet.length) return [];
    const label = unmet.map(t => `‘${t}’`).join('·');
    const what = state.cond.dish || state.cond.menu || '메뉴';
    const buttons = [{ label: `${label} 조건 빼고 보기`, action: { type: 'apply', cond: { taste: state.cond.taste.filter(t => !unmet.includes(t)) }, keepSeen: state.excludeSeen } }];
    if (dongMode(state) && !state.expand && !state.wide) {
      const wide = { ...state, expand: true, excludeSeen: true };
      const wx = ctx(wide);
      const n = filterStores(wide, wx).filter(s => wx.plans(s).some(p => wx.fitsBudget(p.total) && unmet.every(t => tasteOk(p.menu, t, s)))).length;
      if (n) buttons.push({ label: `주변 동네에서 ${unmet.join('·')} ${what} 더 찾기 (${n}곳)`, action: { type: 'apply', expand: true, keepSeen: true } });
    }
    return buttons;
  }
  // 이어서 고를 때 맛 근거가 있는 곳이 더 없으면: 사실을 말하고 버튼으로 고르게 한다 ('더 싼 걸로'면 그 맛 중 가장 싼 곳)
  function tasteMissing(state, terms) {
    const label = terms.map(t => `‘${t}’`).join('·');
    const what = state.cond.dish || state.cond.menu || '메뉴';
    if (state.cheaper) {
      const loose = { ...state, cond: { ...state.cond, budget: null, budget_under: false }, excludeSeen: false };
      const lx = ctx(loose);
      const best = filterStores(loose, lx, { ignoreBudget: true })
        .flatMap(s => lx.plans(s).filter(plan => terms.every(t => tasteOk(plan.menu, t, s))).map(plan => ({ s, plan })))
        .sort((a, b) => a.plan.total - b.plan.total)[0];
      if (best) {
        const { s, plan } = best;
        const cards = [{ storeId: s.id, name: s.name, ...planCard(plan, lx.people), checks: [s.region + ' ' + s.dong, ...terms], rating: s.rating, quote: plan.menu.desc,
          reason: menuReason(plan.menu, terms) }];
        rememberCards(state, cards);
        return out(state, {
          text: `${label} 메뉴 중에선 이게 가장 저렴해요. 이보다 싼 메뉴에는 ${label} 근거가 없어요.`,
          cards,
          buttons: [{ label: `${label} 조건 빼고 더 싼 곳 보기`, action: { type: 'apply', cond: { taste: state.cond.taste.filter(t => !terms.includes(t)) } } },
            ...followUps().filter(b => b.label === '처음부터')],
        });
      }
    }
    return out(state, {
      kind: 'concession',
      text: `${state.excludeSeen ? '남은 가게 중에는' : '조건에 맞는 가게 중에는'} ${label} 근거가 있는 ${what} 메뉴가 더 없어요. 어떻게 할까요?`,
      buttons: [...tasteButtons(state, terms), ...followUps().filter(b => b.label === '처음부터')],
      remaining: 0,
    });
  }

  // ---------- 대화형 단계 (guided) ----------
  // ② 동네 결정·처음부터: 친근한 첫 질문만 (음식 버튼 없음)
  function askFood(state, lead = '') {
    state.step = 'askFood';
    return out(state, {
      text: `${lead}${areaLabel(state)}${ro(areaLabel(state))} 배달해 드릴게요. 지금은 뭐가 먹고 싶어요? 누구랑 먹는지, 어떤 맛이 당기는지 편하게 말해 주세요.`,
      placeholder: '예: 둘이서 매콤한 거 먹고 싶어', focusInput: true,
    });
  }
  // 손님이 말한 조건을 짧게 받아 주는 말 (말한 것만)
  function ackText(c) {
    const people = c.people ? `${PEOPLE_WORD[c.people] ?? `${c.people}명이서`} 드실 거군요! ` : '';
    const total = c.budget == null ? null : c.budget * (c.budget_unit === 'per_person' ? c.people || 1 : 1);
    const remembered = [total != null && `예산 ${won(total)}`, c.price_pref === 'cheap' && '싸게', ...c.taste.map(t => `'${t}'`),
      c.franchise === 'exclude' && '프랜차이즈 말고', c.franchise === 'only' && '프랜차이즈만', c.goodPrice && '착한가게'].filter(Boolean);
    return people + (remembered.length ? `${remembered.join(', ')} 조건도 기억해 둘게요. ` : '');
  }
  // ③ 음식 종류 없이 말했을 때: 이 동네에 영업 중인 가게가 있는 카테고리, 많은 순 최대 8개 + 아무거나
  const CATEGORY_PICK_MAX = 8;
  function askCategory(state, ack = true) {
    state.step = 'pickCategory';
    const counts = new Map();
    for (const store of stores) if (inArea(store, state) && CATEGORIES.includes(store.category)) counts.set(store.category, (counts.get(store.category) ?? 0) + 1);
    const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, CATEGORY_PICK_MAX).map(([c]) => c);
    return out(state, {
      text: `${ack ? ackText(state.cond) : ''}혹시 이 중에 지금 땡기는 음식이 있나요?`,
      buttons: [...(top.length ? top : CATEGORIES).map(c => ({ label: c, action: { type: 'apply', cond: { menu: c } } })),
        { label: '아무거나 괜찮아요', action: { type: 'apply', cond: { anyMenu: true } }, ghost: true }],
      placeholder: '예: 치킨이나 떡볶이',
    });
  }
  // ④ 음식이 정해지면 예산 (한 대화에 한 번, 이미 예산·가격 의도가 있으면 건너뜀)
  function budgetButtons(state) {
    const people = state.cond.people || 1;
    const amounts = people > 1 ? [10000, 15000, 20000].map(v => v * people) : [10000, 20000, 30000];
    const labels = people > 1 ? amounts.map(v => `${people}인 ${manwon(v)}`) : ['1만 원 이하', '2만 원 정도', '3만 원 정도'];
    return [...amounts.map((v, i) => ({ label: labels[i], action: { type: 'apply', cond: { budget: v, budget_unit: 'total', price_pref: 'none' } } })),
      { label: '정하지 않을래요', action: { type: 'apply', cond: {} }, ghost: true }];
  }
  function budgetStep(state) {
    const c = state.cond;
    if (!guided || state.budgetAsked || c.budget != null || c.price_pref !== 'none' || state.excludeSeen) return null;
    state.step = 'askBudget';
    state.budgetAsked = true;
    const what = c.dish || (c.sub ? `${c.sub} ${c.menu}` : c.menu);
    return out(state, {
      text: `${what ? `좋아요, ${what}${ro(what)} 찾아볼게요!` : c.meal_time ? `좋아요, ${MEAL_KO[c.meal_time]} 메뉴로 골라 볼게요!` : '좋아요, 여러 음식 중에서 골라 볼게요!'} 예산은 얼마 정도로 생각하고 있나요?`,
      buttons: budgetButtons(state), flowStep: 'budget',
      placeholder: (c.people || 1) > 1 ? '예: 인당 1만 5천 원, 총 3만 원' : '예: 2만 원', focusInput: true,
    });
  }

  // 세부 메뉴 버튼: 선택한 지역에서 지금 조건으로 그 메뉴를 대표 메뉴로 파는 가게 수. 2개 미만이면 건너뛴다.
  function subMenuStep(state) {
    const c = state.cond;
    if (!c.menu || c.sub !== null || c.dish || c.store || c.taste.length || c.foods.length || state.excludeSeen || !SUBMENUS[c.menu]) return null;
    if (c.budget != null || c.price_pref !== 'none') return null; // "치킨 둘이서 3만 원"처럼 한 번에 말하면 바로 추천
    const options = SUBMENUS[c.menu].map(([label]) => {
      const trial = { ...state, cond: { ...c, sub: label } };
      return { label, n: filterStores(trial, ctx(trial)).length };
    }).filter(o => o.n > 0).sort((a, b) => b.n - a.n).slice(0, SUBMENU_MAX);
    if (options.length < 2) return null;
    if (guided) state.step = 'pickCategory';
    const total = filterStores({ ...state, cond: { ...c, sub: '' } }, ctx({ ...state, cond: { ...c, sub: '' } })).length;
    return out(state, {
      text: `어떤 ${c.menu}${/[가-힣]$/.test(c.menu) && (c.menu.charCodeAt(c.menu.length - 1) - 0xac00) % 28 ? '이' : '가'} 좋으세요?`,
      buttons: [...options.map(o => ({ label: `${o.label} (${o.n}곳)`, action: { type: 'apply', cond: { sub: o.label } } })),
        { label: '상관없어요', action: { type: 'apply', cond: { sub: '' } }, ghost: true }],
      remaining: total,
      subMenu: true, flowStep: 'sub',
    });
  }

  async function fromStep2(state, ai, ask = true, limit = 3) {
    state.awaitingRegion = false;
    state.lastRecommendations = [];
    state.preferredMenu = null;
    if (state.cond.foods.length > 1) return combinedFoodResults(state, limit);
    const subStep = subMenuStep(state);
    if (subStep) return subStep;
    const budgetAsk = budgetStep(state);
    if (budgetAsk) return budgetAsk;
    state.step = 'search';
    let x = ctx(state);
    let left = filterStores(state, x);
    let widened = false;
    if (!left.length && dongMode(state) && !state.expand && !state.wide && !state.excludeSeen) {
      state.expand = true;
      x = ctx(state);
      left = filterStores(state, x);
      widened = true;
    }
    if (state.excludeSeen && !left.length && !filterStores(state, x, { ignoreBudget: true }).length &&
        !(x.exact && state.cond.menu && filterStores(state, ctx(state, true), { ignoreBudget: true }).length)) {
      return out(state, {
        text: '같은 조건에서 더 보여드릴 후보가 없어요. 다른 지역이나 조건으로 찾아볼 수 있어요.',
        remaining: 0,
        buttons: followUps().filter(button => ['다른 지역도 괜찮아요', '처음부터'].includes(button.label) &&
          (button.label !== '다른 지역도 괜찮아요' || state.dong !== ALL_REGIONS)),
      });
    }
    let result;
    // 엄격 조건(안 매운·치즈 많이)은 메뉴 정보에 근거가 있어야 해서 0곳이 되기 쉽다 → 0곳이면 이유를 말한다
    const strictLead = () => {
      const { taste, franchise, menu } = state.cond;
      const candidate = `${franchise === 'exclude' ? '비프랜차이즈 ' : ''}${menu || '메뉴'}`;
      return taste.includes(MILD)
        ? `${areaLabel(state)}에서 맵지 않다고 표기된 ${candidate} 중 현재 조건에 맞는 곳을 찾지 못했어요.`
        : taste.includes(EXTRA_CHEESE)
          ? `${areaLabel(state)}에서 치즈 양이 많다는 근거가 있고 현재 조건에 맞는 ${candidate}를 찾지 못했어요.`
          : undefined;
    };
    if (!left.length && widened && !x.exact) {
      // 주변 3km까지 넓혀도 0곳: 조건을 하나씩 풀면 몇 곳인지 버튼으로
      return zero(state, x, new Set(), strictLead() ?? `${state.neighborhood}와 주변 3km 안에서 조건에 맞는 가게를 찾지 못했어요.`);
    }
    if (!left.length && x.exact) {
      const c = state.cond;
      const existsHere = stores.some(s => inArea(s, state) && (!c.menu || s.category === c.menu) &&
        (!c.store || matchesStore(c.store, s)) && x.items(s).length);
      const subject = [c.store, c.dish].filter(Boolean).map(v => `‘${v}’`).join('의 ');
      const lead = existsHere ? `${subject}에 해당하는 데이터는 있지만 현재 조건에 맞는 결과가 없어요.`
        : `${areaLabel(state)}에서 ${subject}에 해당하는 ${c.dish ? '메뉴' : '가게'}를 찾지 못했어요. 이 검색 범위에서는 선택할 수 없어요.`;
      const fallback = ctx(state, true);
      const alternatives = c.menu && !existsHere ? filterStores(state, fallback) : [];
      result = alternatives.length ? await results(state, fallback, alternatives, ai, lead, limit)
        : budgetAlternatives(state, existsHere || !c.menu ? x : fallback, lead, limit) || zero(state, x, new Set(), lead);
      if (!c.menu && !existsHere) {
        result.reply.text += ' 어떤 종류의 음식으로 대안을 찾아볼까요?';
        result.reply.buttons = [...menuButtons(), ...result.reply.buttons];
      }
    } else if (!left.length) {
      const lead = strictLead();
      result = budgetAlternatives(state, x, lead, limit) || zero(state, x, new Set(), lead);
    } else {
      result = await results(state, x, left, ai, '', limit);
    }
    if (widened && result.reply.cards?.length) result.reply.text = `${state.neighborhood}에는 조건에 맞는 곳이 없어서 3km 안의 주변 동까지 넓혀 찾았어요. ${result.reply.text}`;
    if (!result.reply.cards?.length) return result;
    const q = ask && left.length >= 2 && state.questions < 3 ? await question(state, left, x, ai) : null;
    state.awaitingRegion = !q && state.dong !== ALL_REGIONS;
    result.reply.followUp = q?.text || (state.dong === ALL_REGIONS ? '원하는 지역이나 맛, 예산이 있으면 말씀해 주세요.' : '다른 지역도 찾아볼까요? 맛이나 예산을 바꿔도 좋아요.');
    if (q) result.reply.buttons = [...q.buttons, ...result.reply.buttons];
    return result;
  }

  // ---------- 진입점 ----------
  async function handle(raw, action, ai) {
    const state = load(raw);
    const a = action && typeof action === 'object' ? action : {};

    if (a.type === 'dong') {
      if (!regions.includes(a.dong)) throw new Error('bad dong');
      const neighborhood = a.neighborhood && areas.get(a.neighborhood)?.has(a.dong) ? a.neighborhood : null;
      if (state.dong !== a.dong || state.neighborhood !== neighborhood || state.excludedRegion) {
        state.dong = a.dong;
        state.neighborhood = neighborhood;
        state.excludedRegion = null;
        state.wide = false;
        resetSearch(state);
      }
      if (canSearch(state)) return fromStep2(state, ai);
      if (guided) return askFood(state);
      return out(state, { text: `${areaLabel(state)}에서 찾아볼게요. 뭐 드시고 싶으세요? 인원·예산·취향을 편하게 말씀해 주세요.`, buttons: menuButtons() });
    }

    if (a.type === 'option') {
      const o = (state.pending || [])[a.index];
      if (!state.pending || (!o && a.index !== -1)) return out(state, { text: '이전 선택지는 만료됐어요. 원하는 조건을 다시 말씀해 주세요.' });
      if (o) {
        state.chosen.push(o);
        state.cond.taste = [o.label, ...mergeTaste(state.cond.taste, [o.label]).filter(term => term !== o.label)].slice(0, 8);
      }
      state.pending = null;
      return fromStep2(state, ai, !!o);
    }

    if (a.type === 'apply') {
      const next = a.cond && typeof a.cond === 'object' ? a.cond : {};
      const { cond } = state;
      const seen = state.seen;
      // 음식을 바꿔도 일반 맛 조건(매운·담백 등)은 유지한다. 음식에 붙은 조건(순살·치즈 듬뿍 등)만 지운다.
      const hadFood = cond.menu || cond.dish || cond.foods.length || cond.store;
      const taste = hadFood ? keepGeneral(cond.taste) : cond.taste;
      const kept = 'menu' in next && hadFood && next.menu !== cond.menu ? taste.filter(t => !('taste' in next)) : [];
      if ('menu' in next) resetSearch(state);
      setCond(state, 'menu' in next ? { dish: null, store: null, taste, ...next } : next);
      if (a.chosenRemove) {
        state.chosen = state.chosen.filter(ch => ch.label !== a.chosenRemove);
        state.cond.taste = state.cond.taste.filter(t => t !== a.chosenRemove);
      }
      if (a.cheapBoost) state.cheapBoost = Math.min(Number(a.cheapBoost) || 1, 1.5);
      if (a.expand) state.expand = true;
      if (a.keepSeen) { state.seen = seen; state.excludeSeen = true; }
      if (!canSearch(state)) return guided ? askCategory(state) : out(state, { text: '어떤 음식을 찾으세요?', buttons: menuButtons() });
      const result = await fromStep2(state, ai, !a.seenAgain);
      return kept.length ? withLead(result, keptNote(kept)) : result;
    }

    if (a.type === 'text') {
      const original = String(a.text || '').slice(0, 300);
      // 말끝·추임새·줄임말·사투리·외국어 음식 단어를 먼저 정리한다
      let cleaned = stripFillers(original);
      for (const [re, to] of SLANG) cleaned = cleaned.replace(re, to);
      // 성별은 조건으로 쓰지 않는다 (규칙 해석·AI 입력에서 뺀다)
      const fullText = cleaned.replace(GENDER_WORDS, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
      const intent = classifyIntent(fullText);
      // 안전 관련(위기·역할 유지·거절·지역 밖·범위 밖)·설명·모순은 추천하지 않고 바로 답한다. 이 문장은 AI에 넘기지 않는다.
      if (intent.stop) return intentReply(state, intent, fullText);
      const foreign = isForeign(original);
      const extra = { kind: intent.kind, lead: '', notices: [...(intent.notices ?? [])] };
      let text = fullText;
      // 브랜드 이름이 데이터 속 가게·메뉴 이름에 실제로 있으면(예: 마라로제엽떡) 그대로 찾는다
      const inData = re => stores.some(st => re.test(st.name) || menuGroups.get(st.id).some(m => re.test(m.name)));
      if (intent.brand && inData(new RegExp(intent.brand.re.source, 'i'))) { intent.brand = null; if (extra.kind === 'substitute') extra.kind = null; }
      if (intent.brand) {
        if (!intent.brand.instead) {
          return out(state, { kind: 'substitute', text: '실제 가게의 정보나 별점은 데이터에 없어서 알려 드릴 수 없어요. 대신 이 동네에서 별점 좋은 가게를 찾아 드릴까요?',
            buttons: [{ label: '별점 4.5 이상 가게 보기', action: { type: 'apply', cond: { min_rating: 4.5, anyMenu: true } } }] });
        }
        extra.lead = `‘${intent.brand.label}’ 같은 실제 브랜드 가게 정보는 없어서, 비슷한 ${intent.brand.instead}${ro(intent.brand.instead)} 찾아볼게요. `;
        text = text.replace(new RegExp(intent.brand.re.source, 'gi'), ' ').replace(/\s+/g, ' ').trim();
        text = `${text} ${intent.brand.instead}`.trim();
      } else if (intent.missing && !stores.some(st => inArea(st, { ...state, expand: true }) && menuGroups.get(st.id).some(m => intent.missing.find.test(m.name)))) {
        // 데이터를 찾아보고 없을 때만 대체 (있으면 그대로 추천)
        extra.kind = 'substitute';
        extra.lead = `‘${intent.missing.label}’ 메뉴는 이 근처 데이터에 없어요. 대신 ${intent.missing.why}${ro(intent.missing.why)} 찾아볼게요. `;
        text = text.replace(intent.missing.re, ` ${intent.missing.instead} `).replace(/\s+/g, ' ').trim();
      }
      if (intent.limit) extra.lead += '배달 시간·실시간 위치·예약·포장·결제 수단 정보는 없어서 확인해 드릴 수 없어요. 지금 영업 중인 가게만 골라 드릴게요. ';
      if (intent.health) {
        const allergy = extra.notices.includes('allergy_data_missing');
        const avoided = intent.avoid.filter(w => w !== '매운 거');
        extra.lead += `${allergy ? '성분·알레르기 정보는' : '비건·할랄 같은 인증 정보는'} 데이터에 없어서 안전하다고 말씀드릴 수 없어요. ` +
          (avoided.length ? `메뉴 이름·설명에 ${avoided.join('·')} 관련 단어가 보이는 메뉴는 뺐지만, ` : '') + '주문 전에 꼭 가게에 직접 확인해 주세요. ';
      }
      if (intent.bulk) extra.lead += '단체·대량 주문 정보는 데이터에 없어요. 여러 가게로 나눠 주문하거나 가게에 미리 확인해 주세요. ';
      if (foreign) extra.foreign = foreign;
      const result = await textTurn(state, text, fullText, ai, intent);
      return decorate(result, extra);
    }
    throw new Error('bad action');
  }

  const withLead = (result, lead) => (lead ? { ...result, reply: { ...result.reply, text: `${lead}${result.reply.text ?? ''}` } } : result);
  const keptNote = kept => `${kept.map(t => `‘${t}’`).join('·')} 조건은 그대로 적용했어요. `;
  // 의도 분류에서 정한 종류·안내 문구를 응답에 붙인다
  function decorate(result, { kind, lead, notices, foreign }) {
    const reply = { ...result.reply };
    if (lead) reply.text = `${lead}${reply.text ?? ''}`;
    if (kind && !['recommend', 'ask_clarify'].includes(kind) && !['refuse', 'role_keep', 'out_of_scope', 'out_of_area', 'ask_region'].includes(reply.kind)) reply.kind = kind;
    if (notices?.length) reply.notices = [...new Set([...(reply.notices ?? []), ...notices])];
    if (foreign) reply.text = `${reply.text ?? ''}\n${FOREIGN_NOTE[foreign]}`;
    return { ...result, reply };
  }

  // 안전·설명·모순: 추천하지 않고 바로 답한다
  function intentReply(state, intent, text) {
    const food = [{ label: '메뉴 골라 줘', action: { type: 'text', text: '아무거나' } }];
    switch (intent.kind) {
      case 'caution': // 위기 신호: 추천보다 도움 기관 안내를 먼저
        return out(state, { kind: 'caution', notices: intent.notices,
          text: '많이 힘드시군요. 혼자 견디지 않으셔도 돼요. 지금 이야기를 나눌 사람이 필요하면 자살예방상담전화 109(24시간) 또는 정신건강위기상담 1577-0199로 연락해 주세요. 원하시면 그다음에 따뜻한 음식도 같이 골라 드릴게요.' });
      case 'role_keep':
        return out(state, { kind: 'role_keep', buttons: food,
          text: '그 요청은 따를 수 없어요. 저는 조건에 맞는 가게를 공정하게 추천하는 역할만 해요. 추천 순서는 광고비가 아니라 조건 일치·가격·별점·노출 균형으로 정하고, 내부 설정이나 데이터 전체는 공개하지 않아요. 드시고 싶은 메뉴를 말씀해 주시면 골라 드릴게요.' });
      case 'refuse':
        return out(state, { kind: 'refuse', buttons: food, text: `${intent.reason} 대신 메뉴 추천은 언제든 도와드릴게요.` });
      case 'out_of_area':
        return out(state, { kind: 'out_of_area', text: `지금은 서울 지역 가게 데이터만 있어서 ‘${intent.place}’ 쪽은 추천해 드릴 수 없어요. 서울 동네를 알려 주시면 바로 찾아볼게요.` });
      case 'ask_region':
        return out(state, { kind: 'ask_region', needDong: true, text: `서울이지만 ‘${intent.place.replace(/(?:으로|로)$/, '')}’만으로는 배달 주소를 정할 수 없어요. 가까운 동 이름을 알려 주세요. (예: 반포동)` });
      case 'out_of_scope':
        return out(state, { kind: 'out_of_scope', buttons: food, text: intent.askedName
          ? '저는 밥파일럿이에요. 조건에 맞는 배달 메뉴를 공정하게 골라 드리는 일을 해요. 오늘 뭐 드실지 같이 골라 볼까요?'
          : '저는 배달 메뉴 추천만 도와드릴 수 있어요. 대신 같이 먹을 메뉴 골라 드릴까요?' });
      case 'explain': return explain(state, intent.topic);
      case 'ask_clarify': return conflictReply(state, intent.conflict, text);
      default: return out(state, { text: '어떤 음식을 찾으세요?' });
    }
  }

  function explain(state, topic) {
    const basis = '추천은 말씀하신 조건(음식·맛·예산·인원)에 맞는 가게 중에서 가격(1인분 기준)과 별점(리뷰 수로 보정)을 보고, 점수가 비슷하면 덜 노출된 가게를 먼저 보여 드려요.';
    const texts = {
      ad: `광고가 아니에요. 광고비를 받고 순서를 바꾸지 않아요. ${basis}`,
      goodPrice: '착한가게는 서울시가 지정한 ‘착한가격업소’예요. 물가 안정에 참여해 가격을 합리적으로 유지하는 가게라서 카드에 따로 표시해요.',
      newStore: '신규 가게는 아직 리뷰가 없어서 별점이 없어요. 별점이 없다고 빼지 않고, 조건에 맞으면 다른 가게와 같이 추천해요.',
      rating: `${basis} 별점이 높은 곳만 보고 싶으시면 아래에서 기준을 골라 주세요.`,
      history: '지난 대화 기록은 저장하지 않아서 어제 추천한 가게는 다시 보여 드릴 수 없어요. 드셨던 메뉴나 조건을 말씀해 주시면 다시 찾아 드릴게요.',
      how: basis,
    };
    if (topic === 'why') {
      const last = state.lastRecommendations.map(item => storesById.get(item.storeId)).filter(Boolean);
      const text = last.length
        ? `‘${last[0].name}’${last.length > 1 ? ` 등 ${last.length}곳` : ''}은 말씀하신 조건에 맞고, 같은 동네 비슷한 가게와 비교해 가격과 별점이 좋은 편이라 골랐어요. 광고비는 순서에 영향을 주지 않아요. ${basis}`
        : `아직 이 대화에서 추천한 가게가 없어요. ${basis}`;
      return out(state, { kind: 'explain', text, preserveResults: true });
    }
    return out(state, { kind: 'explain', text: texts[topic] ?? basis, preserveResults: true,
      buttons: topic === 'rating' ? [4.5, 4.0].map(v => ({ label: `별점 ${v} 이상만`, action: { type: 'apply', cond: { min_rating: v, ...(canSearch(state) ? {} : { anyMenu: true }) } } })) : [] });
  }

  // 모순된 조건: 어느 쪽을 우선할지 버튼 2개로 묻는다 (임의로 한쪽을 버리지 않는다)
  function conflictReply(state, conflict, text) {
    let { a, aText, b, bText, what } = conflict;
    if (!a) { // "X 먹고 싶은데 X는 빼줘"
      const word = conflict.match[1];
      [a, aText, b, bText] = [`${word}${ro(word)} 찾기`, `${word} 먹고 싶어`, `${word} 빼고 찾기`, `${word} 말고 다른 거`];
    } else if (/그 메뉴 그대로/.test(b)) {
      const dish = readFood(text.replace(/고기|밀가루/g, ' '))?.dish ?? readFood(text.replace(/고기|밀가루/g, ' '))?.menu;
      if (dish) { b = `${dish} 그대로`; bText = dish; }
    }
    return out(state, { kind: 'ask_clarify', text: `${what} 조건이 서로 부딪혀요. 어느 쪽을 우선할까요?`,
      buttons: [{ label: a, action: { type: 'text', text: aText } }, { label: b, action: { type: 'text', text: bText } }] });
  }

  // 모호한 요청: 업종 버튼 3~4개(시간대·노출 균형) + 인원·예산·맛을 한 번에 묻는다. 3번까지만 되묻고 그다음엔 가성비로 추천.
  function clarify(state, text) {
    state.clarifyCount = (state.clarifyCount ?? 0) + 1;
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hourCycle: 'h23' }).format(opts.now?.() ?? new Date()));
    const h = hour < 5 ? hour + 24 : hour;
    const byHour = CATEGORY_BY_HOUR.find(([[from, to]]) => h >= from && h < to)?.[1] ?? [];
    const here = new Map();
    for (const st of stores) if (inArea(st, state) && CATEGORIES.includes(st.category)) here.set(st.category, (here.get(st.category) ?? 0) + expo(st.id) + 1);
    const picks = [...byHour.filter(cat => here.has(cat)), ...[...here.keys()].sort((x, y) => here.get(x) - here.get(y))]
      .filter((cat, i, all) => all.indexOf(cat) === i).slice(0, 4);
    const usual = USUAL_RE.test(text) ? '이전 주문 기록은 없어서 늘 드시던 메뉴는 알 수 없어요. ' : '';
    return out(state, {
      kind: 'ask_clarify',
      text: `${usual}좋아요, 같이 골라 볼게요! 몇 분이 드시는지, 예산과 당기는 맛(매콤·담백·달달 등)을 한 번에 알려 주시면 딱 맞게 찾아 드릴게요. 바로 고르셔도 돼요.`,
      buttons: [...picks.map(cat => ({ label: cat, action: { type: 'apply', cond: { menu: cat } } })),
        { label: '아무거나 괜찮아요', action: { type: 'apply', cond: { anyMenu: true } }, ghost: true }],
      placeholder: '예: 둘이서 2만 원, 매콤한 거',
    });
  }

  // 데이터 안에서 가장 비싼 메뉴 (예산 무제한·100만 원어치 같은 요청)
  function priciest(state) {
    const rows = stores.filter(st => inArea(st, { ...state, expand: true })).flatMap(st => (mains[st.id] ?? []).map(m => ({ st, m })))
      .sort((x, y) => y.m.price - x.m.price).slice(0, 3);
    const cards = rows.map(({ st, m }) => ({ storeId: st.id, name: st.name, menuId: m.id, menu: m.name, qty: 1, total: m.price + st.tip,
      checks: [st.region + ' ' + st.dong], rating: st.rating, quote: m.desc }));
    if (cards.length) rememberCards(state, cards);
    return out(state, { kind: 'concession', cards,
      text: '한 번에 그만큼 주문하는 대량 주문 정보는 없어요. 대신 이 근처 데이터에서 가격대가 가장 높은 메뉴를 보여 드릴게요. 인원과 원하는 음식을 알려 주시면 그 안에서 다시 골라 드릴게요.' });
  }

  // 여러 사람·여러 가게 요청을 음식 항목으로 나눈다
  function splitRequest(t) {
    const perPerson = t.match(/(?:나는|난|저는|전)\s*([^,]+?)\s*,\s*(?:친구|동생|애|아이|와이프|남편|엄마|아빠|여친|남친|쟤|걔)(?:는|은)\s*(.+)$/);
    if (perPerson) {
      const foods = [perPerson[1], perPerson[2]].map(part => {
        const r = ruleParse(normalizeTasteRequests(part), freshCond());
        return { menu: r.menu ?? null, dish: r.dish ?? null, taste: r.taste ?? [] };
      }).filter(f => f.menu || f.dish || f.taste.length);
      if (foods.length === 2) return foods;
    }
    const thenDessert = t.match(/(.+?)\s*먹고\s+(.+?)(?:도|까지)\s*(?:다른\s*(?:가게|곳|데)|따로)/);
    if (thenDessert) {
      const foods = [thenDessert[1], thenDessert[2]].map(part => readFood(part) ?? (/밥|식사/.test(part) ? { menu: '한식', dish: null } : null)).filter(Boolean);
      if (foods.length === 2) return foods.map(f => ({ menu: f.menu, dish: f.dish }));
    }
    const listed = t.split(/[:：]/).at(-1);
    return listed !== t && /,/.test(listed) ? readFoodList(listed) : null;
  }

  async function textTurn(state, fullText, rawText, ai, intent) {
      // 맥락(먹은 것·피할 것·끼니·계절·상황·배달팁)을 먼저 떼어내고, 원하는 음식 판정은 나머지 문장(t)으로 한다
      const context = readContext(fullText);
      const contextRules = {};
      for (const [k, v] of Object.entries(context.rules)) {
        contextRules[k] = k === 'eaten' || k === 'avoid' ? [...state.cond[k], ...v] : v; // 먹은 것·피할 것은 대화 중 누적
      }
      // 건강·식이에서 피할 재료
      const healthAvoid = (intent.avoid ?? []).filter(w => w !== '매운 거').map(ingredient => ({ ingredient }));
      if (healthAvoid.length) contextRules.avoid = [...(contextRules.avoid ?? state.cond.avoid), ...healthAvoid];
      const t = context.rest;
      const ft = fixTypos(t);
      if (!t && !Object.keys(contextRules).length) return guided ? askFood(state) : out(state, { text: '어떤 음식을 찾으세요?', buttons: menuButtons() });
      if (/처음\s*부터|다시\s*시작/.test(ft)) {
        Object.assign(state, fresh(state.dong), { neighborhood: state.neighborhood });
        if (guided) return askFood(state, '처음부터 다시 할게요. ');
        return out(state, { text: '처음부터 다시 할게요. 뭐 드시고 싶으세요?', buttons: menuButtons() });
      }
      // 모호한 요청 ("아무거나", "배고파", "점메추"): 조건이 하나도 없을 때만 되묻는다
      const area0 = readArea(t);
      const bare = (area0?.label ? t.replace(area0.label, ' ') : t).replace(/\s+/g, ' ').trim();
      if (VAGUE_RE.test(bare) && !Object.keys(contextRules).length && !state.pending) {
        if (area0 && !area0.missing && area0.dong !== ALL_REGIONS && (area0.dong !== state.dong || (area0.neighborhood && area0.neighborhood !== state.neighborhood))) {
          state.dong = area0.dong; state.neighborhood = area0.neighborhood ?? state.neighborhood; resetSearch(state);
        }
        if (state.dong && (state.step === 'pickCategory' || state.clarifyCount >= 3)) {
          setCond(state, { anyMenu: true });
          state.budgetAsked = true;
          return fromStep2(state, ai);
        }
        if (state.dong) return clarify(state, t);
      }
      const searchText = normalizeTasteRequests(t);
      const rules = { ...(t ? ruleParse(searchText, state.cond) : {}), ...contextRules };
      if (healthAvoid.length || intent.avoid?.includes('매운 거')) {
        if (intent.avoid?.includes('매운 거')) rules.taste = mergeTaste(rules.taste ?? state.cond.taste, [MILD]);
      }
      // 극단적 인원·양: 단체는 20명까지만 계산, 대식가는 분량을 인원으로
      if (intent.bulk) rules.people = Math.min(intent.bulk, 20);
      if (intent.bigEater) rules.people = Math.min(intent.bigEater, 20);
      if (/가성비|가격\s*(?:은|는)?\s*상관/.test(ft)) state.budgetAsked = true; // 가격 의도를 말했으면 예산은 묻지 않는다
      // 주의·한계 안내가 붙는 요청은 예산을 다시 묻지 않고 후보부터 보여 준다
      if (['caution', 'limit_notice'].includes(intent.kind) || intent.bulk) state.budgetAsked = true;
      // ④ 예산 질문에 대한 답: 금액이면 아래 일반 흐름, "정하지 않을래요"면 가성비 모드, 못 읽으면 한 번만 다시 묻는다
      if (guided && state.step === 'askBudget' && rules.budget === undefined && rules.price_pref === undefined && rules.menu === undefined && rules.dish === undefined) {
        if (/정하지\s*않|안\s*정|상관\s*없|모르겠|아무|그냥|없어/.test(ft)) return fromStep2(state, ai);
        if (!Object.keys(rules).length && !readArea(t)) {
          if (!state.budgetRetry) {
            state.budgetRetry = true;
            return out(state, { text: '금액으로 알려 주세요. 예: 2만 원', buttons: budgetButtons(state), placeholder: '예: 2만 원', focusInput: true, flowStep: 'budget' });
          }
          return fromStep2(state, ai); // 그래도 못 읽으면 예산 없이(가성비 모드)
        }
      }
      if (rules.franchise === undefined && franchiseQuestion.test(t)) return answerFranchiseQuestion(state, t);
      const confirmation = confirmRecommendation(state, t);
      if (confirmation) return confirmation;
      const noPreference = /^(?:상관\s*없(?:어|어요|습니다)?|아무\s*거나|둘\s*다\s*좋아(?:요)?)[.!? ]*$/.test(t);
      const area = readArea(t) ?? (noPreference && (!state.dong || state.awaitingRegion) ? { dong: ALL_REGIONS, neighborhood: null } : null);
      if (area?.dong === ALL_REGIONS && !area.excludedRegion && dongMode(state)) {
        state.wide = true;
        state.excludeSeen = /다른|주변/.test(t) && state.seen.length > 0;
        if (Object.keys(rules).length) setCond(state, rules);
        return canSearch(state) ? fromStep2(state, ai) : guided ? askFood(state, '주변 동네(3km)까지 넓혀서 찾을게요. ') : out(state, { text: '주변 동네(3km)까지 넓혀서 찾을게요. 어떤 음식을 찾으세요?', buttons: menuButtons() });
      }
      if (area?.missing) return out(state, { kind: 'ask_region', text: `‘${area.missing}’의 등록 지역을 찾지 못했어요. 다른 지역을 말씀하시거나 검색 범위를 넓혀 보세요.`, buttons: [followUps()[2]] });
      if (area && zone && !area.neighborhood && state.neighborhood && area.dong === state.dong) area.neighborhood = state.neighborhood;
      const areaChanged = !!area && (state.dong !== area.dong || state.neighborhood !== area.neighborhood || state.excludedRegion !== (area.excludedRegion ?? null));
      if (areaChanged) {
        state.dong = area.dong;
        state.neighborhood = area.neighborhood;
        state.excludedRegion = area.excludedRegion ?? null;
        resetSearch(state);
      }
      const continuation = t.match(moreRequest) || t.match(/^(?:아까\s*(?:거|것|그거)?\s*말고\s*(?:다른\s*(?:거|곳|데|가게)?)?|그\s*(?:가게|집|곳|거)\s*말고(?:\s*다른\s*(?:데|곳|가게))?|(?:남은\s*)?후보\s*더\s*보기(?:\s*·.*)?|남은\s*후보\s*\d*\s*곳?\s*더\s*보기|다른\s*데\s*보기)[?!. ]*$/);
      if (canSearch(state) && !area && !Object.keys(rules).length && continuation) {
        if (state.cond.store && state.cond.menu && /^다른\s*(?:데|대|곳|가게|집)(?:도|는|은|을|를|[?!.\s]|$)/.test(t) && !continuation[1]) {
          const seen = state.seen;
          setCond(state, { store: null });
          state.seen = seen;
        }
        state.excludeSeen = true;
        if (dongMode(state)) state.expand = true; // 2단계: 3km 안의 동까지
        state.pending = null;
        const count = Number(continuation[1]) || (/전부|모두/.test(t) ? 36 : 3);
        return fromStep2(state, ai, false, Math.min(count, 36));
      }
      const foodText = searchText.split(/말고|대신(?:에)?|아니라/).at(-1);
      let foods = splitRequest(searchText) ?? readFoodList(foodText);
      // "커피랑 빵"처럼 같은 업종이면 나누지 않는다
      if (foods.length > 1 && foods.every(f => f.menu && !f.taste) && new Set(foods.map(f => f.menu)).size === 1 && !/한\s*가게|같은\s*가게/.test(t)) {
        rules.menu ??= foods[0].menu;
        if (foods.every(f => !f.dish || compact(f.dish) === compact(f.menu))) rules.dish = null;
        foods = [];
      }
      // 지역을 모르면 조건부터 저장하고 지역을 묻는다
      if (!state.dong && (foods.length > 1 || isGroupMeal({ ...state.cond, ...rules }))) state.dong = ALL_REGIONS;
      if (!state.dong) {
        if (Object.keys(rules).length) setCond(state, foods.length > 1 ? { ...rules, foods } : rules);
        const c = state.cond;
        const remembered = [c.people && `${c.people}명`, c.budget && manwon(c.budget * (c.budget_unit === 'per_person' ? c.people || 1 : 1)),
          c.menu, c.dish, ...c.taste].filter(Boolean);
        return out(state, { kind: 'ask_region', needDong: true,
          text: `${remembered.length ? `말씀하신 조건(${remembered.join('·')})은 기억해 둘게요. ` : ''}지역을 골라 주세요. 지역 이름을 입력하거나 “지역 상관없어”라고 입력해도 돼요.` });
      }
      // 비현실적 예산: 데이터 안의 가장 가까운 대안(최저가)이나 가장 비싼 메뉴로
      if (PRICEY_RE.test(t) || (rules.budget ?? 0) >= 300000) return priciest(state);
      const zeroPrice = ZERO_PRICE_RE.test(t);
      if (zeroPrice) rules.budget = 1;
      const people = rules.people ?? state.cond.people ?? 1;
      const totalAsk = rules.budget == null ? null : rules.budget * (rules.budget_unit === 'per_person' ? people : 1);
      if (totalAsk != null && (totalAsk < 3000 || totalAsk / people < 2000)) {
        setCond(state, { ...rules, ...(hasFood({ ...state.cond, ...rules }) ? {} : { anyMenu: true }), foods: [] });
        state.budgetAsked = true;
        const result = await fromStep2(state, ai);
        return withLead({ ...result, reply: { ...result.reply, kind: 'concession' } }, `${zeroPrice ? '0원' : won(totalAsk)}${people > 1 ? `(${people}명)` : ''}으로 주문할 수 있는 메뉴는 없어요. `);
      }
      if (rules.franchise !== undefined && !area && canSearch(state) &&
          (Object.keys(rules).length === 1 || (rules.menu === state.cond.menu && !rules.dish && !rules.taste && Object.keys(rules).length === 3))) {
        const store = state.cond.store && stores.find(store => matchesStore(state.cond.store, store));
        const clearStore = store && ((rules.franchise === 'exclude' && store.franchise) || (rules.franchise === 'only' && !store.franchise));
        setCond(state, { franchise: rules.franchise, ...(clearStore ? { store: null } : {}) });
        return fromStep2(state, ai);
      }
      if (foods.length > 1) {
        setCond(state, { ...rules, menu: null, dish: null, store: null, foods, sameStore: /한\s*가게|같은\s*가게/.test(t) });
        return fromStep2(state, ai);
      }
      const optionIndex = state.pending?.findIndex(o => compact(t) === compact(o.label));
      if (state.pending && (noPreference || optionIndex >= 0) && !areaChanged) {
        return handle(state, { type: 'option', index: noPreference ? -1 : optionIndex }, ai);
      }
      if (canSearch(state) && state.lastMin > 1 && !area && rules.menu === undefined && rules.budget === undefined &&
        /^(?:더\s*(?:싸게|사게|저렴하게|싼\s*(?:걸로|거|곳|데))|(?:가격|예산)\s*(?:을)?\s*(?:좀|조금|더)?\s*낮춰(?:\s*줘)?)[?! .]*$/.test(ft)) {
        setCond(state, { budget: state.lastMin, budget_unit: 'total', price_pref: 'none', budget_under: true });
        state.cheaper = true; // 맛 조건은 그대로: 그 맛 메뉴 중에서만 더 싼 곳
        return fromStep2(state, ai);
      }
      if (area && !Object.keys(rules).length && /지역|동네|서울|구|동/.test(t) && !/먹고|찾아|음식|메뉴/.test(t)) {
        return canSearch(state) ? fromStep2(state, ai) : guided ? askFood(state) : out(state, { text: `${areaLabel(state)}에서 어떤 음식을 찾으세요?`, buttons: menuButtons() });
      }

      const newText = searchText.split(/말고|대신(?:에)?|아니라/).at(-1).trim() || searchText;
      const named = findStoreName(newText, rules.dish);
      const storeQuery = (cheeseRequest.test(newText) && rules.menu && !rules.dish ? null : named) || newText.match(/[“"‘']([^”"’']{2,60})[”"’']\s*(?:가게|매장|식당)/)?.[1] ||
        newText.match(/(?:^|\s)([가-힣A-Za-z0-9·-]{2,40}(?:점|치킨집|식당))\s*(?:은|는|이|가|도)?\s*(?:있|찾|알려|어때|에서)/)?.[1];
      let parsed = {};
      try { parsed = await ai?.parse?.(fullText, aiParseCond(state.cond)) ?? {}; }
      catch (e) { if (e.message !== 'LLM unavailable') console.warn('[AI ①] 실패 → 규칙 기반:', e.message); }
      const foodIntent = /먹고|먹을|추천|메뉴|땡겨|당겨|있어|배달|바꿔|찾아|보여/.test(newText);
      const rawDish = foodIntent && typeof parsed.dish === 'string' && compact(parsed.dish).length >= 2 &&
        !cheeseRequest.test(parsed.dish) &&
        !CATEGORIES.includes(withoutDishModifiers(parsed.dish)) &&
        !/^(?:너가|네가|니가|당신이|배불리|배부르게|푸짐하게|든든하게|넉넉하게|한끼|한끼식사|식사|음식)$/.test(compact(parsed.dish)) &&
        compact(newText).includes(compact(parsed.dish)) && !CATEGORIES.includes(parsed.dish) ? parsed.dish : null;
      const literalDish = !area && newText.match(/^([가-힣A-Za-z\d]+(?:\s+[가-힣A-Za-z\d]+){0,2}?)\s*(?:이|가|을|를)?\s+(?:먹고\s*싶|추천해|찾아)/)?.[1];
      const dishWithCategory = typeof rules.menu === 'string' && !rules.dish && rawDish && compact(rawDish) !== compact(rules.menu);
      let next = { ...rules };
      if (dishWithCategory || (rules.menu === undefined && (rawDish || (!Object.keys(rules).length && literalDish)))) {
        next.menu = parsed.menu || null;
        next.dish = rawDish || literalDish;
        // AI로만 음식이 바뀌어도 일반 맛 조건은 유지한다
        if (next.dish !== state.cond.dish) next.taste ??= keepGeneral(state.cond.taste);
      } else if (rules.menu === undefined && parsed.menu && (foodIntent || /^[가-힣]{2,6}$/.test(newText)) && parsed.menu !== state.cond.menu && !Object.keys(rules).length && !area) {
        next = { menu: parsed.menu, dish: null, taste: keepGeneral(state.cond.taste) };
      }
      const namedCategory = named && stores.find(s => matchesStore(named, s))?.category;
      if (storeQuery) {
        next = { ...next, store: storeQuery, menu: next.menu || namedCategory || state.cond.menu, dish: next.dish ?? (namedCategory === state.cond.menu ? state.cond.dish : null) };
        if (namedCategory && namedCategory !== state.cond.menu) next.taste ??= keepGeneral(state.cond.taste);
      } else if (next.menu !== undefined || next.dish !== undefined) {
        next.store = null;
      }
      // AI가 뽑은 맥락 조건: 규칙이 확실히 잡은 값이 우선, 없을 때만 AI 값
      if (Array.isArray(parsed.eaten) && !('eaten' in next)) {
        const eatenNew = parsed.eaten.filter(e => e && (e.dish || e.menu) && compact(fullText).includes(compact(e.dish || '')));
        if (eatenNew.length) next.eaten = [...state.cond.eaten, ...eatenNew];
      }
      if (Array.isArray(parsed.avoid) && !('avoid' in next) && parsed.avoid.some(x => x && (x.dish || x.menu))) next.avoid = [...state.cond.avoid, ...parsed.avoid];
      for (const k of ['meal_time', 'season', 'delivery_tip_max']) if (!(k in next) && parsed[k] != null && parsed[k] !== state.cond[k]) next[k] = parsed[k];
      if ('season' in next && !('season_auto' in next)) next.season_auto = false;
      // 먹었다고 말한 음식이 AI dish로 잡히면 버린다 (같은 음식을 다시 원한다고 명시한 경우는 나머지 문장에 있어서 통과)
      if (next.dish && (next.eaten ?? []).some(e => sameDish(e.dish, next.dish)) && !compact(t).includes(compact(next.dish))) { next.dish = null; if (next.menu && !readFood(t)) next.menu = null; }
      // 빼달라고 한 음식이 AI dish/menu로 잡히면 버린다
      if (next.dish && (next.avoid ?? []).some(x => x.dish && sameDish(x.dish, next.dish))) next.dish = null;
      if (Array.isArray(parsed.taste)) {
        // AI가 돌려준 맛 단어도 표준어로 바꾼 뒤 저장한다 ('매콤' → '매운')
        const mentioned = parsed.taste.filter(term => typeof term === 'string' && compact(term).length >= 2 && compact(newText).includes(compact(term)) &&
          ![next.dish, next.menu, next.store, area?.label].some(v => compact(v) === compact(term)) &&
          !(rules.taste?.includes(MILD) && (hasMildWords(term) || hasSpicyWords(term))) &&
          !(rules.taste?.some(taste => CHICKEN_CUTS.includes(taste)) && chickenCut(term)) &&
          !(next.taste?.includes(EXTRA_CHEESE) && compact(term) === '치즈')).map(canonTaste);
        if (mentioned.length) next.taste = mergeTaste(next.taste ?? state.cond.taste, mentioned);
      }
      // "덜 맵게": 매운 → 안 매운으로 바꾸고, 이미 본 가게는 뺀다
      const lessSpicy = LESS_SPICY.test(t) && state.seen.length > 0;
      if (!Object.keys(next).length && !area) {
        if (guided && !canSearch(state)) return askCategory(state, false);
        return out(state, { text: canSearch(state) ? '바꿀 조건을 확인하지 못했어요. 음식 이름이나 지역, 예산을 말씀해 주세요.' : '어떤 음식을 찾으세요? 음식 이름이나 가게 이름을 말씀해 주세요.', buttons: menuButtons() });
      }
      const before = state.cond;
      const seen = state.seen;
      setCond(state, next);
      if (lessSpicy) { state.seen = seen; state.excludeSeen = true; }
      // 음식을 바꿨는데 일반 맛 조건을 유지했으면 한 줄 알린다
      const kept = (next.menu !== undefined || next.dish !== undefined) && hasFood(before) &&
        (next.menu !== before.menu || next.dish !== before.dish) ? state.cond.taste.filter(term => before.taste.includes(term) && KEEP_TASTES.includes(term)) : [];
      if (!canSearch(state)) return guided ? askCategory(state) : out(state, { text: '어떤 음식을 찾으세요?', buttons: menuButtons() });
      const result = await fromStep2(state, ai);
      return kept.length ? withLead(result, keptNote(kept)) : result;
  }

  const aiParseCond = c => ({ menu: c.menu, dish: c.dish, people: c.people, budget: c.budget, budget_unit: c.budget_unit, price_pref: c.price_pref, taste: c.taste, franchise: c.franchise,
    eaten: c.eaten, avoid: c.avoid, meal_time: c.meal_time, season: c.season, delivery_tip_max: c.delivery_tip_max });

  return { handle, regions, categories: CATEGORIES };
}
