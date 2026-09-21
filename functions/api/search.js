/**
 * 知识库检索：GET /api/search?q=关键词&project=youju&facet=技术&limit=6
 *
 * 策略（两层）：
 *   1. FTS5 全文索引（trigram）——快、能排序；
 *   2. 命中不足时用 LIKE 兜底——中文短查询（如 2 字「有据」）trigram 匹配不到。
 * 返回：{ query, count, results: [{ id, project, project_name, doc, doc_type, section, facet, title, text, keywords, score }] }
 */
import { json, noContent, clean } from './_lib.js';

export async function onRequestOptions() { return noContent(); }

/* 查询分词：中文没有空格，整句直接丢给 FTS5 必然匹配不到。
   做法：按标点/空格切段 → 短段直接作词，长段拆 3-gram → 去掉停用词，再用 OR 组合查询。 */
const STOP = /^(为什么|什么|怎么|怎样|哪些|哪个|如何|可以|是否|这个|那个|以及|还是|不用|只用|我们|你们|他们|一个|一下|就是|不是|用了|有过|做过|关于|介绍)$/;
function terms(q) {
  const whole = new Set(), bi = new Set(), tri = new Set();
  const parts = String(q).split(/[\s,，。.？?！!、；;：:（）()【】「」《》"'\-—_\/\\|]+/).filter(Boolean);
  for (const p of parts) {
    if (p.length <= 8) whole.add(p);            // 整词（短语，最精准）
    for (let i = 0; i + 2 <= p.length; i++) bi.add(p.slice(i, i + 2));    // 2-gram（中文实词多半是 2 字）
    for (let i = 0; i + 3 <= p.length; i++) tri.add(p.slice(i, i + 3));   // 3-gram（FTS 用）
  }
  const ok = t => t.length >= 2 && !STOP.test(t) && !/^[0-9]+$/.test(t);
  // 优先级：整词 → 2-gram → 3-gram（上限 12，避免条件过长）
  return [...[...whole].filter(ok), ...[...bi].filter(ok), ...[...tri].filter(ok)].slice(0, 12);
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const q = clean(url.searchParams.get('q') || '', 120);
  const project = clean(url.searchParams.get('project') || '', 30);
  const facet = clean(url.searchParams.get('facet') || '', 10);
  const limit = Math.min(20, Math.max(1, parseInt(url.searchParams.get('limit') || '6', 10) || 6));
  if (!q) return json({ query: '', count: 0, results: [] });

  const db = env.DB;
  let rows = [];

  const tlist = terms(q);

  // ① FTS5：把分词后的词用 OR 组合（trigram 需要 ≥3 字符，2 字词交给 LIKE 兜底）
  const ftsWords = tlist.filter(t => t.length >= 3);
  if (ftsWords.length) {
    try {
      const ftsQuery = ftsWords.map(t => '"' + t.replace(/"/g, '""') + '"').join(' OR ');
      let sql = 'SELECT c.id, c.project_id, c.project_name, c.doc_title, c.doc_type, c.section_path, c.facet, c.title, c.text, c.keywords, ' +
                'bm25(kb_chunks_fts, 6.0, 1.0, 3.0, 2.0, 2.0) AS score ' +
                'FROM kb_chunks_fts f JOIN kb_chunks c ON c.id = f.rowid WHERE kb_chunks_fts MATCH ?';
      const binds = [ftsQuery];
      if (project) { sql += ' AND c.project_id = ?'; binds.push(project); }
      if (facet) { sql += ' AND c.facet = ?'; binds.push(facet); }
      sql += ' ORDER BY score LIMIT ?';
      binds.push(limit);
      const r = await db.prepare(sql).bind(...binds).all();
      rows = r.results || [];
    } catch (e) { rows = []; }
  }

  // ② LIKE 兜底：任一分词命中即可（覆盖 2 字短词与 FTS 无结果的情况）
  if (rows.length < limit) {
    const words = (tlist.length ? tlist : [q]).map(t => '%' + t + '%');
    const conds = words.map(() => '(title LIKE ? OR text LIKE ? OR keywords LIKE ?)').join(' OR ');
    let sql = 'SELECT id, project_id, project_name, doc_title, doc_type, section_path, facet, title, text, keywords, 0 AS score ' +
              'FROM kb_chunks WHERE (' + conds + ')';
    const binds = [];
    words.forEach(w => { binds.push(w, w, w); });
    if (project) { sql += ' AND project_id = ?'; binds.push(project); }
    if (facet) { sql += ' AND facet = ?'; binds.push(facet); }
    sql += ' ORDER BY (CASE WHEN title LIKE ? THEN 0 ELSE 1 END), id LIMIT ?';
    binds.push('%' + q + '%', limit - rows.length);
    try {
      const r2 = await db.prepare(sql).bind(...binds).all();
      for (const row of (r2.results || [])) {
        if (!rows.some(function (x) { return x.id === row.id; })) rows.push(row);
      }
    } catch (e) { /* 忽略 */ }
  }

  return json({
    query: q, count: rows.length,
    results: rows.slice(0, limit).map(function (r) {
      return {
        id: r.id, project: r.project_id, project_name: r.project_name,
        doc: r.doc_title, doc_type: r.doc_type, section: r.section_path,
        facet: r.facet, title: r.title, text: r.text, keywords: r.keywords,
        score: r.score
      };
    })
  });
}
