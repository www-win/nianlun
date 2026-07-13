// 环境变量（在云开发控制台配置）：GACCODE_BASE_URL、GACCODE_API_KEY、GACCODE_MODEL
// 用 Node 内置 https，不依赖全局 fetch，兼容云开发的 Node 16/18 等各版本。
const https = require('https')
const { URL } = require('url')

// 给外部请求设 socket 空闲超时：AI 非流式返回时连接会一直空闲直到整段生成完，
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
        headers: { ...headers, 'content-length': Buffer.byteLength(body) },
        timeout: timeoutMs,
      },
      (res) => {
        let data = ''
        res.on('data', (c) => { data += c })
        res.on('end', () => resolve({ status: res.statusCode, body: data }))
      },
    )
    req.on('timeout', () => { req.destroy(new Error(`AI 请求 ${timeoutMs}ms 内无响应`)) })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

exports.main = async (event) => {
  const { prompt, maxTokens = 1024, model } = event || {}
  if (!prompt) return { error: '缺少 prompt' }
  const usedModel = model || process.env.GACCODE_MODEL || 'claude-opus-4-8'
  const base = (process.env.GACCODE_BASE_URL || '').replace(/\/+$/, '')
  const t0 = Date.now()
  console.log(`[aiProxy] 开始 model=${usedModel} maxTokens=${maxTokens} promptLen=${prompt.length}`)
  try {
    const resp = await postJson(
      base + '/v1/messages',
      {
        'x-api-key': process.env.GACCODE_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      {
        model: usedModel,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      },
      58000, // 58s：贴近云函数 60s 硬顶，把预算让满——有些好友分析生成本就要 ~50s，
             // 早前 50s 会把这些"本可在 60s 内跑完"的慢生成误杀在终点线前
    )
    const cost = Date.now() - t0
    console.log(`[aiProxy] AI 返回 status=${resp.status} 耗时=${cost}ms model=${usedModel}`)
    if (resp.status < 200 || resp.status >= 300) {
      return { error: `AI 服务返回 HTTP ${resp.status}（model=${usedModel}）：${resp.body.slice(0, 200)}` }
    }
    let data
    try { data = JSON.parse(resp.body) } catch { return { error: 'AI 返回非 JSON' } }
    const block = Array.isArray(data.content) ? data.content.find((b) => b.type === 'text') : null
    if (!block || !block.text) return { error: 'AI 返回内容为空' }
    return { text: block.text }
  } catch (e) {
    const cost = Date.now() - t0
    console.error(`[aiProxy] 失败 耗时=${cost}ms model=${usedModel} err=${e.message}`)
    return { error: `云函数调用 AI 失败（model=${usedModel}，耗时${cost}ms）：${e.message}` }
  }
}
