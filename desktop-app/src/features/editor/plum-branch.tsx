// 梅枝装饰：一根硬折的老枝配几朵疏落的五瓣梅，纯 SVG 绘制。
// 枝条取 --branch-ink，花瓣取 --plum-ink，浓度由主题变量控制，
// 所以书页与墨夜两套主题下都自动合适，不需要两套图片。
// 几何来自 PIL 预览逐版调过：枝条三段硬折而不是圆弧，花小而不重叠，
// 花蕊短，否则在小尺寸下会糊成一团红点。
// 纯装饰，aria-hidden 让读屏软件跳过。

interface PlumBranchProps {
  /** sm 用于侧栏页脚，lg 用于空状态和启动页 */
  size?: 'sm' | 'md' | 'lg';
  /** 水平翻转，避免同一页面里两处装饰完全一样 */
  flip?: boolean;
}

/** 主枝与分枝：起点、两个控制点、终点、线宽 */
const branches: Array<[string, number]> = [
  ['M186 150C176 141 166 134 150 122', 3.6],
  ['M150 122C140 116 130 112 116 104', 3],
  ['M116 104C104 96 96 86 84 74', 2.4],
  ['M84 74C74 70 64 68 50 64', 1.9],
  ['M50 64C40 58 32 50 20 38', 1.4],
  ['M116 104C124 92 128 82 126 60', 1.7],
  ['M126 60C125 55 124 52 122 48', 1.1],
  ['M84 74C88 62 92 54 94 44', 1.3],
  ['M50 64C44 70 39 76 34 82', 1],
];

/** 花开在枝梢与分叉，靠近老枝的那朵最小 */
const blossoms: Array<[number, number, number]> = [
  [122, 44, 8.4],
  [94, 39, 7],
  [18, 33, 8.8],
  [33, 85, 5.8],
  [167, 121, 5.4],
];

/** 一朵五瓣梅：五片花瓣绕心均分，中心一点花房，三根短蕊 */
function Blossom({ x, y, r }: { x: number; y: number; r: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {[0, 72, 144, 216, 288].map(angle => (
        <ellipse
          key={angle}
          className="petal"
          cx={0}
          cy={-r * 0.7}
          rx={r * 0.38}
          ry={r * 0.5}
          transform={`rotate(${angle})`}
        />
      ))}
      {[-22, 0, 22].map(angle => (
        <line key={angle} className="stamen" x1={0} y1={0} x2={0} y2={-r * 0.66} transform={`rotate(${angle})`} />
      ))}
      <circle className="pistil" cx={0} cy={0} r={r * 0.17} />
    </g>
  );
}

export function PlumBranch({ size = 'md', flip = false }: PlumBranchProps) {
  return (
    <div className={`plum-branch ${size}`} aria-hidden="true">
      <svg viewBox="0 0 190 150" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
        {branches.map(([d, width]) => <path key={d} className="branch" strokeWidth={width} d={d} />)}
        {blossoms.map(([x, y, r]) => <Blossom key={`${x}-${y}`} x={x} y={y} r={r} />)}
      </svg>
    </div>
  );
}
