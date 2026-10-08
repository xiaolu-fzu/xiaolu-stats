/* 临时诊断接口（仅测试项目使用，不进生产）：
   分别计时「纯 FTS 检索」与「FTS + 向量嵌入 + RRF 融合」，用于量化混合检索的额外延迟。
   用法：/api/kbping?q=问题&project=项目名 */
import { json, noContent, clean } from './_lib.js';
export const onRequestOptions = () => noContent();

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const q = clean(u.searchParams.get('q'), 200);
  const project = clean(u.searchParams.get('project'), 80);
  if (!q) return json({ error: '缺少 q' }, 400);

  const t0 = Date.now();
  let idxMs = 0, embedMs = 0, vecMs = 0, rows = 0, top = null;

  /* ① 向量索引加载（isolate 缓存命中则为 0） */
  let t = Date.now();
  try {
    const r = await env.DB.prepare('SELECT v.id AS id, v.vec AS vec, c.project_name AS pn FROM kb_vectors v JOIN kb_chunks c ON c.id = v.id').all();
    idxMs = Date.now() - t;
    rows = (r.results || []).length;
  } catch (e) { idxMs = -1; }

  /* ② 查询嵌入 */
  t = Date.now();
  let qv = null;
  try {
    const out = await env.AI.run('@cf/baai/bge-m3', { text: [q] });
    qv = out && out.data && out.data[0];
    embedMs = Date.now() - t;
    if (qv && qv.length) { let n = 0; for (const x of qv) n += x * x; n = Math.sqrt(n) || 1; qv = Array.from(qv, x => x / n); }
  } catch (e) { embedMs = -1; top = 'embed 失败: ' + String(e).slice(0, 60); }

  /* ③ 纯 FTS 检索计时 */
  let ftsMs = 0, ftsN = 0;
  t = Date.now();
  try {
    const terms = [];
    for (let i = 0; i + 3 <= q.length; i++) terms.push(q.slice(i, i + 3));
    if (terms.length) {
      const expr = terms.slice(0, 12).map(x => '"' + x.replace(/"/g, '""') + '"').join(' OR ');
      let sql = 'SELECT c.id AS id, c.title AS title FROM kb_chunks_fts f JOIN kb_chunks c ON c.id = f.rowid WHERE kb_chunks_fts MATCH ?';
      const binds = [expr];
      if (project) { sql += ' AND instr(lower(c.project_name), lower(?)) > 0'; binds.push(project); }
      sql += ' ORDER BY bm25(kb_chunks_fts, 8.0, 1.0, 3.0, 2.0, 1.5) LIMIT 24';
      const r = await env.DB.prepare(sql).bind(...binds).all();
      ftsN = (r.results || []).length;
    }
  } catch (e) { ftsMs = -1; }
  ftsMs = Date.now() - t - ftsMs;

  return json({
    question: q, project: project || '(未锁定)',
    向量索引行数: rows, 索引加载ms: idxMs,
    嵌入ms: embedMs,
    纯FTS_ms: ftsMs, FTS命中: ftsN,
    总耗时ms: Date.now() - t0,
    说明: '索引加载只在冷启动出现（isolate 缓存 10 分钟）；嵌入是每题必付的固定成本',
  });
}
