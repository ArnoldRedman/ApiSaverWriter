/**
 * 技能管理器 - 管理写作技巧库
 */

import Database = require('better-sqlite3');

export interface Skill {
  id?: number;
  name: string;
  category: 'technique' | 'style' | 'plot_pattern';
  description: string;
  content: string;
  tags: string[];
  usageCount?: number;
  rating?: number;
  isBuiltin?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface SkillSearchOptions {
  query?: string;
  category?: string;
  tags?: string[];
  minRating?: number;
  limit?: number;
  offset?: number;
}

export class SkillManager {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initDatabase();
    this.loadBuiltinSkills();
  }

  /**
   * 初始化数据库
   */
  private initDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS skills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT,
        content TEXT,
        tags TEXT,
        usage_count INTEGER DEFAULT 0,
        rating REAL DEFAULT 0,
        is_builtin BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(
        name, description, content,
        content='skills',
        content_rowid='id'
      );

      CREATE TRIGGER IF NOT EXISTS skills_fts_insert AFTER INSERT ON skills BEGIN
        INSERT INTO skills_fts(rowid, name, description, content)
        VALUES (new.id, new.name, new.description, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS skills_fts_delete AFTER DELETE ON skills BEGIN
        DELETE FROM skills_fts WHERE rowid = old.id;
      END;

      CREATE TRIGGER IF NOT EXISTS skills_fts_update AFTER UPDATE ON skills BEGIN
        DELETE FROM skills_fts WHERE rowid = old.id;
        INSERT INTO skills_fts(rowid, name, description, content)
        VALUES (new.id, new.name, new.description, new.content);
      END;

      CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);
      CREATE INDEX IF NOT EXISTS idx_skills_rating ON skills(rating DESC);
    `);
  }

  /**
   * 添加技能
   */
  addSkill(skill: Skill): number {
    const stmt = this.db.prepare(`
      INSERT INTO skills (name, category, description, content, tags, is_builtin)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      skill.name,
      skill.category,
      skill.description,
      skill.content,
      JSON.stringify(skill.tags || []),
      skill.isBuiltin ? 1 : 0
    );

    return result.lastInsertRowid as number;
  }

  /**
   * 更新技能
   */
  updateSkill(id: number, skill: Partial<Skill>): void {
    const updates: string[] = [];
    const values: any[] = [];

    if (skill.name !== undefined) {
      updates.push('name = ?');
      values.push(skill.name);
    }
    if (skill.category !== undefined) {
      updates.push('category = ?');
      values.push(skill.category);
    }
    if (skill.description !== undefined) {
      updates.push('description = ?');
      values.push(skill.description);
    }
    if (skill.content !== undefined) {
      updates.push('content = ?');
      values.push(skill.content);
    }
    if (skill.tags !== undefined) {
      updates.push('tags = ?');
      values.push(JSON.stringify(skill.tags));
    }
    if (skill.rating !== undefined) {
      updates.push('rating = ?');
      values.push(skill.rating);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const stmt = this.db.prepare(`
      UPDATE skills SET ${updates.join(', ')} WHERE id = ?
    `);

    stmt.run(...values);
  }

  /**
   * 删除技能
   */
  deleteSkill(id: number): void {
    this.db.prepare('DELETE FROM skills WHERE id = ?').run(id);
  }

  /**
   * 搜索技能
   */
  searchSkills(options: SkillSearchOptions = {}): Skill[] {
    const { query, category, tags, minRating, limit = 50, offset = 0 } = options;

    let sql = 'SELECT * FROM skills WHERE 1=1';
    const params: any[] = [];

    // 全文搜索
    if (query) {
      sql = `
        SELECT s.* FROM skills s
        JOIN skills_fts fts ON s.id = fts.rowid
        WHERE skills_fts MATCH ?
      `;
      params.push(query);
    }

    // 分类过滤
    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }

    // 评分过滤
    if (minRating !== undefined) {
      sql += ' AND rating >= ?';
      params.push(minRating);
    }

    // 标签过滤
    if (tags && tags.length > 0) {
      const tagConditions = tags.map(() => 'tags LIKE ?').join(' OR ');
      sql += ` AND (${tagConditions})`;
      params.push(...tags.map(tag => `%"${tag}"%`));
    }

    sql += ' ORDER BY rating DESC, usage_count DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      category: row.category,
      description: row.description,
      content: row.content,
      tags: JSON.parse(row.tags || '[]'),
      usageCount: row.usage_count,
      rating: row.rating,
      isBuiltin: row.is_builtin === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * 获取技能详情
   */
  getSkill(id: number): Skill | null {
    const row = this.db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as any;

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      category: row.category,
      description: row.description,
      content: row.content,
      tags: JSON.parse(row.tags || '[]'),
      usageCount: row.usage_count,
      rating: row.rating,
      isBuiltin: row.is_builtin === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * 记录技能使用
   */
  recordUsage(skillId: number): void {
    this.db.prepare('UPDATE skills SET usage_count = usage_count + 1 WHERE id = ?').run(skillId);
  }

  /**
   * 加载内置技能
   */
  private loadBuiltinSkills(): void {
    const builtinCount = this.db.prepare('SELECT COUNT(*) as count FROM skills WHERE is_builtin = 1').get() as any;
    
    if (builtinCount.count > 0) return; // 已加载

    const builtinSkills: Skill[] = [
      {
        name: '冲突开场',
        category: 'technique',
        description: '用冲突、悬念或意外开头，快速抓住读者注意力',
        content: '示例：\n1. 对话冲突："你疯了吗？"她死死盯着他。\n2. 动作冲突：枪声响起的瞬间，他扑倒在地。\n3. 情感冲突：他从未想过，会在这种场合遇见她。',
        tags: ['开头', '冲突', '悬念'],
        isBuiltin: true,
      },
      {
        name: '五感描写',
        category: 'technique',
        description: '调动视觉、听觉、嗅觉、味觉、触觉，增强画面感和沉浸感',
        content: '视觉：红色的夕阳透过窗帘\n听觉：远处传来隐约的钟声\n嗅觉：空气中飘着咖啡的香气\n味觉：苦涩在舌尖蔓延\n触觉：冰冷的金属贴在皮肤上',
        tags: ['描写', '画面感', '沉浸'],
        isBuiltin: true,
      },
      {
        name: '对话推进',
        category: 'technique',
        description: '用对话推动情节，展现人物性格和关系',
        content: '技巧：\n1. 言外之意：用暗示代替直白\n2. 对话冲突：观点对立、情绪碰撞\n3. 留白：适时打断，留下悬念\n4. 方言/口头禅：塑造人物特点',
        tags: ['对话', '情节', '人物'],
        isBuiltin: true,
      },
      {
        name: '伏笔铺垫',
        category: 'plot_pattern',
        description: '提前埋下线索，后续揭示，增强故事张力',
        content: '方法：\n1. 细节伏笔：看似无关的物品、对话\n2. 人物伏笔：配角的神秘行为\n3. 环境伏笔：异常的天气、场景\n回收时机：中篇5-10章，长篇20-50章',
        tags: ['伏笔', '结构', '反转'],
        isBuiltin: true,
      },
      {
        name: '情绪渲染',
        category: 'technique',
        description: '通过环境、动作、心理描写渲染情绪氛围',
        content: '悲伤：天空阴沉，雨点打在窗上，他呆坐在角落\n紧张：心跳加速，手心出汗，时间仿佛凝固\n喜悦：阳光明媚，她轻快地哼着歌\n愤怒：拳头紧握，青筋暴起，胸口剧烈起伏',
        tags: ['情绪', '氛围', '感染力'],
        isBuiltin: true,
      },
      {
        name: '快节奏推进',
        category: 'style',
        description: '短句、短段、快速切换场景，适合动作和紧张情节',
        content: '技巧：\n- 句子控制在20字以内\n- 段落2-3句\n- 多用动词，少用形容词\n- 省略不必要的描写\n示例：跑。追。回头。枪声。',
        tags: ['节奏', '动作', '爽文'],
        isBuiltin: true,
      },
    ];

    for (const skill of builtinSkills) {
      this.addSkill(skill);
    }
  }

  close(): void {
    this.db.close();
  }
}
