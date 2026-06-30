// 环境变量（在云开发控制台配置）：GACCODE_BASE_URL、GACCODE_API_KEY、GACCODE_MODEL
// 用 Node 内置 https，不依赖全局 fetch，兼容云开发的 Node 16/18 等各版本。
const https = require('https')
const { URL } = require('url')

function postJson(urlStr, headers, bodyObj) {
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
      },
      (res) => {
        let data = ''
        res.on('data', (c) => { data += c })
        res.on('end', () => resolve({ status: res.statusCode, body: data }))
      },
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

exports.main = async (event) => {
  const { prompt, maxTokens = 1024 } = event || {}
  if (!prompt) return { error: '缺少 prompt' }
  const base = (process.env.GACCODE_BASE_URL || '').replace(/\/+$/, '')
  try {
    const resp = await postJson(
      base + '/v1/messages',
      {
        'x-api-key': process.env.GACCODE_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      {
        model: process.env.GACCODE_MODEL || 'claude-opus-4-8',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      },
    )
    if (resp.status < 200 || resp.status >= 300) {
      return { error: `AI 服务返回 HTTP ${resp.status}：${resp.body.slice(0, 200)}` }
    }
    let data
    try { data = JSON.parse(resp.body) } catch { return { error: 'AI 返回非 JSON' } }
    const block = Array.isArray(data.content) ? data.content.find((b) => b.type === 'text') : null
    if (!block || !block.text) return { error: 'AI 返回内容为空' }
    return { text: block.text }
  } catch (e) {
    return { error: '云函数调用 AI 失败：' + e.message }
  }
}
