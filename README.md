# xiaolu-stats · 个人网站访问统计

统计个人作品集的：**打开总次数（PV）/ 独立访客（UV）/ 各项目访问次数 / 各项目产品链接点击次数**。

技术：Cloudflare Pages Functions + **D1（SQLite）**，看板页同域托管。

## 目录

| 文件 | 作用 |
|---|---|
| `functions/api/track.js` | 事件写入（POST /api/track），只收三种事件，静默失败 |
| `functions/api/stats.js` | 统计查询（GET /api/stats?token=xxx），token 鉴权 |
| `functions/api/_lib.js` | 共用工具（CORS / JSON / 时间 / 清洗） |
| `functions/api/clear.js` | 清除统计数据（POST /api/clear，密码校验，只清 events，保留排除名单） |
| `stats.html` | 看板页（暖陶配色，三个大数字 + 两张排行 + 7 天趋势 + 清除数据按钮） |
| `schema.sql` | D1 建表语句 |

## 部署步骤

> ⚠️ 跑 wrangler 前先设 `NO_PROXY=*`，否则本地代理会拦 Cloudflare API。

### 1. 建 D1 数据库
```bash
npx wrangler d1 create xiaolu-stats
# 输出里的 database_id 填进 wrangler.toml 的 [[d1_databases]]
```

### 2. 建 Pages 项目并建表
```bash
npx wrangler pages project create xiaolu-stats --production-branch main
npx wrangler d1 execute xiaolu-stats --file=./schema.sql --remote
```

### 3. 绑定 D1 到 Pages 项目
Cloudflare 控制台 → Workers & Pages → `xiaolu-stats` → **Settings → Functions → D1 database bindings** → 添加：
- Variable name: `DB`
- D1 database: `xiaolu-stats`

### 4. 设统计密钥并部署
```bash
npx wrangler pages secret put STATS_TOKEN --project-name xiaolu-stats
npx wrangler pages deploy . --project-name xiaolu-stats
# 注意：改完 secret 必须重新部署一次才生效
npx wrangler pages deploy . --project-name xiaolu-stats
```

### 5. 回填前端域名
把 `个人网站/assets/js/analytics.js` 里的 `var ENDPOINT = ""` 改成：
```js
var ENDPOINT = "https://xiaolu-stats.pages.dev";
```
然后提交推送个人网站仓库。

### 6. 验证
- 看板：`https://xiaolu-stats.pages.dev/stats.html?token=你的token`
- 接口：`https://xiaolu-stats.pages.dev/api/stats?token=你的token`
- 埋点是否通：打开个人网站后刷新看板，PV / 项目访问应有数字

## 统计口径

| 指标 | 口径 |
|---|---|
| 打开总次数（PV） | `page_view` 事件总数 |
| 独立访客（UV） | 按浏览器本地随机 ID（localStorage）去重 |
| 各项目访问 | `project_open` 按项目名分组 |
| 产品链接点击 | `link_click` 按「项目 + 按钮类型」分组（产品链接/需求文档/开发文档/案例展示…） |
| 天数口径 | 按东八区（UTC+8）切天 |

## 隐私

- 不写 cookie、不采 IP 原文，只存 Cloudflare 提供的国家代码；
- 访客 ID 是浏览器本地生成的随机串，清缓存即重置；
- 事件表不含任何可识别个人的信息。

## 已知限制

- 广告拦截器可能拦掉统计请求 → 数字会比真实略低；
- D1 免费额度：10 万行写/天、500 万行读/天（个人网站完全够用）；
- 数据无自动清理，量大时可加一条定时删除 180 天前事件的语句。
