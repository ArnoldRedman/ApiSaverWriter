/**
 * 有界并发地跑一组任务，结果按输入顺序返回
 * 批量修订和批量命名的时间几乎全花在等模型响应上：十章串行要几十分钟，前端只看到进度条不动；
 * 但全部并发又会立刻撞上游限流，把本来能成的章一起打成 429。所以固定几路一起跑。
 * run 必须自己吞掉异常并返回结果对象——这里一旦抛出就会连累整批。
 */
export async function mapWithConcurrency<Input, Output>(
  items: readonly Input[],
  limit: number,
  run: (item: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
  const results = new Array<Output>(items.length);
  if (!items.length) return results;
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await run(items[index], index);
    }
  };
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  await Promise.all(Array.from({ length: width }, worker));
  return results;
}
