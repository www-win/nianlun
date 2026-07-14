# 深度关系分析后台化（离开页面继续跑）设计

## 背景与问题

深度关系分析（[relation-deep.vue](../../../packages/miniapp/src/pages/relation-deep/relation-deep.vue)）由 `aiClient.analyzeRelationDeep` 串行发 3 段云函数调用完成，整体耗时几十秒。当前 `loading` / `progress` / 结果 `deep` 全部挂在**页面组件的 ref** 上，`onUnload` 会清掉进度定时器。用户在等待期间一旦 `navigateBack` 销毁本页，未跑完的结果就丢失、进度也无从恢复。

诉求：用户点「生成」后能离开本页去做别的事，回来时分析已在后台跑完并自动显示；其它页面也能看到「分析进行中」的全局提示。

## 目标与非目标

**目标**
- 深度分析的发起、进度、结果状态从页面提升到跨页面存活的全局单例，离开页面分析继续跑、跑完落盘。
- 回到 relation-deep 页自动显示结果或仍在进行的进度。
- 分析进行中时，在「好友」tab 上以红点做全局提示。

**非目标**
- 不支持「系统级后台」（小程序切后台/熄屏约 5s 后 JS 挂起、网络中断，平台限制无解）。
- 不做服务端异步任务化（发起即返回、云端跑完写库）。当前保持同步 `callFunction` 架构。
- 不改 `@nianlun/core`、不改 `aiClient`、不改云函数。纯 miniapp 层改造。

## 关键决策

- **单任务**：全局同一时刻只跑一个深度分析。正在跑时对另一好友点生成 → 拒绝并 toast「已有分析进行中，请稍候」。理由：实现简单，且不冲击 aiProxy 上游并发上限（已知偶发挂死），最贴合「离开等待再回来」的核心诉求。
- **全局提示用 tabBar 红点**：分析开始在「好友」tab（index 2，relation-deep 的下钻入口）亮红点，完成/失败清除。红点只在用户处于 tab 页时可见（非 tab 页本就不显示 tabBar），覆盖面即「其它页面」。

## 架构：新增 `stores/relationDeep.ts`

沿用 [chatQa.ts](../../../packages/miniapp/src/stores/chatQa.ts) 的工厂 + 依赖注入模式，作为跨页面存活的 Pinia 单例托管分析生命周期。

### 依赖注入

```
Deps = {
  ai?:      (friend, samples) => Promise<RelationDeep>   // 默认 aiClient.analyzeRelationDeep
  storage?: { saveRelationDeep, loadRelationDeep }        // 默认真实 storage
  tabBadge?: { show(): void; hide(): void }               // 默认包 uni.show/hideTabBarRedDot({index:2})，try/catch 兜底
  tick?:    number                                        // 进度定时器间隔，默认 400（测试可调）
}
```

抽 `ai`/`storage`/`tabBadge` 为注入依赖是为了 store 单测里用 fake，不触真 `uni`/云函数。

### State（单任务槽）

- `activeId: string | null` — 正在分析的好友 id（`null`=空闲）
- `progress: number` — 0–100，由内部 `setInterval(tick)` + 现成 `stepProgress`（[progressBarLogic.ts](../../../packages/miniapp/src/components/progressBarLogic.ts)）驱动，完成补 100
- `completion: { id: string; status: 'ok' | 'empty' | 'error'; message?: string } | null` — 最近一次完成信号，供页面反应

### Getters

- `runningFor(id: string): boolean` — `activeId === id`
- `busy: boolean` — `activeId !== null`

### Action `start(friend, samples): 'started' | 'busy'`

1. 若 `busy` → 直接返回 `'busy'`（不打断正在跑的那个）。
2. 否则：`activeId = friend.id`；`progress = 0`；`tabBadge.show()`；启进度定时器。
3. `try`：`const deep = await ai(friend, samples)`
   - 结果非空（`Object.keys(deep).length > 0`）→ `storage.saveRelationDeep(friend.id, friend, deep)`；`completion = { id, status: 'ok' }`
   - 结果为空 → 不落盘（允许重试）；`completion = { id, status: 'empty' }`
4. `catch (e)` → `completion = { id, status: 'error', message: e.message }`
5. `finally` → 停定时器；`progress = 100`；`tabBadge.hide()`；`activeId = null`

`ai` 默认实现 = 现 `aiClient.analyzeRelationDeep`（三段串行、部分失败保留、样本限 20 的逻辑原样保留在 aiClient，不搬到 store）。

导出 `export const useRelationDeepStore = createRelationDeepStore()`。

## 页面改造 [relation-deep.vue](../../../packages/miniapp/src/pages/relation-deep/relation-deep.vue)

- 删除本地 `loading` / `progress` / `progressTimer` / `startProgress` / `stopProgress` / `onUnload(stopProgress)`。
- `const rd = useRelationDeepStore()`；`loading` 改为 `computed(() => rd.runningFor(friend.value?.id ?? ''))`；进度条 `:percent` 绑 `rd.progress`。
- `generate()`：取 samples 后调 `rd.start(friend, samples)`；返回 `'busy'` 时 `uni.showToast({ title: '已有分析进行中，请稍候', icon: 'none' })`。
- `watch(() => rd.completion, (c) => { ... })`：`c` 命中当前好友 id 时——
  - `ok` → `loadCache()` 重新读盘 + `nextTick(drawSecurity)`
  - `empty` → `deep.value = { overall: 'AI 无法生成深度关系分析' }`（占位、可重试）
  - `error` → 若本页可见则 `uni.showToast({ title: c.message, icon: 'none' })`
- `onShow` 保留 `loadCache()`：从别的页面 `navigateBack` 回来时，若已跑完自动显示结果；若仍在跑，`loading`/进度条自动反映 store 状态。

## 错误处理

- `ai` 抛异常 → `completion.status='error'`，页面 toast，不落盘，可重试。
- `tabBadge.show/hide` 用 try/catch 包裹：uni tabBar API 在非预期时机可能抛错，不能影响分析主流程。
- store 是单例：即便页面销毁，`start()` 的 promise 仍在 store 闭包内继续，落盘不依赖页面存活。

## 测试

新增 `stores/__tests__/relationDeep.test.ts`（注入 fake `ai` / `storage` / `tabBadge`，`vi.useFakeTimers`）：

- `start` 设 `activeId`、亮 `tabBadge`、`runningFor` 命中。
- 正在跑时再 `start` 另一好友 → 返回 `'busy'`、不调 `ai` 第二次、不打断第一个。
- 成功：`ai` 返回非空 → `storage.saveRelationDeep` 被调、`completion.status='ok'`、`activeId` 归 `null`、`tabBadge.hide` 被调。
- 空结果：`ai` 返回 `{}` → **不** `saveRelationDeep`、`completion.status='empty'`。
- 异常：`ai` reject → `completion.status='error'` 带 message、不落盘、`tabBadge.hide` 被调。

页面逻辑改动较薄，主要靠 store 单测保障；relation-deep.vue 现无组件测试，沿用现状不新增（如需，仅补 `generate` busy 分支的轻量断言）。

## 影响面

- 新增：`stores/relationDeep.ts`、`stores/__tests__/relationDeep.test.ts`
- 修改：`pages/relation-deep/relation-deep.vue`
- 不动：core / aiClient / 云函数 / storage 接口（复用现有 `saveRelationDeep`/`loadRelationDeep`）
