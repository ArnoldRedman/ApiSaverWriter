/**
 * 流式输出处理器
 * 用于实时推送章节生成进度
 */

export type StreamEventType = 
  | "progress"      // 进度更新
  | "chunk"         // 文本片段
  | "complete"      // 完成
  | "error";        // 错误

export interface StreamEvent {
  type: StreamEventType;
  data: {
    step?: string;           // 当前步骤名称
    progress?: number;       // 进度 0-100
    text?: string;           // 生成的文本片段
    message?: string;        // 状态消息
    error?: string;          // 错误信息
  };
  timestamp: number;
}

export type StreamCallback = (event: StreamEvent) => void;

/**
 * 流式事件发射器
 */
export class StreamEmitter {
  private callbacks: StreamCallback[] = [];

  subscribe(callback: StreamCallback): () => void {
    this.callbacks.push(callback);
    // 返回取消订阅函数
    return () => {
      const index = this.callbacks.indexOf(callback);
      if (index > -1) {
        this.callbacks.splice(index, 1);
      }
    };
  }

  emit(type: StreamEventType, data: StreamEvent["data"]): void {
    const event: StreamEvent = {
      type,
      data,
      timestamp: Date.now(),
    };

    for (const callback of this.callbacks) {
      try {
        callback(event);
      } catch (err) {
        console.error("Stream callback error:", err);
      }
    }
  }

  progress(step: string, progress: number, message?: string): void {
    this.emit("progress", { step, progress, message });
  }

  chunk(text: string): void {
    this.emit("chunk", { text });
  }

  complete(message?: string): void {
    this.emit("complete", { message });
  }

  error(error: string): void {
    this.emit("error", { error });
  }
}

/**
 * 流式文本累加器
 * 用于从 LLM 流式响应中累积文本
 */
export class StreamAccumulator {
  private buffer = "";
  private onChunk?: (chunk: string) => void;

  constructor(onChunk?: (chunk: string) => void) {
    this.onChunk = onChunk;
  }

  append(chunk: string): void {
    this.buffer += chunk;
    if (this.onChunk) {
      this.onChunk(chunk);
    }
  }

  getContent(): string {
    return this.buffer;
  }

  clear(): void {
    this.buffer = "";
  }
}
