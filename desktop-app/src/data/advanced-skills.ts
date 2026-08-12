import type { Skill } from '../App';

/** QMAI-inspired writing checks. Kept as editable Markdown so users can fork them. */
export const advancedBuiltinSkills: Skill[] = [
  {
    id: 'builtin-next-chapter-plan', name: 'next-chapter-plan', category: 'write',
    description: '先编写可确认的下一章计划，再据此生成正文，明确承接、事件链、节奏和交接信息。',
    tags: ['下一章计划', '章节规划', '事件链', '四拍节奏'], rating: 5, usageCount: 0, builtin: true,
    content: '# next-chapter-plan\n\n先输出短计划，不直接写正文。计划必须包含上一章交接、人物目标与动机、核心事件链、冲突升级、四段节奏（开场/发展/转折/收束）、本章新增信息、伏笔推进、结尾钩子和下一章交接。每一项都引用已有资料，未知项标为待确认；正文生成必须逐项兑现计划。',
  },
  {
    id: 'builtin-mainline-check', name: 'mainline-check', category: 'review',
    description: '检查本章是否推进主线目标，避免只写支线和无效日常。', tags: ['主线检查', '目标', '剧情推进'], rating: 5, usageCount: 0, builtin: true,
    content: '# mainline-check\n\n列出当前卷主线目标、本章推进动作、阻力和结果；若没有推进，补一个最小但可验证的主线变化。',
  },
  {
    id: 'builtin-character-motivation', name: 'character-motivation', category: 'write',
    description: '让每个关键行动都有角色目标、压力和可解释的选择。', tags: ['人物动机', '角色弧光', '行动因果'], rating: 5, usageCount: 0, builtin: true,
    content: '# character-motivation\n\n写作前为每个出场角色标注当前目标、已知信息、情绪、顾虑和本章选择；行动必须由动机触发，拒绝为推进剧情而让角色失智。',
  },
  {
    id: 'builtin-conflict-escalation', name: 'conflict-escalation', category: 'write',
    description: '逐级提高阻力、代价和风险，让冲突产生真实升级。', tags: ['冲突升级', '阻力', '代价', '风险'], rating: 5, usageCount: 0, builtin: true,
    content: '# conflict-escalation\n\n按目标、阻力、选择、代价记录冲突；每次升级至少改变资源、关系、时间或风险中的一项，避免重复争吵和空泛威胁。',
  },
  {
    id: 'builtin-foreshadowing-manager', name: 'foreshadowing-manager', category: 'review',
    description: '维护伏笔状态、线索来源、回收窗口和读者可见度。', tags: ['伏笔管理', '线索', '回收'], rating: 5, usageCount: 0, builtin: true,
    content: '# foreshadowing-manager\n\n为新增或推进的伏笔记录来源、当前状态、下一步动作和预计回收窗口；只推进有正文证据的线索，不强行解释未成熟伏笔。',
  },
  {
    id: 'builtin-ending-hook', name: 'ending-hook', category: 'write',
    description: '设计章末行动、发现、反转或风险钩子，并与下一章计划交接。', tags: ['结尾钩子', '悬念', '章末'], rating: 5, usageCount: 0, builtin: true,
    content: '# ending-hook\n\n结尾必须产生未完成的行动或问题；钩子来自本章因果，不靠突然出现的新设定。输出钩子类型、读者问题和下一章第一步。',
  },
  {
    id: 'builtin-pacing-check', name: 'pacing-check', category: 'review',
    description: '检查本章的信息密度、场景停留、冲突间隔和情绪曲线。', tags: ['节奏检查', '信息密度', '情绪曲线'], rating: 5, usageCount: 0, builtin: true,
    content: '# pacing-check\n\n按段落标注动作、信息、情绪和冲突功能；连续解释超过两段或长时间没有变化时，加入具体行动、选择或新信息。',
  },
  {
    id: 'builtin-prose-output-protocol', name: 'prose-output-protocol', category: 'write',
    description: '约束正文输出格式、视角、章节标题和可直接粘贴性。', tags: ['正文输出协议', '格式', '网文'], rating: 5, usageCount: 0, builtin: true,
    content: '# prose-output-protocol\n\n正文只输出章节内容，不输出思考、提纲、标签或解释；使用约定视角和称谓，段落适合 Markdown 编辑器，摘要与正文分字段返回。',
  },
  {
    id: 'builtin-suspense-design', name: 'suspense-design', category: 'write',
    description: '设计读者问题、信息差和逐步揭示，保持悬念可追踪。', tags: ['悬念设计', '信息差', '问题链'], rating: 5, usageCount: 0, builtin: true,
    content: '# suspense-design\n\n明确读者知道什么、角色知道什么、未知问题是什么；每次揭示解决一个旧问题并制造一个更具体的新问题，避免故弄玄虚。',
  },
  {
    id: 'builtin-character-entrance', name: 'character-entrance', category: 'write',
    description: '让人物出场带着身份信号、行动目的和对当前场面的影响。', tags: ['人物出场', '角色识别', '出场动作'], rating: 5, usageCount: 0, builtin: true,
    content: '# character-entrance\n\n人物首次出场用动作、语言或他人反应传达身份和欲望；避免角色只站在场景里报名字，出场必须改变局面。',
  },
  {
    id: 'builtin-worldview-implant', name: 'worldview-implant', category: 'write',
    description: '把世界观规则植入行动和感官，不用说明书式大段介绍。', tags: ['世界观植入', '规则', '感官'], rating: 5, usageCount: 0, builtin: true,
    content: '# worldview-implant\n\n只在角色需要做选择时展示规则、代价和例外；用场景细节和后果让读者理解世界观，避免脱离剧情的百科式说明。',
  },
  {
    id: 'builtin-setting-consistency', name: 'setting-consistency', category: 'review',
    description: '核对力量、时间、称谓、物品、地理和规则的一致性。', tags: ['设定一致性', '时间线', '规则'], rating: 5, usageCount: 0, builtin: true,
    content: '# setting-consistency\n\n生成后逐项核对人物状态、能力边界、物品归属、地点距离、时间线和已确认规则；发现矛盾时给出正文证据和最小修订。',
  },
  {
    id: 'builtin-faction-structure', name: 'faction-structure', category: 'setup',
    description: '整理势力目标、层级、资源、盟友与敌对关系，服务主线冲突。', tags: ['势力结构', '组织', '资源关系'], rating: 5, usageCount: 0, builtin: true,
    content: '# faction-structure\n\n为每个势力记录公开目标、隐藏目标、核心资源、内部层级、盟友与敌人；势力行动要受资源和利益约束。',
  },
  {
    id: 'builtin-map-progression', name: 'map-progression', category: 'setup',
    description: '管理地点解锁、移动路线、距离成本和地图推进节奏。', tags: ['地图推进', '地点', '路线'], rating: 5, usageCount: 0, builtin: true,
    content: '# map-progression\n\n记录当前位置、目的地、移动方式、耗时、沿途阻力和新地点规则；场景切换必须交代时间或因果成本。',
  },
  {
    id: 'builtin-scene-description', name: 'scene-description', category: 'write',
    description: '用可感知细节建立场景，并让环境参与冲突和人物选择。', tags: ['场景描写', '感官', '环境互动'], rating: 5, usageCount: 0, builtin: true,
    content: '# scene-description\n\n每个场景选择能影响行动的视觉、声音、气味、触感细节；环境描写服务氛围、线索或阻力，不堆砌形容词。',
  },
  {
    id: 'builtin-dialogue-design', name: 'dialogue-design', category: 'write',
    description: '设计带目的、潜台词和信息差的对话，区分人物声音。', tags: ['对话设计', '潜台词', '人物声音'], rating: 5, usageCount: 0, builtin: true,
    content: '# dialogue-design\n\n每句对白都要有目标或防御；避免角色互相复述已知事实。用措辞、停顿和回避体现关系与潜台词。',
  },
  {
    id: 'builtin-transition', name: 'transition', category: 'write',
    description: '处理时间、地点和视角切换，让转场携带因果和情绪余波。', tags: ['转场过渡', '时间跳跃', '场景切换'], rating: 5, usageCount: 0, builtin: true,
    content: '# transition\n\n转场前确认未解决动作和情绪，转场后用锚点、结果或目的地接住；弱承接必须交代跳过时间发生的关键变化。',
  },
  {
    id: 'builtin-emotion-rendering', name: 'emotion-rendering', category: 'write',
    description: '用身体反应、选择和节奏表现情绪，避免直接贴标签。', tags: ['情绪渲染', '身体反应', '情绪余波'], rating: 5, usageCount: 0, builtin: true,
    content: '# emotion-rendering\n\n先承接上一场情绪余波，再让新事件覆盖或转移情绪；通过动作、感官、内心取舍和语言节奏表现，不连续写“他很紧张”。',
  },
];
