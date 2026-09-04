/**
 * 拆章切点计算：chapter.parts 变更只带段落序号，不带正文
 * 这一份放在契约层，因为切点的含义必须三端一致——运行时（桌面）和 platform.ts（移动端）
 * 算出 breakAfter，App.tsx 按同一套分段规则落地。任何一边的分段规则不同，
 * 同一个 breakAfter 就会切在不同的地方，正文会被拦腰截断。
 * 纯函数，不依赖模型、文件系统和平台。
 */

/** 一段最少要有多少字，避免切出几十字的碎片章 */
export const minChapterPartCharacters = 400;
/** 一章最多切成几段：再多说明目标字数填得不合理，与其切碎不如报错 */
export const maxChapterParts = 12;

/** 正文按空行分段：拆章只能落在段落边界上，绝不在句子中间断开 */
export function splitParagraphs(content: string): string[] {
  return content.replace(/\r\n/gu, '\n').split(/\n\s*\n/u).map(item => item.trim()).filter(Boolean);
}

/** 小说字数一律按“去掉空白后的字符数”算，和界面上的章节字数同一口径 */
export const chapterCharacterCount = (value: string): number => value.replace(/\s/gu, '').length;

/** 段落字数的前缀和，用来 O(1) 取任意一段的字数 */
function prefixCounts(paragraphs: readonly string[]): number[] {
  const prefix = [0];
  for (const item of paragraphs) {
    prefix.push(prefix[prefix.length - 1] + chapterCharacterCount(item));
  }
  return prefix;
}

/**
 * 按段落边界切章的动态规划
 * 贪心累加（越过目标字数就断）会把误差全推到最后一段，实测 6000 字的章切出
 * 「2484 / 2445 / 501」这种尾巴：作者拿到的不是均匀的三章，而是两章加一个碎片。
 * 这里改成整体最优：每段代价取「字数偏离期望值的平方」，总代价最小的切法把误差摊到了每一段。
 * 段落是原子单位，低于 minChapterPartCharacters 的切法直接排除，正文一个字都不会被改写。
 * pieces 给定时只考虑那一种段数；不给时在 1..maxChapterParts 里一并选段数，
 * 于是「该拆几段」和「在哪里拆」由同一个目标决定，不需要另外定“超过多少倍才算超长”的阈值。
 */
function planBreaks(paragraphs: readonly string[], expected: (pieces: number) => number, pieces?: number): number[] {
  const count = paragraphs.length;
  const most = Math.min(pieces ?? maxChapterParts, count, maxChapterParts);
  if (most < 1) return [];
  const least = pieces ? most : 1;
  const prefix = prefixCounts(paragraphs);
  // cost[k][i]：前 i 段切成 k 份的最小代价；from[k][i] 记住上一刀的位置
  const cost = Array.from({ length: most + 1 }, () => new Float64Array(count + 1).fill(Number.POSITIVE_INFINITY));
  const from = Array.from({ length: most + 1 }, () => new Int32Array(count + 1).fill(-1));
  cost[0][0] = 0;
  for (let piece = 1; piece <= most; piece += 1) {
    const target = expected(piece);
    const last = count - Math.max(0, least - piece);
    for (let end = piece; end <= last; end += 1) {
      for (let start = piece - 1; start < end; start += 1) {
        if (!Number.isFinite(cost[piece - 1][start])) continue;
        const size = prefix[end] - prefix[start];
        // 碎片章直接排除：与其切出几十字一段，不如少切一刀
        if (size < minChapterPartCharacters) continue;
        const total = cost[piece - 1][start] + (size - target) ** 2;
        // 均匀程度一样时取靠后的切点：前面几章先填到目标字数，作者读起来更符合预期
        if (total <= cost[piece][end]) {
          cost[piece][end] = total;
          from[piece][end] = start;
        }
      }
    }
  }
  let best = 0;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let piece = least; piece <= most; piece += 1) {
    if (cost[piece][count] < bestCost) {
      bestCost = cost[piece][count];
      best = piece;
    }
  }
  if (best < 2) return [];
  const breaks: number[] = [];
  let cursor = count;
  for (let piece = best; piece > 1; piece -= 1) {
    cursor = from[piece][cursor];
    breaks.unshift(cursor);
  }
  return breaks;
}

