/**
 * 埋点写入接口：POST /api/track
 * 设计要点：
 *   1. 只接收三种事件，其余一律静默丢弃（避免被当通用接口滥用）
 *   2. 用 204 无内容返回，前端用 sendBeacon 发，不阻塞页面
 *   3. 写库失败也不报错 —— 统计不能影响访客体验
 *   4. 不存 IP 原文，只存 Cloudflare 提供的国家代码
 */
import { noContent, dayOf, today, clean } from './_lib.js';

const TYPES = new Set(['page_view', 'project_open', 'link_click']);

export async function onRequestOptions() { return noContent(); }

export async function onRequestPost({ request, env }) {
  let body;
  try { body = JSON.parse(await request.text()); } catch { return noContent(); }
  const type = clean(body.type, 20);
  if (!TYPES.has(type)) return noContent();

  // 后台黑名单：把不想统计的访客 ID 放进环境变量 IGNORED_VISITORS（逗号分隔）
  const visitorId = clean(body.visitor, 40) || 'anon';
  const ignored = String(env.IGNORED_VISITORS || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (ignored.indexOf(visitorId) >= 0) return noContent();

  const ts = Date.now();
  try {
    await env.DB.prepare(
      'INSERT INTO events (ts, day, type, project, link_type, path, visitor, country, ref) VALUES (?,?,?,?,?,?,?,?,?)'
    ).bind(
      ts,
      dayOf(ts),
      type,
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
