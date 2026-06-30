// 构建后处理：把云函数拷进小程序构建产物，并在 project.config.json 里声明
// cloudfunctionRoot，使微信开发者工具能识别并「右键上传并部署」aiProxy。
// （uni-app 构建只产出小程序本体，不含 cloudfunctions；此脚本补上。）
import { cpSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..') // packages/miniapp
const srcCloud = resolve(root, 'cloudfunctions')
const outRoot = resolve(root, 'dist/build/mp-weixin')
const outCloud = resolve(outRoot, 'cloudfunctions')
const cfgPath = resolve(outRoot, 'project.config.json')

if (!existsSync(srcCloud)) {
  console.warn('[postbuild-cloud] 未找到 cloudfunctions/，跳过')
  process.exit(0)
}
if (!existsSync(outRoot)) {
  console.warn('[postbuild-cloud] 未找到构建产物 dist/build/mp-weixin，跳过')
  process.exit(0)
}

cpSync(srcCloud, outCloud, { recursive: true })

if (existsSync(cfgPath)) {
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
  cfg.cloudfunctionRoot = 'cloudfunctions/'
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2))
}

console.log('[postbuild-cloud] 已拷贝 cloudfunctions 并设置 cloudfunctionRoot')
