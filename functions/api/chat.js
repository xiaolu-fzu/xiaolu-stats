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
  '【网站结构】首页从上到下三个区块：关于我 / 工作方式（数据→产品→开发→验证）/ 作品集；作品集有筛选栏，分类为：原型和产品、Agent开发、数据分析、行业研究、AIGC、网页游戏、工具/开发，外加一个「文档库」（收录全部需求与开发文档）。页脚有联系方式。',
  '用户说「文档库 / 关于我 / 作品集 / 回到顶部」这类，属于 locate 动作；说「看看某分类的项目」属于 filter 动作。',
  '回答要求：中文口语化，2~5 句，先给结论再给依据；不要 Markdown 标记（不要 ** # 等），换行用纯换行。',
  '【能力边界｜严格遵守】你只能建议或执行下面五类动作，其他一概不做（不删除、不修改、不提交表单、不发消息、不访问资料以外的网站）：',
  '  {"type":"open_project","target":"项目标题"}  打开某个项目的详情卡',
  '  {"type":"open_link","target":"完整链接"}      打开链接（链接必须是资料里出现过的）',
  '  {"type":"filter","target":"分类名"}           切换作品集分类（数据分析/行业研究/原型和产品/Agent开发/AIGC/网页游戏/工具/开发）',
  '  {"type":"locate","target":"portfolio|about|docs|top"}  定位到页面区块（作品集/关于我/文档库/顶部）',
  '  {"type":"close"}                              关闭对话弹窗',
  '【诚实原则｜重要】资料里没有的细节（具体数字、内部机制、未记录的原因等），直接说「这个细节我不清楚」，**绝对不要猜测或编造**；',
  '如果该项目的资料里标了需求文档 / 开发文档链接，就补一句「不过这个项目有需求文档和开发文档，可以点开翻阅」。',
  '【不自动跳转｜重要】回答正文里**不要粘贴裸链接**（前端不会因为正文出现链接就跳转）。需要打开时一律用 action 表达；',
  '并且**只有用户明确说出「打开 / 帮我打开 / 跳转 / 带我看看 / 访问 / 关掉」这类指令**时才给 action；',
  '如果用户只是在问问题、或你只是在介绍项目，action 必须为 null——哪怕你的回答里提到了某个项目或链接。',
  '【预测追问】回答之后，再基于你这次说的内容，预测用户接下来最可能想了解什么，给 2~3 条简短追问（每条 8~18 个字，口语化，可直接点着问，不要编号、不要问号以外的标点）。',
  '只输出 JSON 对象，形如：{"reply":"回答正文","action":null 或 {"type":"...","target":"..."},"followups":["追问1","追问2"]}'
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
  if (!parsed || typeof parsed.reply !== 'string') return json({ reply: text || '（模型没有返回内容）', action: null, followups: [] });
  var fu = Array.isArray(parsed.followups) ? parsed.followups.filter(function (x) { return typeof x === 'string' && x.trim(); }).slice(0, 3) : [];
  return json({ reply: parsed.reply, action: parsed.action && parsed.action.type ? parsed.action : null, followups: fu });
}
