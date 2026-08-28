import type { Project } from './project';

/**
 * 删除章节并清理所有引用它的派生数据
 * UI 手动删除和项目 Agent 的 chapter.delete 共用这一份级联，避免两条路径清理不一致
 */
export const removeChapterFromProject = (project: Project, chapterId: number): Project => {
  const chapters = project.chapters.filter(chapter => chapter.id !== chapterId);
  if (chapters.length === project.chapters.length) return project;
  const chapterNodeId = `chapter:${chapterId}`;
  return {
    ...project,
    chapters,
    // 章纲是可复用的写作计划，只解除绑定；正文派生的章节记忆随正文一起删除
    outlines: project.outlines.map(outline => outline.chapterId === chapterId ? { ...outline, chapterId: undefined } : outline),
    memories: project.memories.filter(memory => memory.chapterId !== chapterId),
    cards: project.cards.map(card => card.stateHistory?.some(entry => entry.chapterId === chapterId)
      ? { ...card, stateHistory: card.stateHistory.filter(entry => entry.chapterId !== chapterId) }
      : card),
    graphNodes: project.graphNodes.filter(node => node.id !== chapterNodeId),
    graphEdges: project.graphEdges.filter(edge => edge.source !== chapterNodeId && edge.target !== chapterNodeId),
    // 检测报告按章存放，删除后对应条目不再有可跳转的目标
    aiDetection: project.aiDetection
      ? { ...project.aiDetection, chapters: project.aiDetection.chapters.filter(item => item.chapterId !== chapterId) }
      : undefined,
    wordCount: chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
    updatedAt: new Date().toISOString(),
  };
};
