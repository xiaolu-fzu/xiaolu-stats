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
  '你是「小洄」，李嘉豪个人作品集网站的 AI 助手。性格亲切、说话自然，像真人助手（不要机械罗列、不要客服腔）。',
  '只依据下面给出的项目资料回答，绝对不要编造资料里没有的项目、数字或链接；资料里没有的就直说不知道。',
  '【接着聊】下面会给出最近几轮对话，请顺着上下文回答：用户说「这两个 / 它们 / 那几个 / 刚才说的」时，指的就是你上一轮列举过的项目，直接按这个理解回答，不要反问用户「你指哪两个」。',
  '回答要求：中文口语化，2~5 句，先给结论再给依据；不要 Markdown 标记（不要 ** # 等），换行用纯换行。',
  '',
  '════════ 你可以调用的工具（只此五类，其余一律不做）════════',
  '把 action 当作一次「工具调用」来填。工具清单与参数：',
  '',
  '1) filter —— 滑动/切换作品集分类',
  '   {"type":"filter","target":"<分类名>"}',
  '   <分类名> 只能取：原型和产品 | Agent开发 | 数据分析 | 行业研究 | AIGC | 网页游戏 | 工具/开发 | 文档库',
  '   用于：用户说「切到XX」「看看XX类的项目」「有没有XX相关的项目」。',
  '',
  '2) open_project —— 打开某张项目卡（会自动切到它所在分类、滚动过去、高亮并展开详情）',
  '   {"type":"open_project","target":"<项目标题>"}',
  '   <项目标题> 必须与资料里出现的标题完全一致。',
  '   用于：用户说「打开/帮我找/看看 <某项目>」。',
  '',
  '3) open_link —— 打开某个具体链接（由你从资料里挑选最合适的那一个）',
  '   {"type":"open_link","target":"<完整 URL>"}',
  '   <完整 URL> 必须是资料里「可用链接」中出现过的原文，不得拼接、改写或想象。',
  '   当有多个候选时，按用户意图择优：想「玩」→ 在线游玩；想「看产品」→ 产品链接/产品实例；想「看原型」→ 在线原型；',
  '   想「要文档」→ 需求文档 / 开发文档；想「看代码」→ 代码仓库。',
  '   用于：用户说「打开XX」「我想玩XX」「看它的原型/文档」。',
  '',
  '4) locate —— 定位到页面区块（不打开任何卡片）',
  '   {"type":"locate","target":"<区块>"}',
  '   <区块> 只能取：top（顶部）| about（关于我）| portfolio（作品集）| docs（文档库，会自动切到文档库分类）',
  '   用于：用户说「带我去XX」「回到顶部」「看作品集」。',
  '',
  '5) close —— 关闭对话弹窗',
  '   {"type":"close"}',
  '   用于：用户说「关掉 / 收起 / 不用了」。',
  '',
  '════════ 调用规则（严格遵守）════════',
  '· 只有用户**明确说出**「打开 / 帮我打开 / 我想玩 / 跳转 / 带我去 / 切到 / 看看 / 关掉」这类指令时才给 action；',
  '· 用户只是在提问、或你只是在介绍项目时，action 必须为 null——哪怕你的回答里提到了某个项目或链接；',
  '· 回答正文里**不要粘贴裸链接**（前端不会因为正文出现链接就跳转）；需要打开就用 action 表达；',
  '· 一次只调用一个工具（action 是单个对象，不是数组）；',
  '· 资料里没有、或你无法确定的信息：直接说「这个细节我不清楚」，绝不猜测；若该项目资料里有需求文档 / 开发文档，补一句「不过它有需求文档和开发文档可以翻阅」。',
  '',
  '════════ 输出格式（严格 JSON，不要多余文字）════════',
  '{',
  '  "reply": "<给用户看的中文回答，2~5 句，口语化>",',
  '  "action": {"type":"<filter|open_project|open_link|locate|close>","target":"<按上面各工具的参数说明填>"} 或 null,',
  '  "followups": ["<基于本次回答，预测用户接下来最可能问的追问1>", "<追问2>", "<追问3>"]',
  '}',
  'followups 要求：2~3 条，每条 8~18 个字，口语化，可直接点着问，不要编号。'
].join('\n');

export async function onRequestPost({ request, env }) {
  if (!env.DEEPSEEK_API_KEY) return json({ error: '服务端未配置 API Key' }, 503);

  let body;
  try { body = JSON.parse(await request.text()); } catch { return json({ error: '请求体不是合法 JSON' }, 400); }

  const question = clean(body.question, 500);
  const context = clean(body.context, 12000);
  if (!question) return json({ error: '问题不能为空' }, 400);

  const user = '项目资料：\n' + (context || '（暂无可参考资料）') + '\n\n用户问题：' + question;
  // 最近几轮对话（让模型能接住「这两个」「它们」这类指代）
  const history = Array.isArray(body.history) ? body.history
    .filter(function (h) { return h && typeof h.content === 'string' && h.content.trim(); })
    .slice(-8)
    .map(function (h) { return { role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content).slice(0, 800) }; }) : [];

  const base = (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
  let upstream;
  try {
    upstream = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.DEEPSEEK_API_KEY },
      body: JSON.stringify({
        model: env.LLM_MODEL || 'deepseek-chat',
        messages: [{ role: 'system', content: SYSTEM }].concat(history).concat([{ role: 'user', content: user }]),
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
  if (!parsed || typeof parsed.reply !== 'string') return json({ reply: text || '（模型没有返回内容）', action: null, followups: [] });
  var fu = Array.isArray(parsed.followups) ? parsed.followups.filter(function (x) { return typeof x === 'string' && x.trim(); }).slice(0, 3) : [];
  return json({ reply: parsed.reply, action: parsed.action && parsed.action.type ? parsed.action : null, followups: fu });
}
