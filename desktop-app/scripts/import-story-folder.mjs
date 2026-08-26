#!/usr/bin/env node
// 把 StoryForge 风格的小说工作目录导入成 ApiSaverWriter 的一本书。
//
//   node scripts/import-story-folder.mjs "C:\AI工作流搭建" [--dry-run] [--app-data <目录>]
//
// 目标目录中的 projects/ 为空时，应用会回退读取 projects.json，并在下一次
// 自动保存时把它拆分成正式的目录结构，所以这里只需要写单个 JSON 索引。
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const sourceRoot = resolve(args.find(item => !item.startsWith('--')) ?? '.');
const dryRun = args.includes('--dry-run');
const appDataRoot = resolve(flag('--app-data')
  ?? join(process.env.APPDATA ?? join(process.env.HOME ?? '.', '.config'), 'com.apisaverwriter.app'));

const now = new Date().toISOString();
const read = (...parts) => {
  const path = join(sourceRoot, ...parts);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
};
const readJSON = (...parts) => {
  const raw = read(...parts);
  if (!raw.trim()) return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
};
const listFiles = (relative, extension) => {
  const path = join(sourceRoot, relative);
  return existsSync(path)
    ? readdirSync(path).filter(name => name.endsWith(extension)).sort()
    : [];
};

/** Renders arbitrary settings JSON as readable Markdown. The source bible files
 * have no shared shape, so keys stay verbatim and only the nesting is styled. */
const toMarkdown = (value, level = 2) => {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) {
    if (!value.length) return '';
    if (value.every(item => typeof item !== 'object' || item === null)) {
      return value.map(item => `- ${item}`).join('\n');
    }
    return value.map(item => {
      const label = typeof item === 'object' && item ? (item.name ?? item.title ?? item.id ?? '') : '';
      const body = toMarkdown(item, Math.min(level + 1, 6));
      return label ? `${'#'.repeat(Math.min(level, 6))} ${label}\n\n${body}` : body;
    }).filter(Boolean).join('\n\n');
  }
  return Object.entries(value).map(([key, item]) => {
    if (item === null || item === undefined || item === '') return '';
    if (typeof item !== 'object') return `- **${key}**：${item}`;
    if (Array.isArray(item) && item.every(entry => typeof entry !== 'object' || entry === null)) {
      return item.length ? `- **${key}**：\n${item.map(entry => `  - ${entry}`).join('\n')}` : '';
    }
    const body = toMarkdown(item, Math.min(level + 1, 6));
    return body ? `${'#'.repeat(Math.min(level, 6))} ${key}\n\n${body}` : '';
  }).filter(Boolean).join('\n\n');
};

const characterFiles = listFiles('story_data/bible/characters', '.json');
const characters = characterFiles
  .map(name => ({ file: name, data: readJSON('story_data/bible/characters', name) }))
  .filter(item => item.data && typeof item.data === 'object');
const state = readJSON('story_data/state/state.json');
const framework = read('story_data/outlines/master_story_framework.md');

// Framework fields are Markdown bullets, so drop the emphasis markers that
// would otherwise show up literally in the app's synopsis field.
const matchField = (label) => (framework.match(new RegExp(`\\*\\*${label}\\*\\*[：:]\\s*(.+)`))?.[1] ?? '')
  .replace(/\*\*/g, '').trim();
const bookTitle = matchField('正式书名').replace(/^《|》.*$/g, '').trim()
  || basename(sourceRoot);
const themes = matchField('核心题材');
const volumeScale = matchField('全书体量');

// The transmigrator is the viewpoint character; their strongest tracked
// relationship gives the second lead.
const protagonistEntry = characters.find(item => item.data.transmigration_lore?.is_transmigrator) ?? characters[0];
const protagonist1 = protagonistEntry?.data?.name ?? '';
const protagonistId = protagonistEntry?.data?.id ?? '';
const partnerId = Object.entries(state?.relationship_stages ?? {})
  .map(([pair, detail]) => ({ pair, weight: Array.isArray(detail?.evidence_chain) ? detail.evidence_chain.length : 0 }))
  .sort((left, right) => right.weight - left.weight)
  .flatMap(item => item.pair.split('@'))
  .find(id => id && id !== protagonistId);
const protagonist2 = characters.find(item => item.data.id === partnerId)?.data?.name ?? '';

const arcLines = framework.split('\n')
  .filter(line => /^>\s+-\s+(前期|中期|后期|终期)/.test(line))
  .map(line => line.replace(/^>\s+-\s+/, '').replace(/\*\*/g, '').trim());
const synopsis = [
  themes && `核心题材：${themes}`,
  protagonist1 && protagonist2 && `主角：${protagonist1} × ${protagonist2}`,
  volumeScale && `体量：${volumeScale}`,
  ...arcLines,
].filter(Boolean).join('\n');

let nextId = 1;
const id = () => nextId++;

