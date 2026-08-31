// 编辑器侧栏尺寸：宽度和标签区高度由拖动手柄写入，读回时统一夹到可用区间，
// 避免 localStorage 里残留的旧值或脏值把侧栏拖成 0 宽或撑满整屏。
export const sidebarWidthKey = 'editor-sidebar-width';
export const sidebarTabsHeightKey = 'editor-sidebar-tabs-height';

export const defaultSidebarWidth = 280;
export const defaultSidebarTabsHeight = 232;

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function clampSidebarWidth(value: number): number {
  return clamp(value, 180, 560, defaultSidebarWidth);
}

export function clampSidebarTabsHeight(value: number): number {
  return clamp(value, 84, 520, defaultSidebarTabsHeight);
}
