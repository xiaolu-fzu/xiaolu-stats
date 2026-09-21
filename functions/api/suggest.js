/**
 * 追问推荐器：POST /api/suggest
 *
 * 为什么不跟回答一起生成？——让模型「顺便」想追问时，它的注意力都在回答上，
 * 产出往往泛泛且答非所问（实测就是这样）。所以这里改成**独立一次调用**专门干这件事，
 * 思路与 vercel/chatbot 的 requestSuggestions（单独工具 + 只负责建议）一致。
 *
 * 请求：{ question, reply, projects: [{ title, value, links: [{label, href}] }] }
 * 返回：{ followups: ["...", "...", "..."] }
 */
import { json, noContent, clean } from './_lib.js';

export async function onRequestOptions() { return noContent(); }

const SYSTEM = [
  '你是一个「追问推荐器」。给定用户刚问的问题、助手刚给出的回答、以及相关项目资料，',
  '你的唯一任务是预测用户接下来最可能想知道的 3 个问题。',
  '',
  '三条各占一个方向，**固定顺序**如下（这是硬要求，顺序不能变）：',
  '',
  '1. **一个命令请求**——让助手去执行动作：打开需求文档 / 打开开发文档 / 带我去看在线原型 / 在线玩一下 / 打开产品链接。',
  '   必须用**当前项目真实存在的资源**（上面 projects 里给出的 links），不要编造；也不要重复已经执行过的动作。',
  '   例：「打开它的需求文档」「带我去看看在线原型」「我想在线玩一下」。',
  '',
  '2. **一个点名「其他项目」的问题**——必须**明确写出另一个项目的真实名字**，从【全部项目】里挑一个与本项目不同、',
  '   且在主题上有关联或可对比的（同分类优先，其次能力相近）。**绝对不能用「别的项目」「其他作品」这种泛指**。',
  '   例：「那有据呢？」「把关和它有什么不一样？」「《三体》那个是怎么做的？」',
  '',
  '3. **一个当前项目的细节问题**——**必须基于助手这次回答里出现过的具体内容**（某个数字、机制、决策、踩坑、文档名），',
  '   针对它追问来历、取舍或实现细节。**不要问回答里没提过的东西**（但问得深一点没关系，不必刻意回避技术细节）。',
  '   例：「那个 1.4% 的覆盖面是怎么算的」「为什么不给 shell 只给结构化工具」「三级闸门具体拦什么」。',
  '',
  '每条 8~22 个字，口语化、像用户自己会说的话；不要编号、不要问号以外的标点；不要重复用户已经问过的内容；',
  '不要出现资料里根本没有的项目或链接。',
  '',
  '【硬性要求｜必须遵守】**必须输出 3 条**（数组长度必须等于 3），**永远不要输出空数组**，也不要输出 1 条或 2 条。',
  '即使信息很少（例如用户只说了「那把关呢？」、助手的回答只有一两句），也必须基于【正在讨论的项目】与【当前项目资料】，',
  '给出三条具体、点得出口的追问；信息不足时，就问这个项目**最基础也最关键的三个方面**（它是给谁用的 / 它怎么实现的 / 它最难的地方）。',
  '',
  '只输出 JSON：{"followups":["追问1","追问2","追问3"]}'
].join('\n');

export async function onRequestPost({ request, env }) {
  if (!env.DEEPSEEK_API_KEY) return json({ error: '服务端未配置 API Key' }, 503);
  let body;
  try { body = JSON.parse(await request.text()); } catch { return json({ error: '请求体不是合法 JSON' }, 400); }

  const question = clean(body.question, 400);
  const reply = clean(body.reply, 2000);
  if (!question || !reply) return json({ followups: [] });

  let proj = '';
  if (Array.isArray(body.projects)) {
    proj = body.projects.slice(0, 5).map(function (p) {
      var links = Array.isArray(p && p.links) ? p.links.map(function (l) { return l && l.label; }).filter(Boolean).join('、') : '';
      return '【' + clean(p && p.title, 60) + '】' + clean(p && p.value, 80) + (links ? '｜可看：' + links : '');
    }).join('\n');
  }

  let all = '';
  if (Array.isArray(body.allProjects)) {
    all = body.allProjects.map(function (t) { return clean(t, 40); }).filter(Boolean).slice(0, 30).join('；');
  }

  // 当前讨论的项目：信息量少的轮次（如「那把关呢？」）靠它才不至于无从下手
  const cur = clean(body.currentProject, 60);
  const user = '用户的问题：' + question + '\n\n助手的回答：' + reply +
    (cur ? '\n\n【正在讨论的项目】' + cur : '') +
    (proj ? '\n\n【当前项目资料】\n' + proj : '') +
    (all ? '\n\n【全部项目】（第 2 条追问必须从中点名一个与当前项目不同的）\n' + all : '');
  const base = (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');

  let up;
  try {
    up = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.DEEPSEEK_API_KEY },
      body: JSON.stringify({
        model: env.LLM_MODEL || 'deepseek-chat',
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
        temperature: 0.6,
        max_tokens: Number(env.LLM_SUGGEST_TOKENS || 400),
        response_format: { type: 'json_object' }
      })
    });
  } catch (e) { return json({ followups: [] }); }
  if (!up.ok) return json({ followups: [] });

  const d = await up.json();
  const text = (d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch (e2) {} }
  }
  var fu = parsed && Array.isArray(parsed.followups) ? parsed.followups : [];
  fu = fu.filter(function (x) { return typeof x === 'string' && x.trim() && x.trim().length <= 30; }).slice(0, 3);
  return json({ followups: fu });
}
