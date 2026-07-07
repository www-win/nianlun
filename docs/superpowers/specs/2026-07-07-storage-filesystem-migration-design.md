# 设计：小程序大数据存储从 Storage 迁到文件系统（根治几千好友导入超限）

- 日期：2026-07-07
- 范围：`packages/miniapp`（`adapters/storage.ts` 为主）
- 目标读者：本仓库开发者
- 状态：待实现

## 一、背景与目标

最终客户微信好友**好几千个**。真机导入时报错并中断：

```
导入失败：setStorageSync:fail:entry size limit reached
```

**根因**：小程序 Storage 有两道硬限制 —— **单键 ≤ 1MB**、**整体 ≤ 10MB**。当前所有聚合数据都用 `wx.setStorageSync` 存**单键**（见 `storage.ts`）。几千好友时：

| 数据 | 估算（几千好友） |
|---|---|
| `nianlun:friends`（每人含 `weekHour[168]`/`hourly[24]`/`monthly[12]`/`keywords[20]`/emotion，~1.5KB） | ~5–8 MB |
| `nianlun:samples`（每人 ≤30 条样本） | ~2–5 MB |
| `nianlun:recentInsights` / `nianlun:recentSamples` | 各数 MB |
| **合计** | **远超 10MB** |

导入 `run()` 里最先执行的 `saveFriends`（经 `data.setData`）一写单键就撞 1MB 上限、抛错、导入中断。**分块只能绕过单键 1MB，绕不过 10MB 总量**，故不可行。

**目标**：把随好友数增长的大数据**搬到文件系统**（`wx.getFileSystemManager`，配额约 200MB，无 1MB/10MB 限制），根治导入超限。对外接口与 UI 行为不变。

## 二、非目标

- **不迁移旧数据**：老用户 Storage 里的数据不自动搬家；启动时清掉旧大 key 回收配额，用户**重新导入一次**即可。
- **不改 UI、不改数据模型、不改解析/抽取逻辑**。
- **不碰解压**：`unzip:fail the maximum size` 已由 `fileReader.ts` 的 `fflate` 内存解压根治，与本次无关。
- 不做按好友分片的增量写（YAGNI，见 4.3）。

## 三、存储分层

| 层 | 存介质 | 数据 | 理由 |
|---|---|---|---|
| **大数据** | **文件系统**（JSON 文件） | `friends`、`samples`、`recentInsights`、`recentSamples`、`stocks` | 随好友数线性增长，几千好友数 MB～十几 MB |
| **小元数据** | **Storage**（不变） | `report`、`analyzedIds`、`myBazi`、`births`、`astro` | 固定或小量：`analyzedIds` 几千 id ~几十 KB；`astro` 命理逐个手动生成、量可控 |

> `analyzedIds`/`astro` 留 Storage；若将来命理给大量好友生成致 `astro` 变大，可按同一模式追加搬迁（本次不做）。

## 四、设计

### 4.1 文件系统 JSON 后端（新增，`adapters/fsStore.ts`）

复用 `rawStore.ts` 已有的 `RawFsBackend` 抽象（`ensureDir/writeFile/readFile/readdir/size/unlink`）。新增一个「JSON 键值」薄封装：

```ts
export interface FsJsonBackend {
  /** 读回并 JSON.parse；文件不存在或解析失败返回 undefined（容错，永不抛）。 */
  read(name: string): unknown
  /** JSON.stringify 后覆盖写入（先 ensureDir）。 */
  write(name: string, data: unknown): void
  /** 删除单个文件（不存在忽略）。 */
  remove(name: string): void
}

/** 用 RawFsBackend + baseDir 造 FsJsonBackend；每个 name 一个 `${baseDir}/${name}.json` 文件。 */
export function makeFsJson(fs: RawFsBackend, baseDir: string): FsJsonBackend
```

- 目录：`${wx.env.USER_DATA_PATH}/nianlun_store`。
- 全部**同步**（`writeFileSync`/`readFileSync`，与 `rawStore` 一致）；几 MB 一次读写可接受。
- 容错：`read` 遇文件不存在 / 非法 JSON → `undefined`，绝不抛。

### 4.2 `makeStorage` 双后端

```ts
export function makeStorage(kv: StorageBackend, fs: FsJsonBackend) { ... }
```

- 小元数据方法（`saveReport/loadReport`、`saveAnalyzedIds/loadAnalyzedIds`、`saveMyBazi/loadMyBazi`、`saveBirths/loadBirths`、`saveAstroReading/loadAstroReading`）**保持不变**，仍走 `kv`。
- 大数据方法改走 `fs`（见 4.3）。
- **对外方法名与签名全部不变** → `data.ts`/`import.ts`/页面**零改动**。

### 4.3 大数据方法改走文件系统（键 → 文件名）

| 方法 | 文件 | 读回容错默认 |
|---|---|---|
| `saveFriends(friends)` / `loadFriends()` | `friends.json` | `[]`（并保留现有「补默认 hourly/weekHour/keywords」逻辑） |
| `saveSamples(m)` / `loadSamples()` | `samples.json` | `{}` |
| `saveRecentInsights(m)` / `loadRecentInsights()` | `recentInsights.json` | `{}` |
| `saveRecentSamples(m)` / `loadRecentSamples()` | `recentSamples.json` | `{}` |
| `saveStockPicks(picks)` / `loadStockPicks()` / `clearStockPicks()` | `stocks.json` | `[]` |

