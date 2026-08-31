import { panes, type PaneAxis, type PaneName } from './panes';
import type { PaneController } from './use-pane-sizes';

interface PaneResizerProps {
  name: PaneName;
  axis: PaneAxis;
  label: string;
  /** 手柄在被调整区域的前侧时传 true，例如右侧抽屉的左边缘 */
  invert?: boolean;
  /** max-height 这类实际渲染值可能小于设定值，拖动起点要用实测值才跟手 */
  measured?: () => number | undefined;
  controller: PaneController;
}

export function PaneResizer({ name, axis, label, invert, measured, controller }: PaneResizerProps) {
  return (
    <div
      className={axis === 'x' ? 'pane-resizer-x' : 'pane-resizer-y'}
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={controller.sizes[name]}
      aria-valuemin={panes[name].min}
      aria-valuemax={panes[name].max}
      tabIndex={0}
      title={label}
      onPointerDown={event => controller.beginResize(event, name, axis, { measured: measured?.(), invert })}
      onKeyDown={event => controller.nudge(event, name, axis, invert)}
      onDoubleClick={() => controller.resize(name, panes[name].fallback)}
    />
  );
}
