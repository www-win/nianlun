export interface ProgressBarProps {
  percent?: number
  indeterminate?: boolean
  label?: string
}

export interface ProgressBarView {
  mode: 'determinate' | 'indeterminate' | 'empty'
  /** 0–100，仅 determinate 时有意义（indeterminate 的 40% 由 CSS 控制）。 */
  width: number
  showLabel: boolean
}

/** 由 props 推导进度条展示状态。percent 优先于 indeterminate。 */
export function resolveProgress(props: ProgressBarProps): ProgressBarView {
  const showLabel = !!props.label
  if (typeof props.percent === 'number') {
    const width = Math.max(0, Math.min(100, props.percent))
    return { mode: 'determinate', width, showLabel }
  }
  if (props.indeterminate) {
    return { mode: 'indeterminate', width: 40, showLabel }
  }
  return { mode: 'empty', width: 0, showLabel }
}

/**
 * 模拟进度推进一步：向 cap 指数逼近（开头快、临近 cap 越来越慢），返回不超过 cap 的新值。
 * 用于无法报告真实进度的耗时操作（如深度关系分析的并行 AI 调用）——先平滑爬到 cap，
 * 完成时再由调用方补到 100。
 */
export function stepProgress(current: number, cap = 90, k = 0.03): number {
  const next = current + (cap - current) * k
  return Math.min(cap, next)
}
