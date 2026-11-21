// [현재 위치] = 손님의 등록 배달 주소. 브라우저 위치(geolocation)는 쓰지 않는다.
// 등록 주소에서 구·동을 찾지 못하면 시연 기본 주소를 쓴다 (엔진 상태 형식: dong = 구, neighborhood = 동).
export const DEMO_HOME = { dong: '광진구', neighborhood: '화양동' };

// 주소 글자(예: "서울 광진구 화양동 12-3")에서 데이터에 있는 구·동을 찾는다. dongList: [{ dong, gu }]
export function homeFromAddress(text, dongList) {
  const address = String(text ?? '');
  const hit = dongList
    .filter(d => address.includes(d.gu) && address.includes(d.dong.replace(/\(.*\)$/, '')))
    .sort((a, b) => b.dong.length - a.dong.length)[0];
  return hit ? { dong: hit.gu, neighborhood: hit.dong } : null;
}

// 고객 화면(customer.js)이 저장한 배달 주소 (localStorage "seoul-demo-addresses" / "seoul-demo-address")
export function savedAddressText(storage = globalThis.localStorage) {
  try {
    const list = JSON.parse(storage.getItem('seoul-demo-addresses')) ?? [];
    const active = JSON.parse(storage.getItem('seoul-demo-address'));
    const address = list.find(item => item.id === active) ?? null;
    return address ? [address.road, address.detail].filter(Boolean).join(' ') : '';
  } catch { return ''; }
}

export const homeOf = (dongList, storage) => homeFromAddress(savedAddressText(storage), dongList) ?? DEMO_HOME;
