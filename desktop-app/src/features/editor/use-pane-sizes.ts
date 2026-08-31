import { useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { readAllPanes, writePane, type PaneAxis, type PaneName } from './panes';

/**
 * 分栏尺寸状态与拖动逻辑。
 * 拖动用 pointer capture，指针移出手柄后仍能收到事件，松手自动解绑；
 * 方向键也能调，键盘用户不至于被挡在外面。
 */
export function usePaneSizes() {
  const [sizes, setSizes] = useState(readAllPanes);

  const resize = (name: PaneName, value: number) => {
    setSizes(current => ({ ...current, [name]: writePane(name, value) }));
  };

  /** `measured` 传实际渲染尺寸，用于 max-height 这类实际值可能小于设定值的场合 */
  const beginResize = (
    event: ReactPointerEvent<HTMLDivElement>,
    name: PaneName,
    axis: PaneAxis,
    options: { measured?: number; invert?: boolean } = {},
  ) => {
    event.preventDefault();
    const handle = event.currentTarget;
    const origin = axis === 'x' ? event.clientX : event.clientY;
    const from = options.measured || sizes[name];
    const sign = options.invert ? -1 : 1;
    handle.setPointerCapture(event.pointerId);
    const move = (pointer: PointerEvent) => {
      const delta = (axis === 'x' ? pointer.clientX : pointer.clientY) - origin;
      resize(name, from + delta * sign);
    };
    const finish = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  };

  const nudge = (event: ReactKeyboardEvent, name: PaneName, axis: PaneAxis, invert = false) => {
    const keys = axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    const index = keys.indexOf(event.key);
    if (index < 0) return;
    event.preventDefault();
    resize(name, sizes[name] + (index === 0 ? -16 : 16) * (invert ? -1 : 1));
  };

  return { sizes, resize, beginResize, nudge };
}

export type PaneController = ReturnType<typeof usePaneSizes>;
