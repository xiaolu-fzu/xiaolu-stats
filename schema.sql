-- D1 建表：执行  npx wrangler d1 execute xiaolu-stats --file=./schema.sql --remote
CREATE TABLE IF NOT EXISTS events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        INTEGER NOT NULL,      -- 毫秒时间戳
  day       TEXT    NOT NULL,      -- YYYY-MM-DD（东八区）
  type      TEXT    NOT NULL,      -- page_view | project_open | link_click
  project   TEXT,                  -- 项目名
  link_type TEXT,                  -- 产品链接 / 需求文档 / 开发文档 ...
  path      TEXT,                  -- 页面路径
  visitor   TEXT,                  -- 匿名访客 ID（本地生成）
  country   TEXT,                  -- Cloudflare 提供的国家代码
  ref       TEXT                   -- 来源页（截断）
);
CREATE INDEX IF NOT EXISTS idx_events_type_day  ON events(type, day);
CREATE INDEX IF NOT EXISTS idx_events_project   ON events(project);
CREATE INDEX IF NOT EXISTS idx_events_link      ON events(project, link_type);
CREATE INDEX IF NOT EXISTS idx_events_visitor   ON events(visitor);
