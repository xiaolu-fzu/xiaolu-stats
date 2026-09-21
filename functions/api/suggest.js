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
  '【风格要求｜很重要】追问要**轻**、要好懂、点一下就能问出口，像一个**普通访客**翻作品集时会问的话。',
  '**不要深挖技术或产品实现细节**——不要问机制、参数、算法、代码、指标怎么算出来这类问题。',
  '例如「BM25 的 92% 是怎么测的」「向量检索的相似度怎么算」这种就太重了，不要出现。',
  '',
  '三条各占一个方向，固定顺序：',
  '1. **更简单的了解**——像「它是给谁用的」「大概做了多久」「你觉得最难的是什么」；',
  '2. **相邻或对比**——像「你还有别的网页游戏吗」「它和 ProListing 有什么不一样」；',
  '3. **一个跳转 / 打开请求**——像「打开它的需求文档」「带我去看看原型」「我想在线玩一下」',
  '   （必须用资料里出现过的项目名或链接，且不要重复已经执行过的动作）。',
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
        max_tokens: 220,
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
