import type { KnowledgeGraphEdge, KnowledgeGraphNode } from './project';

/** 关系权重表示正文证据强度，不是模型猜测的重要程度 */
export const defaultKnowledgeGraphWeight = (label: string): number => {
  if (label === '本章引用') return 1;
  if (label === '状态更新') return 0.95;
  if (label === '章节主角') return 0.92;
  if (label === '状态引用') return 0.88;
  if (label === '正文提及') return 0.75;
  if (label === '章节提及') return 0.7;
  return 0.65;
};

export const normalizeKnowledgeGraphWeight = (value: unknown, label: string): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  const weight = Number.isFinite(parsed) ? parsed : defaultKnowledgeGraphWeight(label);
  return Math.round(Math.max(0.1, Math.min(1, weight)) * 100) / 100;
};

export const normalizeKnowledgeGraphEdges = (value: unknown): KnowledgeGraphEdge[] => Array.isArray(value)
  ? value.filter((edge): edge is Partial<KnowledgeGraphEdge> => Boolean(edge && typeof edge === 'object'))
    .map(edge => ({
      id: String(edge.id || `${edge.source || 'unknown'}->${edge.target || 'unknown'}:${edge.label || '关联'}`),
      source: String(edge.source || ''),
      target: String(edge.target || ''),
      label: String(edge.label || '关联'),
      weight: normalizeKnowledgeGraphWeight(edge.weight, String(edge.label || '关联')),
      sourceChapterId: edge.sourceChapterId,
      updatedAt: edge.updatedAt,
    })).filter(edge => edge.source && edge.target)
  : [];

export const upsertKnowledgeGraphEdge = (edges: KnowledgeGraphEdge[], next: KnowledgeGraphEdge) => {
  const nextWeight = normalizeKnowledgeGraphWeight(next.weight, next.label);
  const index = edges.findIndex(edge => edge.id === next.id);
  if (index < 0) {
    edges.push({ ...next, weight: nextWeight });
    return;
  }
  const existing = edges[index];
  edges[index] = {
    ...existing,
    ...next,
    weight: Math.max(normalizeKnowledgeGraphWeight(existing.weight, existing.label), nextWeight),
    updatedAt: next.updatedAt || existing.updatedAt,
  };
};

export const graphNodeTypeLabel = (node: KnowledgeGraphNode) => {
  if (node.type === 'chapter') return '章节';
  if (node.type === 'outline') return '大纲';
  if (node.type === 'card') return node.category || '知识卡';
  return node.category || '实体';
};

export const graphNodeGroup = (node: KnowledgeGraphNode) => {
  const type = graphNodeTypeLabel(node);
  if (/角色|人物/u.test(type)) return '重要角色';
  if (/地点|场景/u.test(type)) return '地点与场景';
  if (/势力|组织/u.test(type)) return '组织与势力';
  if (/物品|金手指/u.test(type)) return '物品与设定';
  if (node.type === 'chapter') return '章节事件';
  if (node.type === 'outline') return '大纲设定';
  return '其他实体';
};

export const graphNodeRelativePath = (node: KnowledgeGraphNode) => node.sourcePath || `图谱/${graphNodeGroup(node)}/${node.label}.md`;
export const graphNodeProfile = (node: KnowledgeGraphNode) => node.content?.trim() || `## 基础信息\n- 节点类型：${graphNodeTypeLabel(node)}\n- 当前状态：${node.status || '待补充'}\n\n## 档案\n待补充。`;
export const createGraphNodeProfile = (type: KnowledgeGraphNode['type'], category?: string) => `## 基础信息\n- 节点类型：${type === 'entity' ? category || '实体' : type === 'card' ? category || '知识卡' : type === 'chapter' ? '章节' : '大纲'}\n- 当前状态：待补充\n\n## 档案\n待补充。`;
