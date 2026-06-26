import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

// gaccode 等接入点不支持浏览器跨域直连（无 CORS 头）。开发环境用 Vite 同源代理
// 把 /__ai/* 转发到真实接入地址（VITE_AI_BASE_URL），浏览器走同源即无 CORS。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd())
  const aiTarget = env.VITE_AI_BASE_URL
  return {
    plugins: [vue()],
    server: aiTarget
      ? {
          proxy: {
            '/__ai': {
              target: aiTarget,
              changeOrigin: true,
              rewrite: (p) => p.replace(/^\/__ai/, ''),
            },
          },
        }
      : {},
  }
})
