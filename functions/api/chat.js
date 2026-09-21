/**
 * 作品集助手：POST /api/chat
 *
 * 职责只有三件（与 youju/santi 的后端同一套思路）：
 *   1. 把浏览器发来的「问题 + 前端检索到的项目资料」转给 DeepSeek
 *   2. 转发时补上 Authorization: Bearer <API_KEY>（key 存加密环境变量，不进仓库）
 *   3. 返回文本 + 一个可选的「动作指令」，由前端执行（打开项目 / 打开链接 / 切分类）
 *
 * 服务器完全不懂业务：检索在前端完成，这里只是带钥匙的转发器 + 一个约束输出格式的提示词。
 */
import { json, noContent, clean } from './_lib.js';

export async function onRequestOptions() { return noContent(); }

const SYSTEM = [
  '你是「李嘉豪个人作品集」网站的导览助手。',
  '只依据下面给出的项目资料回答，绝对不要编造资料里没有的项目、数字或链接。',
  '回答要求：中文；简洁，3~6 句；先给结论再给依据；不要使用 Markdown 标记（不要 ** 或 #），换行用纯换行。',
  '如果用户的意图是「打开/跳转/查看某个项目或链接」，除了回答，再给一个动作指令。',
  '动作可选值：',
  '  {"type":"open_project","target":"项目标题"}  —— 打开该项目的详情',
  '  {"type":"open_link","target":"完整链接"}      —— 直接打开链接（只能用资料里出现过的链接）',
  '  {"type":"filter","target":"分类名"}           —— 切换作品集分类（数据分析/行业研究/原型和产品/Agent开发/AIGC/网页游戏/工具/开发）',
  '只输出 JSON 对象，形如：{"reply":"回答正文","action":null 或 {"type":"...","target":"..."}}'
].join('\n');

export async function onRequestPost({ request, env }) {
  if (!env.DEEPSEEK_API_KEY) return json({ error: '服务端未配置 API Key' }, 503);

  let body;
  try { body = JSON.parse(await request.text()); } catch { return json({ error: '请求体不是合法 JSON' }, 400); }

  const question = clean(body.question, 500);
  const context = clean(body.context, 12000);
  if (!question) return json({ error: '问题不能为空' }, 400);

  const user = '项目资料：\n' + (context || '（暂无可参考资料）') + '\n\n用户问题：' + question;

  const base = (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
  let upstream;
  try {
    upstream = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.DEEPSEEK_API_KEY },
      body: JSON.stringify({
        model: env.LLM_MODEL || 'deepseek-chat',
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
        temperature: 0.3,
        max_tokens: 800,
        response_format: { type: 'json_object' }
      })
    });
  } catch (e) {
    return json({ error: '上游连接失败：' + String(e).slice(0, 120) }, 502);
  }
  if (!upstream.ok) {
    const t = await upstream.text();
    return json({ error: '上游 ' + upstream.status + '：' + t.slice(0, 200) }, 502);
  }

  const data = await upstream.json();
  const text = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch (e2) {} }
  }
  if (!parsed || typeof parsed.reply !== 'string') return json({ reply: text || '（模型没有返回内容）', action: null });
  return json({ reply: parsed.reply, action: parsed.action && parsed.action.type ? parsed.action : null });
}
