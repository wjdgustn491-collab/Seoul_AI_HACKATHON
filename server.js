// 로컬 실행용: npm start → http://localhost:3000 (dist/ 정적 파일 + /api/recommend). 배포는 Vercel이 같은 구조로 처리.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize, join } from 'node:path';
import handler from './api/recommend.js';

const root = new URL('./dist/', import.meta.url);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
const port = process.env.PORT || 3000;

http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/api/recommend') {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 200_000) { res.statusCode = 413; return res.end(); }
    }
    try { req.body = JSON.parse(body || '{}'); } catch { req.body = {}; }
    return handler(req, res);
  }
  const file = normalize(join('.', path.endsWith('/') ? path + 'index.html' : path));
  if (file.startsWith('..')) { res.statusCode = 403; return res.end(); }
  try {
    const data = await readFile(new URL(file.replaceAll('\\', '/'), root));
    res.setHeader('content-type', types[extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch { res.statusCode = 404; res.end('not found'); }
}).listen(port, () => console.log(`http://localhost:${port}  (AI: ${process.env.ANTHROPIC_API_KEY ? 'Claude' : '키 없음 → 코드만으로 동작'})`));
