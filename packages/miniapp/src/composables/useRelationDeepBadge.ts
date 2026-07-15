import { watch, ref } from 'vue'
import { onShow, onHide } from '@dcloudio/uni-app'
import { useRelationDeepStore } from '../stores/relationDeep'

// 「好友」tab 在 pages.json tabBar.list 里的下标（导入0/概览1/好友2/二级市场3/报告4）。
const FRIENDS_TAB_INDEX = 2

/**
 * 让「好友」tab 红点跟随深度分析运行态（rd.busy）。在每个 tab 页的 setup 里调用一次。
 *
 * 关键约束：微信的 showTabBarRedDot/hideTabBarRedDot **只能在「当前页是 tab 页」时调用**，
 * 否则 fail「not TabBar page」。深度分析从非 tab 页（relation-deep）发起，因此不能在 store 里
 * 直接操作 tabBar——改由各 tab 页在自己前台可见时同步红点：此刻当前页必是 tab 页，调用才生效。
 * 红点绘在 tabBar 上，任一 tab 页可见，故任意 tab 页设置都能被看到。
 */
export function useRelationDeepBadge() {
  const rd = useRelationDeepStore()
  const visible = ref(false)

  function apply() {
    if (!visible.value) return   // 仅本 tab 页前台时操作 tabBar，规避 not TabBar page
    try {
      if (rd.busy) uni.showTabBarRedDot({ index: FRIENDS_TAB_INDEX })
      else uni.hideTabBarRedDot({ index: FRIENDS_TAB_INDEX })
    } catch { /* 兜底：极端时机的同步抛错不影响页面 */ }
  }

  onShow(() => { visible.value = true; apply() })
  onHide(() => { visible.value = false })
  // 分析在本 tab 页可见期间结束/开始时，实时同步红点。
  watch(() => rd.busy, apply)
}
