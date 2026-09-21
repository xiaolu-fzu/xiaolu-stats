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
  '【知识库优先｜重要】资料里若出现「项目文档原文切片」，那是从项目文档里检索出来的原文，**比卡片简介更权威更细**——请优先依据它回答；必要时可以说出来源（如「这一点出自《有据_技术方案与决策记录》的检索策略一节」）。',
  '【数量与清单｜重要】资料开头有「【项目总览】」，里面写了作品集的**项目总数、各分类数量、完整项目清单**（后方还附了与本次问题最相关的项目详情）。',
  '凡是问「一共有多少项目 / 有哪些分类 / 都做过什么 / 列一下全部」这类问题，**一律以【项目总览】为准**去数、去列举，不要只用后面那几条相关详情来回答，更不要说「我只知道几个」。',
  '【接着聊】下面会给出最近几轮对话，请顺着上下文回答：用户说「这两个 / 它们 / 那几个 / 刚才说的」时，指的就是你上一轮列举过的项目，直接按这个理解回答，不要反问用户「你指哪两个」。',
  '回答要求：中文口语化，2~5 句，先给结论再给依据；不要 Markdown 标记（不要 ** # 等），换行用纯换行。',
  '',
  '════════ 你可以调用的工具（只此五类，其余一律不做）════════',
  '把 action 当作一次「工具调用」来填。工具清单与参数：',
  '',
  '1) filter —— 滑动/切换作品集分类',
  '   {"type":"filter","target":"<分类名>"}',
  '   <分类名> 只能取：原型和产品 | AI项目 | 数据分析 | 行业研究 | AIGC | 网页游戏 | 工具/开发 | 文档库',
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
  '════════ 多步任务（你已经具备循环能力）════════',
  '如果用户的要求包含**多个动作**（例如「帮我找有据，然后打开它的开发文档」「切到数据分析并把第一个项目打开」），你可以**分多轮完成**：',
  '每一轮只调用**一个**工具；前端会执行并把结果作为「系统反馈」发回给你；你看到结果后再决定下一步；',
  '全部完成后，把 action 设为 null，并用一句话简短总结你做了哪几步。',
  '如果某一步失败（系统反馈里会说明，例如「没有找到项目」），可以换一个更可行的动作重试，或如实告知失败原因。',
  '最多 3 轮——请优先完成用户最核心的那个诉求。',
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

