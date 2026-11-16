// /api/recommend — Vercel 함수 겸 로컬 server.js 핸들러. 대화 상태는 클라이언트가 들고 다닌다(서버 저장 없음).
import { handle } from '../lib/engine.js';

export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('{}'); }
  try {
    const { state, action } = req.body || {};
    res.end(JSON.stringify(await handle(state, action)));
  } catch (e) {
    console.error(e);
    res.statusCode = 400;
    res.end(JSON.stringify({ error: '요청을 처리하지 못했어요.' }));
  }
}
