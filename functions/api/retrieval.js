/* 临时诊断接口（仅测试项目）：只跑检索、不调大模型 —— 用于低成本评测。
   用法：/api/retrieval?q=问题&project=项目名&mode=fts|hybrid
   两种模式**复用 chat.js 里同一套函数**，保证与线上路径一致、不会漂移。 */
import { json, noContent, clean } from './_lib.js';
import { searchKB, searchKBOnce, projKeys } from './chat.js';
export const onRequestOptions = () => noContent();

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const q = clean(u.searchParams.get('q'), 200);
  const project = clean(u.searchParams.get('project'), 80);
  const mode = u.searchParams.get('mode') === 'hybrid' ? 'hybrid' : 'fts';
  if (!q) return json({ error: '缺少 q' }, 400);

  const t0 = Date.now();
  let hits = [];
  try {
    if (mode === 'hybrid') {
      hits = await searchKB(env, q, 8, project || null);
    } else {
      if (project) {
        const keys = projKeys(project);
        for (let i = 0; i < keys.length; i++) {
          const r = await searchKBOnce(env, q, 8, keys[i]);
          if (r.length) { hits = r; break; }
        }
      } else {
        hits = await searchKBOnce(env, q, 8, null);
      }
    }
  } catch (e) { return json({ error: String(e).slice(0, 200) }, 500); }

  return json({
    mode, ms: Date.now() - t0, count: hits.length,
    hits: hits.map(h => ({ id: h.id, title: h.title, facet: h.facet, project: h.project_name })),
  });
}
