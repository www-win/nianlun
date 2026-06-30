import http from 'node:http'

const PORT = process.env.PORT || 8787
const BASE = (process.env.GACCODE_BASE_URL || '').replace(/\/+$/, '')
const KEY = process.env.GACCODE_API_KEY
const MODEL = process.env.GACCODE_MODEL || 'claude-opus-4-8'

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json')
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(JSON.stringify({ error: 'method not allowed' })) }
  let body = ''
  req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy() })
  req.on('end', async () => {
    try {
      const { prompt, maxTokens = 1024 } = JSON.parse(body || '{}')
      if (!prompt) { res.statusCode = 400; return res.end(JSON.stringify({ error: '缺少 prompt' })) }
      const r = await fetch(BASE + '/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
      })
      if (!r.ok) { res.statusCode = 502; return res.end(JSON.stringify({ error: `AI HTTP ${r.status}` })) }
      const data = await r.json()
      const block = Array.isArray(data.content) ? data.content.find((b) => b.type === 'text') : null
      res.end(JSON.stringify({ text: (block && block.text) || '' }))
    } catch (e) {
      res.statusCode = 500; res.end(JSON.stringify({ error: e.message }))
    }
  })
})
server.listen(PORT, () => console.log(`ai proxy on :${PORT}`))
