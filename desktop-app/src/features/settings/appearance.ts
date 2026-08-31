// 正文外观：字体、字号、行距与纸张模式。
// 只用系统已装字体，不引入 Web Font，保持离线可用。
export type ReaderFontId = 'system' | 'serif' | 'mono' | 'kai' | 'hei' | 'custom';
/** 书页（浅）与墨夜（深），auto 跟随系统 */
export type ThemeId = 'paper' | 'ink' | 'auto';

export const themes: Array<{ id: ThemeId; label: string; hint: string }> = [
  { id: 'paper', label: '书页', hint: '书页黄与雪白底，墨色字，白天写作' },
  { id: 'ink', label: '墨夜', hint: '暖墨底色，夜里长时间写作不刺眼' },
  { id: 'auto', label: '跟随系统', hint: '按系统的浅色/深色偏好自动切换' },
];

export interface Appearance {
  themeId: ThemeId;
  fontId: ReaderFontId;
  /** fontId 为 custom 时使用，可填任意已安装字体名 */
  customFont: string;
  fontSize: number;
  lineHeight: number;
  /** 正文区改用米白纸张底色，白天写作用 */
  paperMode: boolean;
}

export const readerFonts: Array<{ id: ReaderFontId; label: string; hint: string; stack: string }> = [
  { id: 'serif', label: '书籍宋体', hint: '小说预览默认使用的衬线体，适合长时间读稿', stack: 'ui-serif, "Songti SC", "Noto Serif SC", "Source Han Serif SC", SimSun, serif' },
  { id: 'mono', label: '等宽体', hint: '大纲 / 卡片 / Agent 输入框原来的字体，字符对齐', stack: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Sarasa Mono SC", monospace' },
  { id: 'kai', label: '楷体', hint: '手写感更强，稿件味道最接近纸书', stack: '"Kaiti SC", KaiTi, STKaiti, "Noto Serif SC", serif' },
  { id: 'hei', label: '黑体', hint: '中文无衬线，笔画清晰', stack: '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif' },
  { id: 'system', label: '跟随界面', hint: '与侧栏、按钮一致的系统无衬线体', stack: '-apple-system, BlinkMacSystemFont, "Inter", "SF Pro", system-ui, sans-serif' },
  { id: 'custom', label: '自定义', hint: '填写本机已安装的字体名，例如 方正书宋', stack: '' },
];

export const appearanceStorageKey = 'writer-appearance';

export const defaultAppearance: Appearance = {
  themeId: 'paper',
  fontId: 'serif',
  customFont: '',
  fontSize: 16,
  lineHeight: 1.8,
  paperMode: false,
};

const fallbackStack = readerFonts[0].stack;

export function readerFontStack(appearance: Appearance): string {
  if (appearance.fontId === 'custom') {
    const name = appearance.customFont.trim();
    return name ? `"${name.replace(/"/gu, '')}", ${fallbackStack}` : fallbackStack;
  }
  return readerFonts.find(font => font.id === appearance.fontId)?.stack || fallbackStack;
}

export function normalizeAppearance(value: unknown): Appearance {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<Appearance>;
  const fontId = readerFonts.some(font => font.id === raw.fontId) ? raw.fontId as ReaderFontId : defaultAppearance.fontId;
  const themeId = themes.some(theme => theme.id === raw.themeId) ? raw.themeId as ThemeId : defaultAppearance.themeId;
  return {
    themeId,
    fontId,
    customFont: typeof raw.customFont === 'string' ? raw.customFont.slice(0, 60) : '',
    fontSize: clamp(Number(raw.fontSize) || defaultAppearance.fontSize, 12, 30),
    lineHeight: clamp(Number(raw.lineHeight) || defaultAppearance.lineHeight, 1.2, 2.6),
    paperMode: raw.paperMode === true,
  };
}

export function loadAppearance(): Appearance {
  try {
    return normalizeAppearance(JSON.parse(localStorage.getItem(appearanceStorageKey) || 'null'));
  } catch {
    return defaultAppearance;
  }
}

/** auto 时读系统偏好；拿不到 matchMedia 的环境按书页处理 */
export function resolvedTheme(themeId: ThemeId): 'paper' | 'ink' {
  if (themeId !== 'auto') return themeId;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'ink' : 'paper';
  } catch {
    return 'paper';
  }
}

/** 写入 :root 自定义属性与主题标记，CSS 直接读取这几个变量 */
export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement;
  root.style.setProperty('--reader-font', readerFontStack(appearance));
  root.style.setProperty('--reader-size', `${appearance.fontSize}px`);
  root.style.setProperty('--reader-line', String(appearance.lineHeight));
  // 只有墨夜需要标记，书页是 :root 的默认取值
  if (resolvedTheme(appearance.themeId) === 'ink') {
    root.setAttribute('data-theme', 'dark');
  } else {
    root.removeAttribute('data-theme');
  }
  root.style.colorScheme = resolvedTheme(appearance.themeId) === 'ink' ? 'dark' : 'light';
  document.body.classList.toggle('paper-editor', appearance.paperMode);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
