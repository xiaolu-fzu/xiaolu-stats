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
  '三条各占一个方向，**固定顺序**如下（这是硬要求）：',
  '',
  '1. **一个请求问题**——让助手去执行动作：打开某份文档 / 带我去看原型 / 在线玩一下 / 打开产品链接。',
  '   必须使用资料里出现过的项目名或链接，且不要重复已经执行过的动作。',
  '   例：「打开它的需求文档」「带我去看看在线原型」「我想在线玩一下」。',
  '',
  '2. **一个技术细节问题**——针对这个项目"怎么做出来的"具体细节，但要**一句话能问出口、不能太深**：',
  '   可以问思路、做法、机制（例：「检索怎么能全在浏览器里跑」「这个结论是怎么得出来的」「那个三级闸门是怎么设计的」）；',
  '   **不要**问参数、算法公式、具体指标怎么算这类太重的问题（例：「BM25 的 92% 是怎么统计的」——太深，不要）。',
  '',
  '3. **一个随机问题**——换个角度的好奇问题，可以是过程、取舍、感受或相邻项目：',
  '   例：「做这个最花时间的是哪一步」「你还有别的类似项目吗」「这个想法是怎么冒出来的」。',
  '',
  '每条 8~16 个字，口语化，像用户自己会说的话；不要编号、不要问号以外的标点；不要重复用户已经问过的内容；',
  '不要出现资料里根本没有的项目或链接。',
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

  const user = '用户的问题：' + question + '\n\n助手的回答：' + reply + (proj ? '\n\n相关项目：\n' + proj : '');
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
