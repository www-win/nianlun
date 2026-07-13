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