- 每类**整文件读写**（不分片）：`loadFriends` = `fs.read('friends')`；`saveFriends` = `fs.write('friends', friends)`。整体几 MB，文件系统无 1MB 限制、同步读写可接受；增量导入本就重算全量后整体写。
- 读回后的类型兜底（如 `loadFriends` 的 `Array.isArray` + 补字段、`loadSamples` 的 `Record` 判定）沿用现有实现。

### 4.4 真机实例接线

```ts
// storage.ts 末尾
const wxKv: StorageBackend = { /* 现有 wxBackend 不变 */ }
// 懒加载 wx 文件系统（模块顶层不碰 wx，避免 node 测试收集期 ReferenceError；与 rawStore 一致）
function wxFsJson(): FsJsonBackend { /* makeFsJson(wxRawFs, `${wx.env.USER_DATA_PATH}/nianlun_store`) 懒单例 */ }
export const storage = makeStorage(wxKv, /* 懒代理到 wxFsJson() 的 FsJsonBackend */)
```

- `wxRawFs` 复用 `rawStore.ts` 里真机 `RawFsBackend` 实现（若需要，将其提取为可共享导出）。
- 懒加载：方法调用时才访问 `wx`，模块加载本身不触碰。

### 4.5 启动清理旧大 key（`App.vue` onLaunch）

不迁移，故旧 Storage 大 key 是死数据、且占着配额。新增 `storage.purgeLegacyBigKeys()`：删除 `nianlun:friends`、`nianlun:samples`、`nianlun:recentInsights`、`nianlun:recentSamples`、`nianlun:stocks` 这些**旧 KV 键**（现在数据改存文件，这些键不再写）。在 `onLaunch` 里 `purgeLegacyRaw()` 附近调用一次。

### 4.6 `clearAll` 与容错

- `clearAll()`：清小 KV 键（不变）+ 删全部大数据文件（`fs.remove('friends'/'samples'/...)`）。
- 文件系统写失败（极少，配额大）：`saveFriends` 等**不吞错**——让导入 `run()` 的既有 `try/catch` 捕获并显示。但因文件系统配额远大于 Storage，几千好友不会触发。

## 五、数据流（接口不变）

```
导入 run() → data.setData(friends) → storage.saveFriends(friends) → fs.write('friends', …) → friends.json
启动 hydrate() → storage.loadFriends() → fs.read('friends') → friends.json → Friend[]
```

`data.ts`/`import.ts`/页面调用方**完全不变**，只是 `saveFriends`/`loadFriends` 内部从「KV 单键」变「JSON 文件」。

## 六、测试（Vitest）

内存版后端：`memKv`（现有）+ `memFsJson`（Map 模拟：`write` 存对象、`read` 深拷贝返回、`remove` 删除）。

1. **`fsStore.ts`**：`makeFsJson` 往返；`read` 不存在 → `undefined`；`read` 坏 JSON → `undefined`；`remove`。
2. **`storage.ts`（大数据走 fs）**：`saveFriends/loadFriends` 经 `memFsJson` 往返；`loadFriends` 补默认字段；无文件 → `[]`；`saveSamples/loadSamples`、`recentInsights/recentSamples`、`stocks` 同理；`clearAll` 后大数据全空。
3. **小元数据仍走 kv**：`saveReport/loadReport`、`saveAnalyzedIds` 等仍在 `memKv`（断言写入落在 kv 而非 fs）。
4. **`purgeLegacyBigKeys`**：预置旧 KV 大键 → 调用后被删、其它键保留。
5. **既有 `data.test.ts`/`import.test.ts`**：更新 `makeStorage` 调用为双后端（注入 `memFsJson`），断言导入后 `loadFriends()` 能读回（几千好友规模用小样例代表，逻辑等价）。

## 七、风险与回滚

- **启动读大文件耗时**：`hydrate` 同步读 `friends.json`（几 MB）。可接受（一次性、启动时）；若真机偏慢，后续可改异步/惰性，本次不做。
- **回滚**：改动集中在 `storage.ts`（内部实现）+ 新增 `fsStore.ts` + `App.vue` 一行清理。回滚即恢复 `storage.ts` 走 KV；文件系统里的 `nianlun_store` 可由 `clearAll` 清理。
- **旧用户**：重新导入一次即可（非目标已声明）。

## 八、交付顺序（TDD）

1. `fsStore.ts`：`FsJsonBackend` + `makeFsJson`（先测后实现）。
2. `storage.ts`：`makeStorage` 双后端、大数据方法改走 fs、`clearAll` 清文件、`purgeLegacyBigKeys`（改测试 → 实现）。
3. 真机实例接线（`wxFsJson` 懒加载 + 提取共享 `wxRawFs`）。
4. 更新 `data.test.ts`/`import.test.ts` 的 `makeStorage` 注入。
5. `App.vue` onLaunch 调 `purgeLegacyBigKeys`。
6. `pnpm --filter @nianlun/miniapp test` 全绿 → `build:mp-weixin` → 真机验收（几千好友导入不报超限、重启仍在）。
