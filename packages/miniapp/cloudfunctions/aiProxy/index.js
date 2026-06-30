// 环境变量（在云开发控制台配置）：GACCODE_BASE_URL、GACCODE_API_KEY、GACCODE_MODEL
exports.main = async (event) => {
  const { prompt, maxTokens = 1024 } = event || {}
  if (!prompt) return { error: '缺少 prompt' }
  const base = (process.env.GACCODE_BASE_URL || '').replace(/\/+$/, '')
  try {
    const resp = await fetch(base + '/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.GACCODE_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.GACCODE_MODEL || 'claude-opus-4-8',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!resp.ok) return { error: `AI 服务返回 HTTP ${resp.status}` }
    const data = await resp.json()
    const block = Array.isArray(data.content) ? data.content.find((b) => b.type === 'text') : null
    if (!block || !block.text) return { error: 'AI 返回内容为空' }
    return { text: block.text }
  } catch (e) {
    return { error: '云函数调用 AI 失败：' + e.message }
  }
}
