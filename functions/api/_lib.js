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

/** ⚠️ LIKE 安全封装（2026-10-08 实测发现）
    Cloudflare D1 对 LIKE 的 pattern 有 **50 字节上限**，超过就报
    "LIKE or GLOB pattern too complex: SQLITE_ERROR [code: 7500]"，且语句整体失败。
    中文一字 3 字节 → **pattern 里汉字超过 16 个就必然越界**
    （实测：16 汉字/50 字节 OK，17 汉字/53 字节报错）。
    这个限制此前造成了两类线上故障，且都被 catch 静默吞掉、表现为「知识库 0 命中」：
      ① ORDER BY 里的「整句匹配」微调 → 询问超过 16 字就整条语句失败；
      ② 按项目名过滤 → 项目名超过 16 字（如「《三体》·角色扮演 RAG · 短期记忆对话」59 字节）同样失败。
    对策：短文本继续用 LIKE；超过 16 字的改用 instr()——无长度限制，
    也不再占用 LIKE 的复杂度预算。注意 instr 区分大小写，故两侧都 lower()。
    用法：const c = likeSafe('c.project_name', hint); sql += ' AND ' + c.cond; binds.push(c.bind); */
export const likeSafe = (col, val) => {
  const s = String(val == null ? '' : val);
  return s.length <= 16
    ? { cond: col + ' LIKE ?', bind: '%' + s + '%' }
    : { cond: 'instr(lower(' + col + '), lower(?)) > 0', bind: s };
};

/** 清洗字符串：去除控制字符、限长，避免脏数据入库 */
export function clean(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max || 80);
}
