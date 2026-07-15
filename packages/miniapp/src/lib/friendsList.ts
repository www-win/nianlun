import type { Friend } from '@nianlun/core'

export type FriendSortKey = 'msgCount' | 'lastContact'

/**
 * 好友列表的过滤 + 排序（纯函数，便于单测；组件里只负责绑定与分页 slice）。
 * - kw 先 trim；为空则不过滤。命中规则：name 或 alias 包含关键字。
 * - 按 sortKey 降序（消息数 / 最近联系）。
 * - 不修改传入数组（先 filter 产生新数组再 sort）。
 */
export function filterSortFriends(friends: Friend[], kw: string, sortKey: FriendSortKey): Friend[] {
  const q = kw.trim()
  return friends
    .filter((f) => !q || f.name.includes(q) || (f.alias || '').includes(q))
    .sort((a, b) => (b[sortKey] as number) - (a[sortKey] as number))
}
