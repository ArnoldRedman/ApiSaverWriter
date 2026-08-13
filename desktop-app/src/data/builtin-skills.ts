import type { Skill } from '../App';
import { advancedBuiltinSkills } from './advanced-skills';

const builtinSkillDefinitions: Skill[] = [
  ...advancedBuiltinSkills,
  {
    id: 'builtin-outline-total', name: 'outline-total-planner', displayName: '番茄小说总纲生成器', category: 'setup',
    description: '生成总纲、主线、人物弧光、分卷推进和长期伏笔。', tags: ['总纲', '番茄', '主线'], rating: 5, usageCount: 0, builtin: true,
    content: '# 番茄小说总纲生成器\n\n输出题材卖点、主线目标、人物动机与成长弧、分卷推进、冲突升级、伏笔布局和结局回收。每卷明确目标、阻力、转折和阶段钩子。',
  },
  {
    id: 'builtin-outline-chapter', name: 'fanqie-chapter-outline', displayName: '番茄小说章纲生成器', category: 'setup',
    description: '按番茄快节奏爽文结构生成章纲。', tags: ['章纲', '爽点', '情绪曲线', '章末钩子'], rating: 5, usageCount: 0, builtin: true,
    content: '# 番茄小说章纲生成器\n\n每章包含：章节序号、核心爽点主副类型、压抑—爆发—余韵—新危机四段情绪曲线、1-3 个场景的地点人物目标冲突转折、人物功能、信息揭示、伏笔和强章末钩子。情绪占比通常 20/50/20/10，必须有释放点和追读钩子。',
  },
  {
    id: 'builtin-outline-world', name: 'world-setting-planner', displayName: '世界观与作品设定生成器', category: 'setup',
    description: '建立世界规则、力量体系、势力结构、地图和设定边界。', tags: ['世界观', '设定', '力量体系'], rating: 5, usageCount: 0, builtin: true,
    content: '# 世界观与作品设定生成器\n\n输出时代背景、世界规则、力量/职业体系、资源与代价、势力结构、地理地图、社会秩序、关键名词和设定边界；标记已确认与待揭示内容，避免与知识图谱和卡片冲突。',
  },
  {
    id: 'builtin-story-setup', name: 'story-setup', category: 'setup',
    description: '搭建小说写作工程，检查章节、大纲、卡片与记忆目录。',
    tags: ['项目初始化', '目录', '工作流'], rating: 5, usageCount: 0, builtin: true,
    content: '# story-setup\n\n先检查本地小说目录、元数据、章节、大纲、卡片和记忆中心，再补齐缺失结构；保留已有内容，采用合并更新。',
  },
  {
    id: 'builtin-story-long-write', name: 'story-long-write', category: 'write',
    description: '从选题、世界观和人物，到大纲、细纲与章节正文的长篇写作流程。',
    tags: ['长篇', '大纲', '续写'], rating: 5, usageCount: 0, builtin: true,
    content: '# story-long-write\n\n先确定读者情绪与题材，再建立总纲、细纲、角色卡和伏笔表；每章只加载必要记忆，完成正文、章末钩子和下一章承接。',
  },
  {
    id: 'builtin-chapter-continuity', name: 'chapter-continuity', category: 'write',
    description: '在新章节开始前提取上一章结尾，确保人物、情绪、事件、道具、时间线和钩子连续。',
    tags: ['章节承接', '上一章结尾', '连续性', '悬念'], rating: 5, usageCount: 0, builtin: true,
    content: `# chapter-continuity

## 核心目标
确保本章与上一章在人物、情节、情绪、设定四个维度无缝衔接。上一章结尾是本章开头的最高优先级资料。

## 承接步骤
1. 读取上一章最后 1800 字和该章记忆中的摘要、章末钩子。
2. 明确上一章结束时每个人物的位置、动作和情绪；本章开头必须给出合理延续。
3. 找出未完成的对话、决定、行动、目的地、道具和线索，在本章开头承接或交代转移。
4. 检查时间间隔、场景变化和伏笔状态；有跳跃时用一句到一段过渡交代因果。
5. 判断承接强度：危机/对话未完用强承接，数小时到一天用中承接，数天以上用弱承接并保留情绪余波。
6. 用上一章的一个细节、物品、话语余音或身体感受作为锚点；不要把上一章结尾的钩子直接丢掉。

## 输出约束
先在内部形成“位置、情绪、未解决事件、道具线索、时间线、伏笔、章节钩子”七项承接清单，再写正文。正文第一段自然承接，不要复述清单或解释写作过程。

## 禁止
上一章在冲突中，本章无过渡直接跳到平静日常；忽略上一章钩子和伏笔；人物从 A 地愤怒地跳到 B 地平静而没有原因。`,
  },
  {
    id: 'builtin-story-review', name: 'story-review', category: 'review',
    description: '从结构、人物、设定、节奏和文字自然度多视角审查章节。',
    tags: ['审查', '一致性', '修改建议'], rating: 5, usageCount: 0, builtin: true,
    content: '# story-review\n\n输出问题清单、证据位置、严重程度和可执行修改建议；优先检查人物状态、时间线、伏笔回收和读者契约。',
  },
  {
    id: 'builtin-story-deslop', name: 'story-deslop', category: 'polish',
    description: '降低模板化、过度工整和解释腔，让网文正文更自然。',
    tags: ['去 AI 味', '润色', '保留剧情'], rating: 5, usageCount: 0, builtin: true,
    content: '# story-deslop\n\n少改多保留：删除重复解释，增加具体动作、停顿和口语感；保留伏笔、钩子、角色特征和情节因果。',
  },
  {
    id: 'builtin-story-import', name: 'story-import', category: 'import',
    description: '把已有小说反向解析为可继续写作的本地项目工程。',
    tags: ['导入', '拆解', '续写'], rating: 5, usageCount: 0, builtin: true,
    content: '# story-import\n\n读取已有 Markdown 或文本，提取章节、人物、设定、时间线和伏笔，生成标准本地目录；原文和分析结果均保留。',
  },
  {
    id: 'builtin-story-long-analyze', name: 'story-long-analyze', category: 'analyze',
    description: '深度拆解长篇小说的黄金开篇、人设架构、爽点与节奏。',
    tags: ['拆书', '市场分析', '结构'], rating: 5, usageCount: 0, builtin: true,
    content: '# story-long-analyze\n\n按黄金开篇、人物关系、剧情推进、爽点密度、冲突升级和设定资产输出结构化分析。',
  },
  {
    id: 'builtin-story-long-scan', name: 'story-long-scan', category: 'analyze',
    description: '分析起点、番茄、晋江等平台榜单中的题材与读者趋势。',
    tags: ['扫榜', '题材', '趋势'], rating: 5, usageCount: 0, builtin: true,
    content: '# story-long-scan\n\n跨平台比较样本，提炼重复出现的题材、设定、书名词和开篇卖点，输出可验证的选题候选。',
  },
  {
    id: 'builtin-story-short-write', name: 'story-short-write', category: 'write',
    description: '面向短篇小说的选题、结构、节奏和正文写作流程。',
    tags: ['短篇', '结构', '正文'], rating: 5, usageCount: 0, builtin: true,
    content: '# story-short-write\n\n先确定单一核心冲突和结局，再压缩人物与场景数量，按开端、升级、转折、收束完成短篇正文。',
  },
  {
    id: 'builtin-story-short-analyze', name: 'story-short-analyze', category: 'analyze',
    description: '拆解短篇小说的冲突密度、反转、情绪曲线和结尾回收。',
    tags: ['短篇', '拆解', '反转'], rating: 5, usageCount: 0, builtin: true,
    content: '# story-short-analyze\n\n提取核心冲突、人物目标、关键转折、情绪节点和结尾回收，输出可迁移的结构卡片。',
  },
  {
    id: 'builtin-story-short-scan', name: 'story-short-scan', category: 'analyze',
    description: '分析短篇平台的热门题材、标题、开篇钩子和结尾模式。',
    tags: ['短篇', '扫榜', '选题'], rating: 5, usageCount: 0, builtin: true,
    content: '# story-short-scan\n\n从多个样本中提炼重复的标题结构、开篇承诺、情绪卖点和结尾机制，形成选题候选。',
  },
  {
    id: 'builtin-story-cover', name: 'story-cover', category: 'tool',
    description: '根据书名、作者名和题材生成小说封面提示词与制作方案。',
    tags: ['封面', '视觉', '题材风格'], rating: 5, usageCount: 0, builtin: true,
    content: '# story-cover\n\n读取书名、作者名、频道和题材，生成封面构图、色彩、主体、字体层级和平台尺寸方案。',
  },
  {
    id: 'builtin-browser-cdp', name: 'browser-cdp', category: 'tool',
    description: '通过浏览器 CDP 复用登录态，采集榜单与公开资料。',
    tags: ['浏览器', '榜单', '采集'], rating: 5, usageCount: 0, builtin: true,
    content: '# browser-cdp\n\n仅在用户明确启动浏览器采集时使用；先检测 CDP 状态，再导航、等待、提取页面数据并保存来源。',
  },
  {
    id: 'builtin-skill-creator', name: 'skill-creator', category: 'creator',
    description: '把一句创作需求整理为可复用的技能名称、触发词、步骤和输出契约。',
    tags: ['自创建', '技能模板', '提示词'], rating: 5, usageCount: 0, builtin: true,
    content: '# skill-creator\n\n输入目标、适用场景、触发词、输入字段、执行步骤和输出格式，生成一份可复用 Markdown 技能；保存前检查名称、边界和失败处理。',
  },
];

