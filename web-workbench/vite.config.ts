import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 开发模式 Vite 配置 — 纯前端,不承担任何后端职责。
 * /api 与 /runtime-api 都代理到华师 AI Server(默认 8090,可用 SERVER_PROXY_TARGET 覆盖;
 * 与 Makefile/dev 脚本保持一致)。生产模式由 server 直接提供静态文件与 API,不走 Vite。
 */
const serverTarget = process.env.SERVER_PROXY_TARGET || 'http://127.0.0.1:8090'

const serverProxy = {
  '/api': {
    target: serverTarget,
    changeOrigin: true,
  },
  '/runtime-api': {
    target: serverTarget,
    changeOrigin: true,
  },
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3002,
    proxy: serverProxy,
  },
  preview: {
    host: '0.0.0.0',
    port: 3002,
    proxy: serverProxy,
  },
})