/**
 * 把一章拆成正好 parts 段，各段字数尽量相等
 * 作者直接报了章数时走这条：期望值就是平均值，不再关心每段多少字。
 * 无解（任何切法都会切出碎片）时返回空数组，由调用方降低段数重试。
 */
export function planBalancedBreaks(paragraphs: readonly string[], parts: number): number[] {
  if (paragraphs.length < 2 || parts < 2) return [];
  const total = prefixCounts(paragraphs)[paragraphs.length];
  const wanted = Math.min(parts, paragraphs.length, maxChapterParts);
  return planBreaks(paragraphs, () => total / wanted, wanted);
}

/**
 * 算出一章要在哪些段落之后断开
 * - 只给了每章目标字数：段数和切点一起算，取“各段字数最贴近目标”的切法；
 *   切成一段（即不拆）也在候选里，所以不够长的章自然不会被拆。
 * - 作者直接说了段数（parts）：照这个数均分，不再判断字数够不够，2977 字要拆成两段也拆。
 *   要不到的段数逐级降，降到 2 段仍无解才算这一章拆不动。
 * 返回空数组表示这一章不需要拆，或根本切不开。
 */
export function planChapterBreaks(paragraphs: readonly string[], targetCharacters: number, parts?: number): number[] {
  if (paragraphs.length < 2) return [];
  if (!parts || parts < 2) {
    return planBreaks(paragraphs, () => Math.max(minChapterPartCharacters, targetCharacters));
  }
  for (let attempt = Math.min(parts, maxChapterParts); attempt >= 2; attempt -= 1) {
    const breaks = planBalancedBreaks(paragraphs, attempt);
    if (breaks.length) return breaks;
  }
  return [];
}

/** 按切点把段落还原成各段正文，用于给模型命名和给作者预览 */
export function partsFromBreaks(paragraphs: readonly string[], breakAfter: readonly number[]): string[] {
  const bounds = [0, ...breakAfter, paragraphs.length];
  const parts: string[] = [];
  for (let index = 0; index < bounds.length - 1; index += 1) {
    parts.push(paragraphs.slice(bounds[index], bounds[index + 1]).join('\n\n'));
  }
  return parts;
}

/**
 * 把「这几章一共拆成 N 章」按字数分配到各章
 * 作者说的是“150、151 两章拆成 6 章”，不是“每章各拆 6 章”；长的多分一段，每段字数才能齐。
 * 按字数比例取整会在边上选错（4906 / 6975 字拆 6 段时 2+4 比 3+3 更均），所以直接对目标优化：
 * 每章先分 1 段，剩下的名额逐个给“多分一段后总平方差降得最多”的章。
 * 代价对段数是凸的，所以逐个贪心给出的就是最优分配。
 */
export function allocateChapterParts(chapters: ReadonlyArray<{ targetId: number; characters: number }>, total: number): Map<number, number> {
  const allocation = new Map(chapters.map(item => [item.targetId, 1]));
  const sum = chapters.reduce((value, item) => value + item.characters, 0);
  if (!sum || !chapters.length) return allocation;
  const mean = sum / Math.max(1, total);
  // 一章切成 parts 段、各段均匀时的总平方差；距平均值越远代价越高
  const cost = (characters: number, parts: number) => parts * (characters / parts - mean) ** 2;
  for (let remaining = total - chapters.length; remaining > 0; remaining -= 1) {
    let best: { targetId: number; gain: number } | null = null;
    for (const item of chapters) {
      const current = allocation.get(item.targetId) || 1;
      if (current >= maxChapterParts) continue;
      const gain = cost(item.characters, current) - cost(item.characters, current + 1);
      if (!best || gain > best.gain) best = { targetId: item.targetId, gain };
    }
    if (!best) break;
    allocation.set(best.targetId, (allocation.get(best.targetId) || 1) + 1);
  }
  return allocation;
}
