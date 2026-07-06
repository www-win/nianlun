import { isServiceSession, sessionIdFromFileName } from '@nianlun/core'

const WARN_MB = 50
const WARN_COUNT = 50

/** 评估本次导入体量：只统计会被留存的有效会话文件（跳过公众号/系统会话）。 */
export function assessImportSize(
  files: { name: string; content: string }[],
): { warn: boolean; sizeMB: number; count: number } {
  const effective = files.filter((f) => !isServiceSession(sessionIdFromFileName(f.name)))
  const bytes = effective.reduce((s, f) => s + f.content.length, 0)
  const sizeMB = bytes / (1024 * 1024)
  return { warn: sizeMB > WARN_MB || effective.length > WARN_COUNT, sizeMB, count: effective.length }
}
