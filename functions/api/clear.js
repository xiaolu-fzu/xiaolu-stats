/**
 * 清除统计数据：POST /api/clear
 *
 * 只清空 events（统计记录本身），**不动** excluded_ips（不统计名单）与表结构。
 * 需要密码：环境变量 CLEAR_PASSWORD（未配置时默认 LJH）。
 */
import { json, noContent, clean } from './_lib.js';

export async function onRequestOptions() { return noContent(); }

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求体不是合法 JSON' }, 400); }

  const password = clean(body.password, 40);
  const expected = env.CLEAR_PASSWORD || 'LJH';
  if (password !== expected) return json({ error: '密码不正确' }, 403);

  try {
    const before = await env.DB.prepare('SELECT COUNT(*) AS c FROM events').first();
    await env.DB.prepare('DELETE FROM events').run();
    const after = await env.DB.prepare('SELECT COUNT(*) AS c FROM events').first();
    const kept = await env.DB.prepare('SELECT COUNT(*) AS c FROM excluded_ips').first();
    return json({ ok: true, deleted: (before && before.c) || 0, remaining: (after && after.c) || 0, excluded_kept: (kept && kept.c) || 0 });
  } catch (e) {
    return json({ error: '清除失败：' + String(e).slice(0, 120) }, 500);
  }
}
