import { defineConfig } from 'vite'
import uniModule from '@dcloudio/vite-plugin-uni'

// @dcloudio/vite-plugin-uni is CJS; its real export lives on .default in ESM context
const uni = (uniModule as any).default ?? uniModule

export default defineConfig({
  plugins: [uni()],
})
