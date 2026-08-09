import Database from "better-sqlite3";
import type { EmbeddingProvider } from "../embedding/embedding-provider.js";

export type MemoryType = "event" | "character_state" | "canon_fact" | "foreshadowing" | "timeline" | "style";

export interface ProjectRecord { id: string; title: string; }
export interface MemoryRecord {
  id: string;
  projectId: string;
  type: MemoryType;
  title: string;
  content: string;
  entityNames: string[];
  confirmed: boolean;
  importance: number;
}

export interface VectorSearchResult extends MemoryRecord {
  similarity: number;
}

export class StoryStore {
  private embeddingProvider?: EmbeddingProvider;
  private vectorDimensions?: number;

  private constructor(private readonly db: Database.Database) {
    this.migrate();
  }

  static inMemory(): StoryStore {
    return new StoryStore(new Database(":memory:"));
  }

  static open(path: string): StoryStore {
    return new StoryStore(new Database(path));
  }

  /**
   * 启用向量检索功能
   * @param provider Embedding provider (API or local model)
   */
  enableVectorSearch(provider: EmbeddingProvider): void {
    this.embeddingProvider = provider;
    this.vectorDimensions = provider.getDimensions();
    this.migrateVectorTables();
  }

  close(): void { this.db.close(); }

  private migrate(): void {
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS memory_items (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        entity_names TEXT NOT NULL DEFAULT '[]',
        confirmed INTEGER NOT NULL DEFAULT 0,
        importance REAL NOT NULL DEFAULT 0.5,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_memory_project_confirmed
        ON memory_items(project_id, confirmed);
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        memory_id UNINDEXED,
        project_id UNINDEXED,
        title,
        content,
        entity_names,
        tokenize = 'unicode61'
      );
    `);
  }

  private migrateVectorTables(): void {
    if (!this.vectorDimensions) {
      throw new Error("Vector dimensions not set");
    }

    // 注意：sqlite-vec 需要作为扩展加载
    // 实际部署时需要：db.loadExtension('vec0')
    try {
      // 尝试加载 sqlite-vec 扩展（如果可用）
      // this.db.loadExtension('vec0');
    } catch (err) {
      console.warn("sqlite-vec extension not available, skipping vector table creation");
      return;
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_vectors (
        memory_id TEXT PRIMARY KEY REFERENCES memory_items(id) ON DELETE CASCADE,
        embedding BLOB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_vector_memory
        ON memory_vectors(memory_id);
    `);
  }

  createProject(project: ProjectRecord): void {
    this.db.prepare("INSERT OR REPLACE INTO projects (id, title) VALUES (?, ?)")
      .run(project.id, project.title);
  }

  saveMemory(memory: MemoryRecord): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT OR REPLACE INTO memory_items
          (id, project_id, type, title, content, entity_names, confirmed, importance)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        memory.id,
        memory.projectId,
        memory.type,
        memory.title,
        memory.content,
        JSON.stringify(memory.entityNames),
        memory.confirmed ? 1 : 0,
        memory.importance,
      );
      this.db.prepare("DELETE FROM memory_fts WHERE memory_id = ?").run(memory.id);
      if (memory.confirmed) {
        // Split CJK into individual characters for substring search
        const splitText = (text: string) => Array.from(text).join(" ");
        this.db.prepare(`
          INSERT INTO memory_fts (memory_id, project_id, title, content, entity_names)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          memory.id,
          memory.projectId,
          splitText(memory.title),
          splitText(memory.content),
          splitText(memory.entityNames.join(" "))
        );
      }
    });
    tx();
  }

  /**
   * 为记忆生成并存储向量
   */
  async saveMemoryVector(memoryId: string, content: string): Promise<void> {
    if (!this.embeddingProvider) {
      throw new Error("Embedding provider not configured");
    }

    const { embedding } = await this.embeddingProvider.embed(content);
    const buffer = Buffer.from(new Float32Array(embedding).buffer);

    this.db.prepare(`
      INSERT OR REPLACE INTO memory_vectors (memory_id, embedding)
      VALUES (?, ?)
    `).run(memoryId, buffer);
  }

  /**
   * 语义向量检索
   * 注意：这是简化实现，真实的 sqlite-vec 使用 vec_distance_cosine 等函数
   */
  async searchSemantic(projectId: string, query: string, limit = 10): Promise<VectorSearchResult[]> {
    if (!this.embeddingProvider) {
      throw new Error("Embedding provider not configured");
    }

    const { embedding: queryEmbedding } = await this.embeddingProvider.embed(query);

    // 获取所有已确认的记忆及其向量
    const rows = this.db.prepare(`
      SELECT m.id, m.project_id, m.type, m.title, m.content, m.entity_names,
             m.confirmed, m.importance, v.embedding
      FROM memory_items m
      JOIN memory_vectors v ON v.memory_id = m.id
      WHERE m.project_id = ? AND m.confirmed = 1
    `).all(projectId) as Array<Record<string, unknown>>;

    // 计算余弦相似度
    const results: VectorSearchResult[] = [];
    for (const row of rows) {
      const embeddingBuffer = row.embedding as Buffer;
      const embedding = new Float32Array(embeddingBuffer.buffer, embeddingBuffer.byteOffset, embeddingBuffer.byteLength / 4);
      const similarity = this.cosineSimilarity(queryEmbedding, Array.from(embedding));
      
      results.push({
        ...this.toMemory(row),
        similarity,
      });
    }

    // 按相似度排序并返回 top-k
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  /**
   * 混合检索：FTS5 关键词 + 向量语义
   */
  async searchHybrid(projectId: string, query: string, limit = 20): Promise<VectorSearchResult[]> {
    // FTS5 检索
    const ftsResults = this.searchExact(projectId, query, limit);
    
    // 向量检索
    let vectorResults: VectorSearchResult[] = [];
    if (this.embeddingProvider) {
      try {
        vectorResults = await this.searchSemantic(projectId, query, limit);
      } catch (err) {
        console.warn("Vector search failed, falling back to FTS only:", err);
      }
    }

    // 合并结果并去重
    const seen = new Set<string>();
    const merged: VectorSearchResult[] = [];

    // 先加入 FTS 结果（默认相似度 0.5）
    for (const item of ftsResults) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        merged.push({ ...item, similarity: 0.5 });
      }
    }

    // 再加入向量结果
    for (const item of vectorResults) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        merged.push(item);
      } else {
        // 如果已存在，更新为更高的相似度
        const existing = merged.find(m => m.id === item.id);
        if (existing && item.similarity > existing.similarity) {
          existing.similarity = item.similarity;
        }
      }
    }

    // 按相似度和重要性综合排序
    return merged
      .sort((a, b) => {
        const scoreA = a.similarity * 0.7 + a.importance * 0.3;
        const scoreB = b.similarity * 0.7 + b.importance * 0.3;
        return scoreB - scoreA;
      })
      .slice(0, limit);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Vector dimensions mismatch");
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  searchExact(projectId: string, query: string, limit = 20): MemoryRecord[] {
    const rows = this.db.prepare(`
      SELECT m.id, m.project_id, m.type, m.title, m.content, m.entity_names,
             m.confirmed, m.importance
      FROM memory_fts f
      JOIN memory_items m ON m.id = f.memory_id
      WHERE f.project_id = ? AND memory_fts MATCH ? AND m.confirmed = 1
      ORDER BY bm25(memory_fts), m.importance DESC
      LIMIT ?
    `).all(projectId, this.toFtsQuery(query), limit) as Array<Record<string, unknown>>;
    return rows.map((row) => this.toMemory(row));
  }

  listConfirmed(projectId: string, limit = 100): MemoryRecord[] {
    const rows = this.db.prepare(`
      SELECT id, project_id, type, title, content, entity_names, confirmed, importance
      FROM memory_items WHERE project_id = ? AND confirmed = 1
      ORDER BY importance DESC, created_at DESC LIMIT ?
    `).all(projectId, limit) as Array<Record<string, unknown>>;
    return rows.map((row) => this.toMemory(row));
  }

  private toFtsQuery(query: string): string {
    const trimmed = query.trim();
    if (!trimmed) return '""';
    // Split CJK into individual characters, filtering out whitespace
    const chars = Array.from(trimmed)
      .filter(c => c.trim().length > 0)
      .map(c => `"${c.replace(/"/g, '""')}"`);
    return chars.join(" AND ");
  }

  private toMemory(row: Record<string, unknown>): MemoryRecord {
    let entityNames: string[] = [];
    try { entityNames = JSON.parse(String(row.entity_names ?? "[]")); } catch { /* tolerate old rows */ }
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      type: String(row.type) as MemoryType,
      title: String(row.title),
      content: String(row.content),
      entityNames,
      confirmed: Boolean(row.confirmed),
      importance: Number(row.importance),
    };
  }
}
