-- 织章小说写作数据库结构

-- 用户配置表
CREATE TABLE IF NOT EXISTS user_config (
    id INTEGER PRIMARY KEY,
    api_key TEXT NOT NULL,
    api_endpoint TEXT DEFAULT 'https://api.apisaver.com',
    default_model TEXT DEFAULT 'gpt-4',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 小说项目表
CREATE TABLE IF NOT EXISTS novels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT,
    genre TEXT,
    synopsis TEXT,
    cover_image TEXT,
    status TEXT DEFAULT 'writing', -- writing, paused, completed
    word_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 卷表
CREATE TABLE IF NOT EXISTS volumes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    volume_number INTEGER NOT NULL,
    synopsis TEXT,
    word_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
);

-- 章节表
CREATE TABLE IF NOT EXISTS chapters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id INTEGER NOT NULL,
    volume_id INTEGER,
    title TEXT NOT NULL,
    chapter_number INTEGER NOT NULL,
    content TEXT,
    word_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'draft', -- draft, reviewed, published
    ai_generated BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
    FOREIGN KEY (volume_id) REFERENCES volumes(id) ON DELETE SET NULL
);

-- 大纲表
CREATE TABLE IF NOT EXISTS outlines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id INTEGER NOT NULL,
    type TEXT NOT NULL, -- plot, character, worldview
    title TEXT NOT NULL,
    content TEXT,
    parent_id INTEGER,
    order_index INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES outlines(id) ON DELETE CASCADE
);

-- 人物设定表
CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    role TEXT, -- protagonist, antagonist, supporting
    description TEXT,
    personality TEXT,
    background TEXT,
    relationships TEXT, -- JSON format
    avatar_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
);

-- 技能库表
CREATE TABLE IF NOT EXISTS skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT, -- technique, style, plot_pattern
    description TEXT,
    content TEXT, -- 技能详细内容/示例
    tags TEXT, -- JSON array
    usage_count INTEGER DEFAULT 0,
    rating REAL DEFAULT 0,
    is_builtin BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 技能应用记录
CREATE TABLE IF NOT EXISTS skill_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_id INTEGER NOT NULL,
    chapter_id INTEGER NOT NULL,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);

-- 榜单数据表
CREATE TABLE IF NOT EXISTS rankings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL, -- fanqie, qidian, etc.
    rank_type TEXT NOT NULL, -- hot, recommend, new
    rank_position INTEGER NOT NULL,
    novel_title TEXT NOT NULL,
    author TEXT,
    novel_url TEXT,
    cover_url TEXT,
    description TEXT,
    word_count INTEGER,
    tags TEXT, -- JSON array
    score REAL,
    scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 拆书分析表
CREATE TABLE IF NOT EXISTS book_analysis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type TEXT DEFAULT 'ranking', -- ranking, manual_import
    source_id INTEGER, -- 关联 rankings.id 或其他来源
    novel_title TEXT NOT NULL,
    author TEXT,
    total_chapters INTEGER,
    analyzed_chapters INTEGER DEFAULT 0,
    analysis_data TEXT, -- JSON: 结构分析、节奏分析等
    extracted_skills TEXT, -- JSON: 提取的写作技巧
    status TEXT DEFAULT 'pending', -- pending, analyzing, completed
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_id) REFERENCES rankings(id) ON DELETE SET NULL
);

-- 拆书章节详情
CREATE TABLE IF NOT EXISTS analyzed_chapters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_id INTEGER NOT NULL,
    chapter_number INTEGER NOT NULL,
    chapter_title TEXT,
    word_count INTEGER,
    structure_analysis TEXT, -- JSON: 开头、发展、高潮、结尾
    pacing_analysis TEXT, -- JSON: 节奏快慢
    character_analysis TEXT, -- JSON: 人物塑造
    techniques_used TEXT, -- JSON: 使用的写作手法
    key_points TEXT, -- JSON: 关键情节点
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (analysis_id) REFERENCES book_analysis(id) ON DELETE CASCADE
);

-- 写作会话表（记录 AI 生成历史）
CREATE TABLE IF NOT EXISTS writing_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chapter_id INTEGER NOT NULL,
    prompt TEXT,
    model_used TEXT,
    skills_applied TEXT, -- JSON: 应用的技能 ID 列表
    generated_content TEXT,
    tokens_used INTEGER,
    generation_time REAL,
    quality_score REAL,
    user_feedback TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);

-- 创建索引
CREATE INDEX idx_chapters_novel_id ON chapters(novel_id);
CREATE INDEX idx_chapters_volume_id ON chapters(volume_id);
CREATE INDEX idx_outlines_novel_id ON outlines(novel_id);
CREATE INDEX idx_characters_novel_id ON characters(novel_id);
CREATE INDEX idx_rankings_platform_rank ON rankings(platform, rank_position);
CREATE INDEX idx_book_analysis_status ON book_analysis(status);
CREATE INDEX idx_writing_sessions_chapter_id ON writing_sessions(chapter_id);

-- 创建全文搜索
CREATE VIRTUAL TABLE IF NOT EXISTS chapters_fts USING fts5(
    title, content,
    content='chapters',
    content_rowid='id'
);

CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(
    name, description, content,
    content='skills',
    content_rowid='id'
);
