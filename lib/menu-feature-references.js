// These are ideas for the seller's draft, drawn from the linked public recipes.
const references = [
  {
    dish: /떡볶이|떡뽁이|엽떡|라볶이/,
    source: '떡볶이 레시피',
    url: 'https://github.com/Synchiii/K-Cuisine-Master/blob/main/Tteokbokki%20%28Spicy%20Rice%20Cakes%29.html',
    options: [
      { text: '쫄깃한 떡', exclude: /떡(?:은|이)?\s*(?:없|제외)|떡\s*없이/ },
      { text: '걸쭉한 소스', exclude: /국물|묽은|맑은/ },
    ],
  },
  {
    dish: /제육/,
    source: '제육볶음 레시피',
    url: 'https://github.com/Synchiii/K-Cuisine-Master/blob/main/Jeyuk%20Bokkeum.html',
    options: [{ text: '양념에 볶은 제육', exclude: /제육(?:은|이)?\s*(?:없|제외)|굽|구이/ }],
  },
  {
    dish: /돈[가까]스/,
    source: '돈가스 레시피',
    url: 'https://github.com/willsower/imamu-room-recipes/blob/main/recipes/tonkatsu-sep11%2C2017.md',
    options: [{ text: '바삭한 돈가스', exclude: /눅눅|부드러운 튀김옷/ }],
  },
  {
    dish: /치킨|통닭|후라이드|프라이드/,
    source: '한국식 프라이드치킨 레시피',
    url: 'https://github.com/andhudhow/hancooking/blob/master/db/seeds.rb#L52-L53',
    options: [{ text: '바삭한 튀김옷', exclude: /도시락|샐러드|구이|구운|숯불|로스트|오븐|직화|찜|튀김옷\s*(?:없|없이)/ }],
  },
  {
    dish: /피자/,
    source: '나폴리 피자 도우 레시피',
    url: 'https://github.com/hendricius/pizza-dough/blob/master/README.md',
    options: [{ text: '폭신한 도우 가장자리', exclude: /씬|크래커|얇은|바삭한 도우/ }],
  },
];

export function menuFeatureReference({ name, notes, taste, features }) {
  if (features) return null;
  const reference = references.find(({ dish }) => dish.test(name));
  if (!reference) return null;
  const provided = [name, notes, taste].join(' ');
  const options = reference.options.filter(({ text, exclude }) => !provided.includes(text) && !exclude.test(provided))
    .map(({ text }) => text);
  return options.length ? { source: reference.source, url: reference.url, options } : null;
}