/* ── 知识库检索：把项目文档切片查出来，作为回答依据（真 RAG 的 R 部分）── */
const STOP = /^(为什么|什么|怎么|怎样|哪些|哪个|如何|可以|是否|这个|那个|以及|还是|不用|只用|我们|你们|他们|一个|一下|就是|不是|用了|有过|做过|关于|介绍)$/;
function kbTerms(q) {
  const whole = new Set(), bi = new Set(), tri = new Set();
  const parts = String(q).split(/[\s,，。.？?！!、；;：:（）()【】「」《》"'\-—_\/\\|]+/).filter(Boolean);
  for (const x of parts) {
    if (x.length <= 8) whole.add(x);
    for (let i = 0; i + 2 <= x.length; i++) bi.add(x.slice(i, i + 2));
    for (let i = 0; i + 3 <= x.length; i++) tri.add(x.slice(i, i + 3));
  }
  const ok = t => t.length >= 2 && !STOP.test(t) && !/^[0-9]+$/.test(t);
  return [...[...whole].filter(ok), ...[...bi].filter(ok), ...[...tri].filter(ok)].slice(0, 12);
}
async function searchKB(env, question, limit) {
  const tlist = kbTerms(question);
  if (!tlist.length) return [];
  const out = [];
  const tri = tlist.filter(t => t.length >= 3);
  if (tri.length) {
    try {
      const fts = tri.map(t => '"' + t.replace(/"/g, '""') + '"').join(' OR ');
      const r = await env.DB.prepare(
        'SELECT c.project_name, c.doc_title, c.section_path, c.facet, c.title, c.text ' +
        'FROM kb_chunks_fts f JOIN kb_chunks c ON c.id = f.rowid WHERE kb_chunks_fts MATCH ? ' +
        'ORDER BY bm25(kb_chunks_fts, 6.0, 1.0, 3.0, 2.0, 2.0) LIMIT ?'
      ).bind(fts, limit).all();
      for (const x of (r.results || [])) out.push(x);
    } catch (e) { /* 忽略 */ }
  }
  if (out.length < limit) {
    const words = tlist.map(t => '%' + t + '%');
    const conds = words.map(() => '(title LIKE ? OR text LIKE ?)').join(' OR ');
    const binds = [];
    words.forEach(w => binds.push(w, w));
    binds.push(limit - out.length);
    try {
      const r2 = await env.DB.prepare(
        'SELECT project_name, doc_title, section_path, facet, title, text FROM kb_chunks WHERE (' + conds + ') ' +
        'ORDER BY (CASE WHEN title LIKE ? THEN 0 ELSE 1 END) LIMIT ?'
      ).bind(...(binds.slice(0, -1)), '%' + question + '%', binds[binds.length - 1]).all();
      for (const x of (r2.results || [])) {
        if (!out.some(function (y) { return y.title === x.title && y.text === x.text; })) out.push(x);
      }
    } catch (e) { /* 忽略 */ }
  }
  return out.slice(0, limit);
}

export async function onRequestPost({ request, env }) {
  if (!env.DEEPSEEK_API_KEY) return json({ error: '服务端未配置 API Key' }, 503);

  let body;
  try { body = JSON.parse(await request.text()); } catch { return json({ error: '请求体不是合法 JSON' }, 400); }

  const question = clean(body.question, 500);
  const context = clean(body.context, 12000);
  if (!question) return json({ error: '问题不能为空' }, 400);

  // 先查知识库：命中就作为「文档原文依据」附在卡片资料后面
  let kbBlock = '';
  try {
    const hits = await searchKB(env, question, 8);
    if (hits.length) {
      kbBlock = '\n\n【项目文档原文切片（检索自知识库，共 ' + hits.length + ' 条，请优先依据这些细节回答）】\n' +
        hits.map(function (h, i) {
          return (i + 1) + '. 【' + (h.project_name || '') + ' · ' + (h.doc_title || '') +
            (h.section_path ? ' · ' + h.section_path : '') + '（' + (h.facet || '') + '）】\n' + h.text;
        }).join('\n\n');
    }
  } catch (e) { /* 知识库不可用时静默降级为只卡片资料 */ }

  const user = '项目资料：\n' + (context || '（暂无可参考资料）') + kbBlock + '\n\n用户问题：' + question;
  // 最近几轮对话（让模型能接住「这两个」「它们」这类指代）
  const history = Array.isArray(body.history) ? body.history
    .filter(function (h) { return h && typeof h.content === 'string' && h.content.trim(); })
    .slice(-8)
    .map(function (h) { return { role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content).slice(0, 800) }; }) : [];

  const base = (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');

  // 调用一次模型并解析出 JSON（失败或空返回时由调用方重试）
  async function callOnce(withHistory) {
    const msgs = [{ role: 'system', content: SYSTEM }]
      .concat(withHistory ? history : [])
      .concat([{ role: 'user', content: user }]);
    let up;
    try {
      up = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.DEEPSEEK_API_KEY },
        body: JSON.stringify({
          model: env.LLM_MODEL || 'deepseek-chat',
          messages: msgs,
          temperature: 0.4,
          max_tokens: 900,
          response_format: { type: 'json_object' }
        })
      });
    } catch (e) {
      return { err: '上游连接失败：' + String(e).slice(0, 120) };
    }
    if (!up.ok) {
      const t = await up.text();
      return { err: '上游 ' + up.status + '：' + t.slice(0, 200) };
    }
    const d = await up.json();
    const text = (d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (e) {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch (e2) {} }
    }
    return { parsed: parsed, text: text };
  }

  // 第一次：带历史
  let res = await callOnce(true);
  if (res.err) return json({ error: res.err }, 502);

  // 兜底 1：返回空 / 解析失败 → 去掉历史重试一次（短问题+长历史最容易触发空返回）
  let parsed = res.parsed;
  if (!parsed || typeof parsed.reply !== 'string' || !parsed.reply.trim()) {
    const retry = await callOnce(false);
    if (!retry.err && retry.parsed && typeof retry.parsed.reply === 'string' && retry.parsed.reply.trim()) {
      parsed = retry.parsed;
    } else if (!parsed && retry.parsed) {
      parsed = retry.parsed;
    }
  }

  // 兜底 2：仍然为空 → 给一句得体的回退，而不是把空白丢给用户
  if (!parsed || typeof parsed.reply !== 'string' || !parsed.reply.trim()) {
    return json({
      reply: '抱歉，我刚才没组织好语言。你可以换个说法再问一次；也可以直接说「打开 <项目名>」或「切到 <分类>」，我会帮你执行。',
      action: null,
      followups: ['有据是什么？', '有哪些能直接玩的？', '哪个项目最能体现数据分析？']
    });
  }

  var fu = Array.isArray(parsed.followups) ? parsed.followups.filter(function (x) { return typeof x === 'string' && x.trim(); }).slice(0, 3) : [];
  return json({ reply: parsed.reply.trim(), action: parsed.action && parsed.action.type ? parsed.action : null, followups: fu });
}
