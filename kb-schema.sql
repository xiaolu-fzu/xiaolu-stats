-- ═══════════════════════════════════════════════════════════
-- 小洄知识库：项目文档切片表 + FTS5 全文索引
-- 用法：npx wrangler d1 execute xiaolu-stats --file=./kb-schema.sql --remote
-- ═══════════════════════════════════════════════════════════

-- ① 项目表（分类清晰的根）
CREATE TABLE IF NOT EXISTS kb_projects (
  id       TEXT PRIMARY KEY,   -- slug，如 youju
  name     TEXT NOT NULL,      -- 有据 · 企业知识库引擎
  category TEXT,               -- agent / prototype / game / data / tool
  summary  TEXT                -- 一句话定位
);

-- ② 知识切片表：每一条都知道自己属于哪个项目、哪份文档、哪一章节、哪个知识面
CREATE TABLE IF NOT EXISTS kb_chunks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   TEXT NOT NULL,
  project_name TEXT,
  doc_title    TEXT,           -- 来源文档
  doc_type     TEXT,           -- 需求 / 开发 / 设计 / 评测 / 访谈 / README
  section_path TEXT,           -- 章节路径（三、技术方案 > 3.2 检索策略）
  facet        TEXT,           -- 定位 / 用户 / 功能 / 技术 / 决策 / 指标 / 踩坑 / 验证
  title        TEXT,           -- 切片小标题
  text         TEXT NOT NULL,  -- 正文
  keywords     TEXT,           -- 关键词（空格分隔）
  source_file  TEXT,           -- 原始文件路径
  ord          INTEGER         -- 文档内顺序
);
CREATE INDEX IF NOT EXISTS idx_kb_project ON kb_chunks(project_id);
CREATE INDEX IF NOT EXISTS idx_kb_facet   ON kb_chunks(facet);
CREATE INDEX IF NOT EXISTS idx_kb_doct    ON kb_chunks(doc_title);

-- ③ FTS5 全文索引（trigram 分词，对中文子串检索友好）
CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks_fts USING fts5(
  title, text, keywords, section_path, project_name,
  content='kb_chunks', content_rowid='id',
  tokenize='trigram'
);

-- ④ 触发器：保持 FTS 与主表同步
CREATE TRIGGER IF NOT EXISTS kb_chunks_ai AFTER INSERT ON kb_chunks BEGIN
  INSERT INTO kb_chunks_fts(rowid, title, text, keywords, section_path, project_name)
  VALUES (new.id, new.title, new.text, new.keywords, new.section_path, new.project_name);
END;
CREATE TRIGGER IF NOT EXISTS kb_chunks_ad AFTER DELETE ON kb_chunks BEGIN
  INSERT INTO kb_chunks_fts(kb_chunks_fts, rowid, title, text, keywords, section_path, project_name)
  VALUES ('delete', old.id, old.title, old.text, old.keywords, old.section_path, old.project_name);
END;
CREATE TRIGGER IF NOT EXISTS kb_chunks_au AFTER UPDATE ON kb_chunks BEGIN
  INSERT INTO kb_chunks_fts(kb_chunks_fts, rowid, title, text, keywords, section_path, project_name)
  VALUES ('delete', old.id, old.title, old.text, old.keywords, old.section_path, old.project_name);
  INSERT INTO kb_chunks_fts(rowid, title, text, keywords, section_path, project_name)
  VALUES (new.id, new.title, new.text, new.keywords, new.section_path, new.project_name);
END;
