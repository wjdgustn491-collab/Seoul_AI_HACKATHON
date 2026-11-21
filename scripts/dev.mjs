// 로컬 실행: dist 정적 파일 + /api/recommend (Vercel 함수 그대로 사용)
// 추천 API는 dist/data(동 단위, npm run build:data)를 읽는다. 사장님 메뉴 수정 경로만 Supabase 카탈로그를 쓰며,
// local/catalog.json(npm run fetch:catalog)이 있으면 그 요청을 로컬 파일로 돌려준다.
// 실행: npm run dev  →  http://localhost:4173/recommend.html
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const catalogFile = new URL('local/catalog.json', root);
const PORT = Number(process.env.PORT) || 4173;

// API 코드는 그대로 두고, snapshot 요청만 로컬 파일로 돌려준다
if (existsSync(catalogFile)) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => String(url).endsWith('/rpc/seoul_recommendation_snapshot')
    ? new Response(await readFile(catalogFile), { headers: { 'content-type': 'application/json' } })
    : realFetch(url, init);
  console.log('가게 데이터: local/catalog.json');
} else {
  console.log('가게 데이터: Supabase (느릴 수 있음, npm run fetch:catalog 로 로컬 저장 권장)');
}
// 로컬 기본값: Gemini 없이 규칙 기반. Gemini를 쓰려면 LLM_PROVIDER=gemini + GEMINI_API_KEY
process.env.LLM_PROVIDER ||= 'none';
console.log('AI:', process.env.LLM_PROVIDER === 'none' ? '사용 안 함 (규칙 기반)' : process.env.LLM_PROVIDER);

const { default: handler } = await import(new URL('api/recommend.js', root));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/recommend') {
    let body = '';
    for await (const chunk of req) body += chunk;
    req.body = body || undefined;
    res.status = code => { res.statusCode = code; return res; };
    res.json = value => { res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); };
    const t = Date.now();
    // 로딩 표시 확인용: DEV_DELAY_MS=3000 처럼 주면 API 응답을 늦춘다
    if (Number(process.env.DEV_DELAY_MS)) await new Promise(r => setTimeout(r, Number(process.env.DEV_DELAY_MS)));
    await handler(req, res);
    console.log(`${req.method} /api/recommend ${res.statusCode} ${Date.now() - t}ms`);
    return;
  }
  const file = new URL('dist' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)), root);
  if (!fileURLToPath(file).startsWith(fileURLToPath(new URL('dist', root)))) { res.statusCode = 403; return res.end(); }
  try {
    res.setHeader('content-type', types[extname(file.pathname)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end('not found'); }
}).listen(PORT, () => console.log(`http://localhost:${PORT}/recommend.html`));
