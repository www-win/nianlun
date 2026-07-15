// 环境变量（在云开发控制台配置）：GACCODE_BASE_URL、GACCODE_API_KEY、GACCODE_MODEL
// 用 Node 内置 https，不依赖全局 fetch，兼容云开发的 Node 16/18 等各版本。
const https = require('https')
const { URL } = require('url')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 单次外部请求。给 socket 设空闲超时：AI 非流式返回时连接会一直空闲直到整段生成完，
// 超过 timeoutMs 无字节就主动断开、抛清晰错误，避免函数干等到 60s 被云平台强杀（-504003）。
function postJson(urlStr, headers, bodyObj, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr)
    const body = JSON.stringify(bodyObj)
    const req = https.request(
      {
        method: 'POST',
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        // connection: close + agent: false —— 每次都新建连接，绝不复用连接池里可能已被上游
        // 悄悄关闭的 keep-alive socket。温容器（云函数复用进程）跨调用复用坏 socket 是
        // 「读到一半 ECONNRESET」的另一类诱因；强制新连接把这个变量彻底排除。
        headers: { ...headers, 'content-length': Buffer.byteLength(body), connection: 'close' },
        timeout: timeoutMs,
        agent: false,
      },
      (res) => {
        // 收集原始 Buffer，末尾整体按 UTF-8 解码一次——不能 `data += chunk`：
        // 多字节中文字若被拆在两个网络块边界上，逐块转字符串会解码坏成「�」乱码。
        const chunks = []
        res.on('data', (c) => { chunks.push(c) })
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
      },
    )
    req.on('timeout', () => { req.destroy(new Error(`AI 请求 ${timeoutMs}ms 内无响应`)) })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// 解析 Anthropic 流式 SSE 响应体：把所有 text_delta 增量拼成完整文本。
// 只认 data: 行里的 JSON，忽略 message_start/ping/content_block_start/stop 等非文本事件与 [DONE] 哨兵。
// 流内若出现 error 事件（如 overloaded_error），把其 message 收进 error 返回，交由上层判定是否重试。
function parseSseText(body) {
  let text = ''
  let error = null
  for (const line of String(body).split('\n')) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    let evt
    try { evt = JSON.parse(payload) } catch { continue }
    if (evt.type === 'content_block_delta' && evt.delta && evt.delta.type === 'text_delta') {
      text += evt.delta.text || ''
    } else if (evt.type === 'error') {
      error = (evt.error && evt.error.message) || 'AI 流式返回错误'
    }
  }
  return { text, error }
}

