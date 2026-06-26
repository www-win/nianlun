// 年轮本地服务器：静态伺服 app/ + 把 /__ai/* 同源反向代理到真实 AI 接入地址。
// 纯 Node 内置模块，无第三方依赖。客户机直连 AI 服务（绕过浏览器 CORS）。
import http from 'node:http'
import https from 'node:https'
import { createReadStream, appendFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = resolve(fileURLToPath(import.meta.url), '..')
const PORT = Number(process.env.PORT || 8723)
const HOST = process.env.HOST || '127.0.0.1'
const ROOT = resolve(process.env.APP_ROOT || join(HERE, 'app'))
const AI_TARGET = process.env.AI_TARGET || '' // 例：https://gaccode.com/claudecode
const LOG_FILE = process.env.LOG_FILE || join(HERE, '..', '年轮-运行日志.txt')

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  // eslint-disable-next-line no-console
  console.log(line)
  try { appendFileSync(LOG_FILE, line + '\n') } catch { /* 写日志失败不影响运行 */ }
}

// 兜底：任何未捕获异常都记录但不退出，保证服务器不被一次异常打死。
process.on('uncaughtException', (e) => log('uncaughtException: ' + (e && e.stack || e)))
process.on('unhandledRejection', (e) => log('unhandledRejection: ' + (e && e.stack || e)))

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
  delete headers['accept-encoding']
  const upstream = https.request(
    {
      protocol: target.protocol, hostname: target.hostname,
      port: target.port || 443, method: req.method,
      path: basePath + rest, headers,
    },
    (upRes) => {
      log(`AI ${req.method} ${rest} -> ${upRes.statusCode}`)
      try { res.writeHead(upRes.statusCode || 502, upRes.headers) } catch { /* headers 已发 */ }
      upRes.on('error', () => res.end())
      upRes.pipe(res)
    },
  )
  upstream.on('error', (e) => {
    log(`AI 转发失败 ${rest}: ${e.code || e.message}`)
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'AI 转发失败：' + (e.code || e.message) }))
  })
  req.on('error', () => upstream.destroy())
  res.on('close', () => upstream.destroy())
  req.pipe(upstream)
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
  const rel = urlPath === '/' ? '/index.html' : urlPath
  let filePath = resolve(join(ROOT, rel))
  if (filePath !== ROOT && !filePath.startsWith(ROOT + (process.platform === 'win32' ? '\\' : '/'))) {
    res.writeHead(403); res.end('forbidden'); return
  }
  let info = await stat(filePath).catch(() => null)
  if (!info || info.isDirectory()) {
    filePath = join(ROOT, 'index.html')
    info = await stat(filePath).catch(() => null)
    if (!info) { res.writeHead(404); res.end('not found'); return }
  }
  res.writeHead(200, { 'content-type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream' })
  const stream = createReadStream(filePath)
  stream.on('error', () => { try { res.destroy() } catch { /* noop */ } })
  res.on('close', () => stream.destroy())
  stream.pipe(res)
}

const server = http.createServer((req, res) => {
  res.on('error', () => { /* 客户端断开导致的写错误，忽略 */ })
  if (AI_TARGET && req.url && req.url.startsWith('/__ai/')) return proxyAi(req, res)
  serveStatic(req, res).catch((e) => {
    log('静态请求出错 ' + req.url + ': ' + (e && e.message))
    try { if (!res.headersSent) res.writeHead(500); res.end('server error') } catch { /* noop */ }
  })
})

server.on('clientError', (err, socket) => { try { socket.destroy() } catch { /* noop */ } })
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') log(`端口 ${PORT} 已被占用：可能已经开着一个年轮，或换个端口。`)
  else log('服务器错误: ' + (e.stack || e))
})

server.listen(PORT, HOST, () => {
  log(`年轮服务器已启动：http://${HOST}:${PORT}  (root=${ROOT}, ai=${AI_TARGET || '未配置'})`)
})
