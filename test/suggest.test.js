import test from 'node:test';
import assert from 'node:assert/strict';
import { suggest, nearestGu, timeSlot, weatherKind } from '../dist/suggest.js';

test('추운 점심에는 따뜻한 김치찌개', () => {
  const s = suggest({ hour: 12, tempC: 2 });
  assert.equal(s.dish, '김치찌개');
  assert.equal(s.line, '오늘은 날씨가 추우니 따뜻한 김치찌개 어때요?');
});

test('비 오면 짬뽕, 더우면 초밥, 밤에는 날씨보다 야식', () => {
  assert.equal(suggest({ hour: 13, tempC: 15, rain: true }).dish, '짬뽕');
  assert.equal(suggest({ hour: 18, tempC: 31 }).dish, '초밥');
  assert.equal(suggest({ hour: 23, tempC: 0 }).dish, '족발');
});

test('날씨가 무난하면 시간대, 날씨 정보가 없어도 동작', () => {
  assert.equal(suggest({ hour: 8, tempC: 18 }).dish, '김밥');
  assert.equal(suggest({ hour: 12 }).dish, '비빔밥');
  assert.equal(suggest({ hour: 19 }).dish, '삼겹살');
});

test('나이대 선호가 상황 후보 안에 있으면 그것을 고른다', () => {
  assert.equal(suggest({ hour: 12, tempC: 2, ageGroup: '50대 이상' }).dish, '갈비탕');
  assert.equal(suggest({ hour: 23, ageGroup: '20대' }).dish, '떡볶이');
  // 후보 밖의 선호는 무시
  assert.equal(suggest({ hour: 8, ageGroup: '20대' }).dish, '김밥');
});

test('현재 위치가 속한 구는 경계로 판정 (구 중심이 더 가까운 옆 구로 틀리지 않는다)', () => {
  assert.equal(nearestGu(37.484, 127.033), '서초구');
  assert.equal(nearestGu(37.563, 127.037), '성동구');
  // 성수동: 광진구 중심(2.1km)이 성동구 중심(2.9km)보다 가깝지만 성동구
  assert.equal(nearestGu(37.5445, 127.0557), '성동구'); // 성수역 부근
  assert.equal(nearestGu(37.5402, 127.0700), '광진구'); // 건대입구역 부근
  assert.equal(nearestGu(37.5172, 127.0473), '강남구');
  assert.equal(nearestGu(35.18, 129.08), null); // 부산
  assert.equal(nearestGu(37.39, 127.11), null); // 성남 분당
});

test('경계값', () => {
  assert.equal(timeSlot(4), 'night');
  assert.equal(timeSlot(5), 'morning');
  assert.equal(timeSlot(21), 'night');
  assert.equal(weatherKind({ tempC: 8 }), 'cold');
  assert.equal(weatherKind({ tempC: 27 }), 'hot');
  assert.equal(weatherKind({ tempC: 20 }), null);
});
