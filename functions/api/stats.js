/**
 * 统计查询接口：GET /api/stats?token=xxx&days=7
 * 需要环境变量 STATS_TOKEN；token 不对返回 403。
 */
import { json, noContent, today, dayBefore } from './_lib.js';

export async function onRequestOptions() { return noContent(); }

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || '';
  if (!env.STATS_TOKEN || token !== env.STATS_TOKEN) {
    return json({ error: '未授权：token 不正确' }, 403);
  }
  const days = Math.min(90, Math.max(1, parseInt(url.searchParams.get('days') || '7', 10) || 7));
  const db = env.DB;

  const [pv, uv, todayPv, projects, links, daily, categories, recent] = await Promise.all([
    db.prepare("SELECT COUNT(*) c FROM events WHERE type='page_view'").first(),
    db.prepare("SELECT COUNT(DISTINCT visitor) c FROM events").first(),
    db.prepare("SELECT COUNT(*) c FROM events WHERE type='page_view' AND day=?").bind(today()).first(),
    db.prepare("SELECT project, COUNT(*) c FROM events WHERE type='project_open' AND project IS NOT NULL GROUP BY project ORDER BY c DESC LIMIT 60").all(),
    db.prepare("SELECT project, link_type, COUNT(*) c FROM events WHERE type='link_click' GROUP BY project, link_type ORDER BY c DESC LIMIT 100").all(),
    db.prepare("SELECT day, SUM(CASE WHEN type='page_view' THEN 1 ELSE 0 END) pv, COUNT(DISTINCT visitor) uv FROM events WHERE day>=? GROUP BY day ORDER BY day").bind(dayBefore(days - 1)).all(),
    db.prepare("SELECT type, COUNT(*) c FROM events GROUP BY type").all(),
    db.prepare("SELECT ts, type, project, link_type FROM events ORDER BY id DESC LIMIT 30").all(),
  ]);

  const sum = (rows, k) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
  return json({
    pv: pv.c, uv: uv.c, today: todayPv.c,
    days,
    totals: categories.results,
    totalEvents: sum(categories.results, 'c'),
    projects: projects.results,
    links: links.results,
    daily: daily.results,
    recent: recent.results,
  });
}