// 可重试的「瞬时」网络错误：上游连接重置 / 读超时 / 拒连 / 断管 / DNS 抖动，或我方读超时。
// 这些是第三方 AI 代理在限流/负载抖动时的常见表现（它不返回 429/503，而是直接掐断 TCP）。
function isTransientError(e) {
  const code = e && e.code
  if (['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'EAI_AGAIN'].includes(code)) return true
  const msg = (e && e.message) || ''
  return /socket hang up|ECONNRESET|无响应/i.test(msg)
}

// 可重试的 HTTP 状态：限流（429）与网关/服务端瞬时故障（5xx）。4xx（除 429）是确定性错误，不重试。
function isTransientStatus(s) { return s === 429 || (s >= 500 && s <= 504) }

// 第 attempt 次失败后的退避时长：0.5s 起指数增长，封顶 4s。
function backoffMs(attempt) { return Math.min(500 * 2 ** (attempt - 1), 4000) }

const TOTAL_BUDGET = 58000     // 总预算，贴近云函数 60s 硬顶，把额度让满——有些好友分析生成本就要 ~50s。
const MIN_RETRY_BUDGET = 6000  // 剩余预算不足 6s 就不再重试：退避 + 一次真实请求都跑不完，重试只会白等到被强杀。
const PER_ATTEMPT = 20000      // 单次请求的空闲超时上限：上游若「挂死」（零字节）最多等 20s 就掐断重试，
                               // 不让一根挂死连接独吞整个预算（曾见第 5 次挂 45.9s 吃光剩余、无从再试）。
                               // 有流式保命：正在生成时 chunk 持续到达、空闲计时不断重置，永远够不到 20s。

// 本次尝试的空闲超时：取 PER_ATTEMPT 与「剩余总预算」的较小值——预算将尽时别设一个比预算还大的超时。
function attemptTimeout(remaining) { return Math.min(remaining, PER_ATTEMPT) }

exports.main = async (event) => {
  const { prompt, maxTokens = 1024, model } = event || {}
  if (!prompt) return { error: '缺少 prompt' }
  const usedModel = model || process.env.GACCODE_MODEL || 'claude-opus-4-8'
  const base = (process.env.GACCODE_BASE_URL || '').replace(/\/+$/, '')
  const t0 = Date.now()
  console.log(`[aiProxy] 开始 v=stream+cap20s model=${usedModel} maxTokens=${maxTokens} promptLen=${prompt.length}`)

  const headers = {
    'x-api-key': process.env.GACCODE_API_KEY,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  }
  // stream:true —— 关键：流式下 Anthropic 会立刻先回 message_start/ping，紧接着 text_delta 持续到达。
  // postJson 的 timeout 是 socket 空闲超时，每来一个 chunk 就重置，故「正在生成」的慢请求不会被误杀；
  // 只有上游真正挂住（长时间零字节）才触发超时。这正是修「58s 无响应」误杀合法慢生成的根子。
  const payload = { model: usedModel, max_tokens: maxTokens, stream: true, messages: [{ role: 'user', content: prompt }] }

  let attempt = 0
  while (true) {
    attempt++
    // 每次尝试的空闲超时 = min(剩余总预算, PER_ATTEMPT)：秒断的 ECONNRESET 本就 1s 内失败不受影响；
    // 「挂死」连接最多等 PER_ATTEMPT 就掐断，把剩余预算让给再重试，而不是被它独吞到被云平台强杀。
    const remaining = TOTAL_BUDGET - (Date.now() - t0)
    try {
      const resp = await postJson(base + '/v1/messages', headers, payload, attemptTimeout(remaining))
      if (isTransientStatus(resp.status)) {
        // 限流/网关瞬时故障：抛出交给下面统一的重试判定。
        const err = new Error(`AI 服务瞬时 HTTP ${resp.status}：${resp.body.slice(0, 200)}`)
        err.retriable = true
        throw err
      }
      const cost = Date.now() - t0
      console.log(`[aiProxy] AI 返回 status=${resp.status} 耗时=${cost}ms model=${usedModel} 尝试=${attempt}`)
      if (resp.status < 200 || resp.status >= 300) {
        return { error: `AI 服务返回 HTTP ${resp.status}（model=${usedModel}）：${resp.body.slice(0, 200)}` }
      }
      const { text, error: sseErr } = parseSseText(resp.body)
      if (sseErr) {
        // 流内错误：过载/限流视为可重试，交给下面统一退避；其余（如安全拦截）如实返回。
        if (/overloaded|rate|429|529|503|过载|限流/i.test(sseErr)) {
          const err = new Error(`AI 流式瞬时错误：${sseErr}`)
          err.retriable = true
          throw err
        }
        return { error: `AI 流式返回错误（model=${usedModel}）：${sseErr}` }
      }
      if (text) return { text }
      // 兜底：上游若忽略 stream:true 而返回整段非流式 JSON，按老格式解析一次，避免误报「内容为空」。
      const trimmed = resp.body.trim()
      if (trimmed.startsWith('{')) {
        try {
          const data = JSON.parse(trimmed)
          const block = Array.isArray(data.content) ? data.content.find((b) => b.type === 'text') : null
          if (block && block.text) return { text: block.text }
        } catch { /* 落到下面统一的空内容错误 */ }
      }
      return { error: 'AI 返回内容为空' }
    } catch (e) {
      const retriable = e.retriable || isTransientError(e)
      const wait = backoffMs(attempt)
      const remainingNow = TOTAL_BUDGET - (Date.now() - t0)
      // 只有「可重试」且「退避后还剩得下一次真实请求」时才重试；否则如实返回错误。
      if (!retriable || remainingNow - wait < MIN_RETRY_BUDGET) {
        const cost = Date.now() - t0
        console.error(`[aiProxy] 失败 耗时=${cost}ms model=${usedModel} 尝试=${attempt}次 err=${e.message}`)
        return { error: `云函数调用 AI 失败（model=${usedModel}，耗时${cost}ms，尝试${attempt}次）：${e.message}` }
      }
      console.warn(`[aiProxy] 瞬时错误第 ${attempt} 次，退避 ${wait}ms 后重试（剩余预算 ${remainingNow}ms）err=${e.message}`)
      await sleep(wait)
    }
  }
}

// 导出纯函数供单测（微信云函数只调用 exports.main，多余导出无副作用）。
exports.parseSseText = parseSseText
exports.attemptTimeout = attemptTimeout
exports.isTransientError = isTransientError
exports.isTransientStatus = isTransientStatus
exports.backoffMs = backoffMs
exports._budget = { TOTAL_BUDGET, MIN_RETRY_BUDGET, PER_ATTEMPT }
