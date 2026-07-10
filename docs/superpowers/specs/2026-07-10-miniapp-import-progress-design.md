# 导入进度条（全流程三阶段）设计

日期：2026-07-10
范围：`@nianlun/miniapp` 导入页

## 背景与问题

导入页 [import.vue](../../../packages/miniapp/src/pages/import/import.vue) 已有一个进度条，但它只覆盖导入过程的**中间一段**，且这段的百分比在真机上**基本不会动**。完整导入是三阶段：

1. **读取/解压**（`fileReader.pickAndRead`）：选文件后读取，zip 用 fflate `unzipSync` 在内存里同步解压。这段**无任何反馈**，大 zip 时界面像"卡住"（代码里留有"选完文件没反应"的注释痕迹）。
2. **逐文件解析**（`parseLocal` 的 `forEach`）：当前绑定了进度条，但循环是**纯同步、中间不 await**，`progress` 的中间值渲染不出来，实际是 `0 →(阻塞)→ 100` 一跳。
3. **聚合/建报告/抽样本**（`aggregate`/`buildReport`/`extractFriendSamples`/`computeRecentInsights`）：进度条走到 100% 后卡在这里，大数据量时这步最耗时，**无反馈**。

目标：让导入**全程**都有可见、诚实的进度反馈，消除"卡住感"。

## 关键约束：小程序双线程

小程序是**逻辑线程 / 渲染线程**双线程架构，由此有两条设计依据：

- **同步阻塞阶段拿不到真百分比**：解压与聚合都是**一次性同步调用**，中途没有可插入的进度点，硬凑百分比是假的。
- **CSS 动画跑在渲染线程**：即使逻辑线程正忙于解压/聚合，一个"不确定态"的动画进度条**仍会持续滑动**——这正是"卡住感"的解药。
- **要让解析出现真百分比，循环必须让渡渲染线程**：`progress.value` 在同步紧循环里反复赋值会被 Vue 合并成一次渲染（发生在整个循环+聚合都结束后）。必须每 N 个文件 `await` 一个宏任务（`setTimeout(0)`），中间值才能被 `setData` 刷出来。

## 阶段模型

引入显式阶段状态 `phase`：`idle → reading → parsing → aggregating → idle`。

| 阶段 | 触发位置 | 进度条形态 | 文案 |
|---|---|---|---|
| ① reading | 页面 `onImport` 里 `pickAndRead` 之前 | 不确定态动画条 | 正在读取文件…（解压中） |
| ② parsing | `parseLocal` 解析循环内 | 确定态百分比（真的逐格走） | 正在解析… x% |
| ③ aggregating | `parseLocal` 尾段（聚合前） | 不确定态动画条 | 正在生成报告… |

`status`（`idle|parsing|done|error`）语义不变，仍用于门控进度块显隐与 done/error 展示；`phase` 是 `status==='parsing'` 期间的子阶段细分。

## 改动分布

### `adapters/parseLocal.ts`

- `parseLocal` 改为 **async**，返回 `Promise<ParseOutcome>`。
- 进度回调升级为携带阶段：
  ```ts
  export type ParsePhase = 'parsing' | 'aggregating'
  export interface ParseProgress { phase: ParsePhase; done: number; total: number }
  parseLocal(files, year, onProgress?: (p: ParseProgress) => void): Promise<ParseOutcome>
  ```
- 解析循环：每约 `YIELD_EVERY = 20` 个文件 `await tick()`（`tick = () => new Promise(r => setTimeout(r, 0))`）让渲染线程刷新，并在每个文件后调 `onProgress({ phase:'parsing', done:i+1, total })`。
- 聚合前：先 `onProgress({ phase:'aggregating', done:0, total:1 })`，再 `await tick()`（让"生成报告"文案与不确定态条先渲染出来），然后再跑同步聚合。
- 纯逻辑不变（解析/聚合/样本口径均不改），仅新增 yield 与阶段回调。

### `stores/import.ts`

- 新增 `phase = ref<ImportPhase>('idle')`，`ImportPhase = 'idle'|'reading'|'parsing'|'aggregating'`。
- 新增 `beginReading()`：置 `status='parsing'`、`phase='reading'`、`progress=0`，清空 `warnings`/`error`。供页面在 `pickAndRead` 之前调用，让①阶段可见。
- `run()`：把 `await parseLocal(chatFiles, year, cb)` 的回调映射到 `phase`/`progress`（parsing 段 `progress = done/total`；aggregating 段置 `phase='aggregating'`）。成功完成后 `phase='idle'`。
- `reset()`：一并复位 `phase='idle'`。
- 异常路径（catch）：`phase='idle'`（与 `status='error'` 一致）。

### `pages/import/import.vue`

- `onImport`：进入即 `imp.beginReading()`；`pickAndRead` 返回空（用户取消）或抛异常时 `imp.reset()` 复位，避免进度块滞留。
- 进度块（原 `v-if="imp.status === 'parsing'"`）内：
  - **三步指示器**：`① 读取 · ② 解析 · ③ 生成报告`，按 `phase` 高亮当前步、已过步置灰勾。
  - **进度条**：`phase==='parsing'` → 确定态（`width = pct%`）；`reading`/`aggregating` → 不确定态动画条。
  - **文案**：按 `phase` 切换（见阶段模型表）。
- CSS：新增不确定态动画 `@keyframes`（一段高亮块来回滑动），沿用 `--accent` 配色与现有圆角/尺寸风格。

## 数据流

```
onImport()
  imp.beginReading()            // status=parsing, phase=reading  → ① 动画条
  files = pickAndRead(500)      // 同步解压期间 ① 动画条持续滑动
  (取消/异常 → imp.reset())
  assessImportSize + 可选 modal
  imp.run(files, year)
    await parseLocal(cb)
      循环: cb({phase:parsing,done,total}) 每 20 文件 await tick()  → ② 真百分比
      cb({phase:aggregating}) + await tick()                       → ③ 动画条
      同步聚合/建报告/抽样本
    phase=idle; status=done
```

## 测试（TDD）

- `adapters/__tests__/parseLocal.test.ts`
  - 全部 `parseLocal(...)` 调用改为 `await parseLocal(...)`（现同步断言随之改 async）。
  - `progress 回调随文件推进`：改断言回调收到 `{ phase:'parsing', done:1, total:1 }`，且回调序列中出现 `{ phase:'aggregating', ... }`（parsing 在前、aggregating 在后）。
- `stores/__tests__/import.test.ts`
  - 现有 `run` 测试因 `run` 仍是 async 保持通过（仅内部改为 `await parseLocal`）。
  - 新增：`beginReading()` 置 `status='parsing'`、`phase='reading'`、清空 warnings/error。
  - 新增：`run` 正常完成后 `phase === 'idle'`、`status === 'done'`。
  - 新增：`reset()` 后 `phase === 'idle'`。

## 非目标 / YAGNI

- 不给单次 `unzipSync`/`aggregate` 内部做子进度（切不开，且改 core 代价大、收益低）——用不确定态动画条覆盖。
- 不引入取消按钮、不改导入的合并/统计口径。
- 不改 `run` 的对外签名与既有 done/error 行为。