// Keep the English names as stable routing keys while presenting every built-in
// skill in Chinese throughout the application.
const builtinSkillDisplayNames: Record<string, string> = {
  'next-chapter-plan': '下一章计划',
  'mainline-check': '主线检查',
  'character-motivation': '人物动机',
  'conflict-escalation': '冲突升级',
  'foreshadowing-manager': '伏笔管理',
  'ending-hook': '结尾钩子',
  'pacing-check': '节奏检查',
  'prose-output-protocol': '正文输出协议',
  'suspense-design': '悬念设计',
  'character-entrance': '人物出场',
  'worldview-implant': '世界观植入',
  'setting-consistency': '设定一致性',
  'faction-structure': '势力结构',
  'map-progression': '地图推进',
  'scene-description': '场景描写',
  'dialogue-design': '对话设计',
  transition: '转场过渡',
  'emotion-rendering': '情绪渲染',
  'story-setup': '项目初始化',
  'story-long-write': '长篇写作',
  'chapter-continuity': '章节承接',
  'story-review': '故事审查',
  'story-deslop': '去 AI 味',
  'story-import': '小说导入',
  'story-long-analyze': '长篇拆解',
  'story-long-scan': '长篇扫榜',
  'story-short-write': '短篇写作',
  'story-short-analyze': '短篇拆解',
  'story-short-scan': '短篇扫榜',
  'story-cover': '小说封面',
  'browser-cdp': '浏览器采集',
  'skill-creator': '技能创建器',
};

export const builtinSkills: Skill[] = builtinSkillDefinitions.map(skill => ({
  ...skill,
  displayName: builtinSkillDisplayNames[skill.name] || skill.name,
  // The first Markdown heading is also user-visible in the skill editor.
  content: skill.content.replace(new RegExp(`^#\\s*${skill.name}\\b`, 'm'), `# ${builtinSkillDisplayNames[skill.name] || skill.name}`),
}));
