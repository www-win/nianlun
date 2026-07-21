# aiProxy 双账号 API key 故障转移

日期：2026-07-21
状态：设计已确认，待实现

## 问题

gaccode 账号经常欠费。一旦欠费，`aiProxy` 云函数的所有 AI 调用全部失败，好友分析、深度关系分析、聊天问答一起停摆，只能等人工充值。

用户手上有两个 gaccode 账号，希望主账号欠费时自动改用备用账号。

## 目标与非目标

**目标**：主账号返回欠费/密钥失效时，同一次云函数调用内自动改用备用账号重试一次，用户无感知。

**非目标**：
- 不做负载均衡/额度均摊（两个账号交替用会让它们几乎同时欠费，反而更糟）。
- 不做欠费状态的持久化记录。云函数保持无状态，主账号一旦充值即自动恢复。
- 不做两个以上账号的通用池化。当前只有两个账号，按需再扩。

## 背景：此前的回退

提交 `0b32256` 实现过同一功能，两个提交后被 `73355b2` 回退，回退说明未记录原因，用户也已记不清。

本设计沿用其骨架（`runWithKey` / 顺序遍历 / 共享预算），但**收紧了欠费判定**：那一版除状态码外还用宽松正则匹配响应体关键字
（`/insufficient|balance|quota|credit|billing|payment|expired|欠费|余额|额度|未充值|已过期|无可用|配额/i`），
容易把正常错误误判成欠费、白白烧掉备用账号一次请求。本版只认状态码。

## 设计

### 配置

云开发控制台新增环境变量 `GACCODE_API_KEY2`（可选）。不配置时行为与当前单 key 完全一致。

`GACCODE_BASE_URL`、`GACCODE_MODEL` 两个账号共用，不变 —— 两个 gaccode 账号走同一个端点，只是 key 不同。

### 欠费判定

新增纯函数 `isBillingError(status)`，只认 HTTP 状态码：

| 状态码 | 判定 | 理由 |
|---|---|---|
| 402 | 切 key | 实测的 gaccode 欠费码 |
| 401 | 切 key | 密钥失效（被删/重置），重试同一 key 必然继续失败 |
| 403 | **不切** | 可能是内容策略或权限问题，换 key 同样失败，只会浪费备用账号 |
| 429 / 5xx | 不切 | 已由现有 `isTransientStatus` 走退避重试 |
| 2xx | 不切 | 成功 |

不匹配响应体文本。

### 结构

把 [`index.js`](../../../packages/miniapp/cloudfunctions/aiProxy/index.js) 现有的重试循环（`exports.main` 内的 `while (true)`）原样抽成函数：

```
runWithKey(apiKey, keyLabel, base, usedModel, payload, t0) → 三选一
  { text }                  成功
  { billing: true, error }  该 key 欠费/失效，外层应换下一个
  { error }                 确定性失败或预算耗尽，外层直接返回
```

抽取过程不改动重试、退避、超时、SSE 解析的任何现有行为。

`exports.main` 顺序遍历 `[GACCODE_API_KEY, GACCODE_API_KEY2].filter(Boolean)`：

- 拿到 `{text}` → 立即返回。
- 拿到 `{billing:true}` 且还有下一个 key 且剩余预算 > `MIN_RETRY_BUDGET` → 换下一个。
- 其它情况 → 如实返回错误，不消耗备用 key。
- 一个 key 都没配 → 返回 `{ error: '未配置 GACCODE_API_KEY' }`。

### 预算

两个 key 共享同一个 `t0` 与 `TOTAL_BUDGET`（58s）。这是安全的：402/401 是秒回，切换时备用 key 仍有 57s 以上可用。切换前检查剩余预算是否仍大于 `MIN_RETRY_BUDGET`（6s），不足则不切、如实报错。

### 日志

失败与切换日志带 `key#1` / `key#2` 标识，便于在云控制台定位是哪个账号挂了。**绝不打印 key 值本身。**

## 测试

在 `cloudfunctions/aiProxy/index.test.mjs` 中：

1. `isBillingError`：402 → true，401 → true；403 / 429 / 500 / 200 → false。
2. key1 返回 402 → 自动用 key2 成功，最终返回 key2 的文本。
3. key1 返回 403 → 不切换，直接返回错误（备用 key 未被调用）。
4. 只配置了 `GACCODE_API_KEY` 时行为与现状一致（无 KEY2 时不报错、不额外请求）。
5. 两个 key 都欠费 → 返回最后一个错误。

## 部署提醒

云函数改完需在微信开发者工具中重新上传部署，并在云开发控制台配置 `GACCODE_API_KEY2`，否则代码上线了也仍是单 key 行为。
