// CSV 파서: 큰따옴표로 감싼 값(쉼표·줄바꿈·"" 포함), CRLF, 첫 열 이름 앞 BOM 처리. split(",")로는 안 된다.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// 헤더 행을 키로 쓰는 객체 배열. 빈 값은 빈 문자열 그대로.
export function readCsvObjects(text) {
  const [header = [], ...rows] = parseCsv(text);
  if (header.length) header[0] = header[0].replace(/^﻿/, '');
  return rows.filter(r => r.length > 1 || r[0] !== '').map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}
