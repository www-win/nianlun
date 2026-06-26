import type { Relation } from '@nianlun/core'

export const RELATIONS: Relation[] = ['家人', '挚友', '同事', '同学', '客户', '其他']

export const REL_COLORS: Record<string, string> = {
  '家人': 'oklch(60% 0.12 25)',
  '挚友': 'oklch(62% 0.12 145)',
  '同事': 'oklch(58% 0.1 250)',
  '同学': 'oklch(66% 0.13 75)',
  '客户': 'oklch(58% 0.11 320)',
  '其他': 'oklch(60% 0.02 240)',
}

export function relColor(rel: string): string {
  return REL_COLORS[rel] || 'oklch(60% 0.02 240)'
}

export function initials(name: string): string {
  return name.slice(name.length > 1 ? name.length - 2 : 0)
}
