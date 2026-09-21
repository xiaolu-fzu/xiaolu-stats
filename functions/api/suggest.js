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
  '硬性要求：',
  '1. 每条追问必须**贴住这次回答里出现过的具体内容**（项目名、数字、机制、文档或链接），不许泛泛而问；',
  '2. 三条各属一类，各占一条：',
  '   ① 往深里问——某个机制/数字/取舍是怎么来的（例：「BM25 的 92% 是怎么测的」）；',
  '   ② 换个角度——价值、难点、边界或对比（例：「它最难的坑是什么」）；',
  '   ③ 立刻可做——打开某个链接/看某份文档/切到某个分类（例：「打开它的需求文档」）；',
  '3. 每条 8~18 个字，口语化，像用户自己会说出的话；不要编号、不要问号以外的标点；',
  '4. 不要重复用户已经问过的内容；不要出现资料里根本没有的项目或链接。',
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
