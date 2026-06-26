// 年轮本地服务器：静态伺服 app/ + 把 /__ai/* 同源反向代理到真实 AI 接入地址。
// 纯 Node 内置模块，无第三方依赖。客户机直连 AI 服务（绕过浏览器 CORS）。
import http from 'node:http'
import https from 'node:https'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = resolve(fileURLToPath(import.meta.url), '..')
const PORT = Number(process.env.PORT || 8723)
const HOST = process.env.HOST || '127.0.0.1'
const ROOT = resolve(process.env.APP_ROOT || join(HERE, 'app'))
const AI_TARGET = process.env.AI_TARGET || '' // 例：https://gaccode.com/claudecode

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
}

function proxyAi(req, res) {
  const target = new URL(AI_TARGET)
  const rest = req.url.slice('/__ai'.length) // 形如 /v1/messages
  const basePath = target.pathname.replace(/\/+$/, '')
  const headers = { ...req.headers, host: target.host }
  delete headers['accept-encoding'] // 避免上游压缩透传后体积/解码问题
  const upstream = https.request(
    {
      protocol: target.protocol, hostname: target.hostname,
      port: target.port || 443, method: req.method,
      path: basePath + rest, headers,
    },
    (upRes) => { res.writeHead(upRes.statusCode || 502, upRes.headers); upRes.pipe(res) },
  )
  upstream.on('error', (e) => {
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'AI 转发失败：' + e.message }))
  })
  req.pipe(upstream)
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
  let rel = urlPath === '/' ? '/index.html' : urlPath
  let filePath = resolve(join(ROOT, rel))
  // 防目录穿越：必须落在 ROOT 内
  if (filePath !== ROOT && !filePath.startsWith(ROOT + (process.platform === 'win32' ? '\\' : '/'))) {
    res.writeHead(403); res.end('forbidden'); return
  }
  let info = await stat(filePath).catch(() => null)
  if (!info || info.isDirectory()) {
    // SPA 回退
    filePath = join(ROOT, 'index.html')
    info = await stat(filePath).catch(() => null)
    if (!info) { res.writeHead(404); res.end('not found'); return }
  }
  res.writeHead(200, { 'content-type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream' })
  createReadStream(filePath).pipe(res)
}

const server = http.createServer((req, res) => {
  if (AI_TARGET && req.url && req.url.startsWith('/__ai/')) return proxyAi(req, res)
  serveStatic(req, res).catch((e) => { res.writeHead(500); res.end(String(e && e.message)) })
})

server.listen(PORT, HOST, () => {
  console.log(`年轮服务器已启动：http://${HOST}:${PORT}  (root=${ROOT}, ai=${AI_TARGET || '未配置'})`)
})