const chapters = listFiles('story_data/chapters', '.md').map((name, index) => {
  const raw = read('story_data/chapters', name);
  const heading = raw.match(/^#\s+(.+?)\s*$/m);
  const fallback = `第 ${String(index + 1).padStart(3, '0')} 章`;
  // The H1 becomes the chapter title, so drop it from the body to avoid a
  // duplicated heading inside the editor.
  const content = heading ? raw.replace(heading[0], '').replace(/^\s+/, '') : raw;
  return {
    id: index + 1,
    title: (heading?.[1] ?? fallback).trim(),
    content,
    wordCount: content.replace(/\s/g, '').length,
    createdAt: now,
    updatedAt: now,
  };
});
// load_projects reads each chapter back by title, so duplicates would collide.
const seenTitles = new Set();
for (const chapter of chapters) {
  if (seenTitles.has(chapter.title)) chapter.title = `${chapter.title}（${chapter.id}）`;
  seenTitles.add(chapter.title);
}
nextId = chapters.length + 1;

const outlineDocument = (kind, title, content) => content?.trim()
  ? { id: id(), kind, title, content: content.trim(), createdAt: now, updatedAt: now }
  : undefined;

const beats = readJSON('story_data/outlines/vol_1_chapter_1_beats.json');
const worldRules = readJSON('story_data/bible/world/world_rules.json');
const urbanRules = readJSON('story_data/bible/world/urban_rules.json');

const outlines = [
  outlineDocument('总纲', '全书总纲与核心故事框架', framework),
  outlineDocument('章纲', '第一卷章节节拍表', beats && toMarkdown(beats)),
  outlineDocument('世界观与作品设定', '世界法则与战力体系', worldRules && toMarkdown(worldRules)),
  outlineDocument('世界观与作品设定', '都市现实规则', urbanRules && toMarkdown(urbanRules)),
  outlineDocument('世界观与作品设定', '动态状态与硬事实账本', state && toMarkdown(state)),
  outlineDocument('世界观与作品设定', '写作风格与反 AI 味规范', read('NOVEL_STYLE_AND_CRAFT_GUIDE.md')),
  outlineDocument('世界观与作品设定', '修订日志', read('story_data/REVISION_LOG.md')),
].filter(Boolean);

/** Relationship stages in state.json describe how each character currently
 * stands toward the protagonist, which is exactly the card's current state. */
const currentStateFor = (characterId) => {
  const entry = Object.entries(state?.relationship_stages ?? {})
    .find(([pair]) => pair.split('@').includes(characterId));
  if (!entry) return '';
  const [, detail] = entry;
  return [
    detail.stage && `关系阶段：${detail.stage}`,
    detail.as_of_chapter && `截至第 ${detail.as_of_chapter} 章`,
    detail.notes,
  ].filter(Boolean).join('　');
};

const cards = [
  ...characters.map(item => ({
    id: id(),
    type: '角色卡',
    title: item.data.name ?? item.file.replace(/\.json$/, ''),
    content: toMarkdown(item.data),
    currentState: currentStateFor(item.data.id ?? ''),
    createdAt: now,
    updatedAt: now,
  })),
  ...(readJSON('story_data/bible/world/locations.json')?.locations ?? []).map(location => ({
    id: id(),
    type: '地点卡',
    title: location.name ?? location.id ?? '未命名地点',
    content: toMarkdown(location),
    currentState: location.volume_range ?? '',
    createdAt: now,
    updatedAt: now,
  })),
];

const project = {
  id: Date.now(),
  title: bookTitle,
  genre: '男频',
  subgenre: '都市日常',
  tags: { 主分类: ['都市日常'], 主题: [], 角色: [], 情节: [] },
  protagonist1,
  protagonist2,
  synopsis,
  status: 'writing',
  chapters,
  outline: [],
  outlines,
  cards,
  memories: [],
  memoryDocuments: [],
  graphNodes: [],
  graphEdges: [],
  createdAt: now,
  updatedAt: now,
  wordCount: chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
  chapterTargetWords: 2500,
};

const styleContent = [read('NOVEL_STYLE_AND_CRAFT_GUIDE.md'), read('.agents/rules/novel-craft-standard.md')]
  .filter(text => text.trim())
  .join('\n\n---\n\n');
const styles = styleContent.trim() ? [{
  id: `style-${project.id}`,
  name: `${bookTitle} 文风规范`,
  description: '从原工作目录的写作规范与反 AI 味宪章导入',
  tags: ['反AI味', '白描', '生活流'],
  content: styleContent,
  createdAt: now,
  updatedAt: now,
}] : [];

console.log(`来源：${sourceRoot}`);
console.log(`书名：${project.title}`);
console.log(`主角：${protagonist1 || '(未识别)'}${protagonist2 ? ` / ${protagonist2}` : ''}`);
console.log(`章节：${chapters.length} 章，共 ${project.wordCount.toLocaleString()} 字`);
console.log(`大纲：${outlines.length} 篇 —— ${outlines.map(item => `${item.kind}·${item.title}`).join('、')}`);
console.log(`卡片：${cards.filter(card => card.type === '角色卡').length} 张角色卡、${cards.filter(card => card.type === '地点卡').length} 张地点卡`);
console.log(`文风：${styles.length ? styles[0].name : '无'}`);

if (dryRun) {
  console.log('\n--dry-run：未写入任何文件。');
  process.exit(0);
}

const projectsDirectory = join(appDataRoot, 'projects');
if (existsSync(projectsDirectory) && readdirSync(projectsDirectory).length) {
  console.error(`\n中止：${projectsDirectory} 已有小说目录，直接写 projects.json 不会被应用读取。`);
  console.error('请先在应用里备份或删除现有小说，或改用 --app-data 指向空目录。');
  process.exit(1);
}
mkdirSync(appDataRoot, { recursive: true });
writeFileSync(join(appDataRoot, 'projects.json'), JSON.stringify([project], null, 2), 'utf8');
console.log(`\n已写入 ${join(appDataRoot, 'projects.json')}`);
if (styles.length) {
  const stylesDirectory = join(appDataRoot, 'styles');
  mkdirSync(stylesDirectory, { recursive: true });
  writeFileSync(join(stylesDirectory, 'metadata.json'), JSON.stringify(styles, null, 2), 'utf8');
  console.log(`已写入 ${join(stylesDirectory, 'metadata.json')}`);
}
console.log('下次启动应用即可看到这本书；应用首次自动保存时会把它拆分成正式的目录结构。');
