/* 共用工具（文件名以 _ 开头，Cloudflare Pages 不会当作路由） */

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });

export const noContent = () => new Response(null, { status: 204, headers: CORS });

/** 按东八区切天，返回 YYYY-MM-DD */
export function dayOf(ts) {
  return new Date(ts + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
export function today() { return dayOf(Date.now()); }
export function dayBefore(n) { return dayOf(Date.now() - n * 86400000); }

/** 清洗字符串：去除控制字符、限长，避免脏数据入库 */
export function clean(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max || 80);
}
