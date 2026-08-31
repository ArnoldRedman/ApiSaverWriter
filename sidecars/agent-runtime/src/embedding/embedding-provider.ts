/**
 * Embedding Provider Interface
 * 支持多种 embedding 后端：本地模型、API Saver、OpenAI 兼容接口
 */

export interface EmbeddingVector {
  embedding: number[];
  dimensions: number;
}

export interface EmbeddingProvider {
  embed(text: string): Promise<EmbeddingVector>;
  embedBatch(texts: string[]): Promise<EmbeddingVector[]>;
  getDimensions(): number;
}

function normalizeEmbeddingBaseURL(value: string): string {
  const raw = value.trim().replace(/\/+$/, '');
  // 不内置厂商地址：填错或没填时直接报错，否则会静默把正文发到别人的服务上
  if (!/^https?:\/\//i.test(raw)) throw new Error("Embedding 接口地址无效，请在设置中填写完整的 http:// 或 https:// 地址");
  return /\/v1$/i.test(raw) ? raw : `${raw}/v1`;
}

/**
 * OpenAI 兼容的 Embedding Provider
 * 通过传入的 Base URL 调用远程 embedding 模型
 */
export class RemoteEmbeddingProvider implements EmbeddingProvider {
  private dimensions: number;
  private baseURL: string;

  constructor(
    private apiKey: string,
    baseURL: string,
    private model: string = "text-embedding-3-small",
    dimensions?: number
  ) {
    this.baseURL = normalizeEmbeddingBaseURL(baseURL);
    // text-embedding-3-small 默认 1536 维
    // bge-small-zh-v1.5 默认 512 维
    this.dimensions = dimensions || 1536;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  async embed(text: string): Promise<EmbeddingVector> {
    const response = await fetch(`${this.baseURL}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Embedding API failed: ${response.statusText}`);
    }

    const data = await response.json() as { data: Array<{ embedding: number[] }> };
    const embedding = data.data[0].embedding;
    
    return {
      embedding,
      dimensions: embedding.length,
    };
  }

  async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
    const response = await fetch(`${this.baseURL}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      throw new Error(`Embedding API failed: ${response.statusText}`);
    }

    const data = await response.json() as { data: Array<{ embedding: number[] }> };
    return data.data.map((item) => ({
      embedding: item.embedding,
      dimensions: item.embedding.length,
    }));
  }
}

/**
 * Local Embedding Provider
 * 使用 Transformers.js 在本地运行轻量级模型
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  private model: any;
  private dimensions: number;
  private initialized = false;

  constructor(
    private modelName: string = "Xenova/all-MiniLM-L6-v2",
    dimensions?: number
  ) {
    // all-MiniLM-L6-v2: 384 维
    // paraphrase-multilingual-MiniLM-L12-v2: 384 维
    this.dimensions = dimensions || 384;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  private async init() {
    if (this.initialized) return;
    
    const { pipeline } = await import("@xenova/transformers");
    this.model = await pipeline("feature-extraction", this.modelName);
    this.initialized = true;
  }

  async embed(text: string): Promise<EmbeddingVector> {
    await this.init();
    
    const output = await this.model(text, { pooling: "mean", normalize: true });
    const embedding = Array.from(output.data) as number[];
    
    return {
      embedding,
      dimensions: embedding.length,
    };
  }

  async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
    await this.init();
    
    const results: EmbeddingVector[] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }
}
