/**
 * 埋点写入接口：POST /api/track
 *
 * 两种模式：
 *   1. type = "exclude_self"  → 把这次请求的来源地址登记为「不统计」，之后该地址的访问一律不计数
 *   2. 三种正常事件（page_view / project_open / link_click）→ 写入 events 表
 *
 * 设计要点：
 *   - 事件类型白名单，其余静默丢弃
 *   - 来自已登记地址的请求直接返回，不写库（用户自己的浏览不污染数据）
 *   - 统一返回 204，前端用 sendBeacon 发，不阻塞页面；任何异常都不影响访客
 *   - 不存 IP 原文到事件表；IP 只用于「排除名单」比对
 */
import { noContent, dayOf, clean } from './_lib.js';

const TYPES = new Set(['page_view', 'project_open', 'link_click']);
const EXCLUDE = 'exclude_self';

export async function onRequestOptions() { return noContent(); }

export async function onRequestPost({ request, env }) {
  let body;
  try { body = JSON.parse(await request.text()); } catch { return noContent(); }

  const type = clean(body.type, 20);
  const ip = request.headers.get('CF-Connecting-IP') || '';

  // ① 登记「不统计的地址」
  if (type === EXCLUDE) {
    if (ip) {
      try {
        await env.DB.prepare('INSERT OR REPLACE INTO excluded_ips (ip, note, created_at) VALUES (?,?,?)')
          .bind(ip, clean(body.note, 60) || null, Date.now()).run();
      } catch (e) { /* 静默 */ }
    }
    return noContent();
  }

  if (!TYPES.has(type)) return noContent();

  // ② 已登记地址的访问：不计数
  if (ip) {
    try {
      const hit = await env.DB.prepare('SELECT 1 AS one FROM excluded_ips WHERE ip = ? LIMIT 1').bind(ip).first();
      if (hit) return noContent();
    } catch (e) { /* 查询失败就按正常流程走 */ }
  }

  const ts = Date.now();
  try {
    await env.DB.prepare(
      'INSERT INTO events (ts, day, type, project, link_type, path, visitor, country, ref) VALUES (?,?,?,?,?,?,?,?,?)'
    ).bind(
      ts, dayOf(ts), type,
      clean(body.project, 60) || null,
      clean(body.linkType, 30) || null,
      clean(body.path, 120) || null,
      clean(body.visitor, 40) || 'anon',
      (request.cf && request.cf.country) || null,
      clean(body.ref, 120) || null
    ).run();
  } catch (e) { /* 静默失败 */ }
  return noContent();
}
