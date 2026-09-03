import { loadConfig } from './config.js'
import { createApp } from './app.js'

const config = loadConfig()
const app = createApp(config)

app.server.listen(config.port, '0.0.0.0', async () => {
  // 首次启动引导 admin(密码来自 ADMIN_PASSWORD 或随机生成,仅创建时打印一次)
  const boot = await app.deps.users.bootstrapAdmin(config.adminPassword)
  if (boot.created) {
    console.log('')
    console.log('══════════════════════════════════════')
    console.log('  已创建初始管理员账号')
    console.log(`  用户名: ${boot.username}`)
    console.log(`  密码:   ${boot.password}`)
    console.log('  (仅在创建时的本次启动打印,登录后请尽快在「设置 → 用户管理」修改密码)')
    console.log('══════════════════════════════════════')
    console.log('')
  }

  console.log(`华师 AI Server 已启动`)
  console.log(`  端口:     ${config.port}`)
  console.log(`  数据目录: ${config.dataDir}`)
  console.log(`  Runtime:  ${config.runtimeUrl}`)
  console.log(`  静态目录: ${config.staticDir ?? '(未启用,由 Vite 提供页面)'}`)
  console.log(`  XHS CLI:  ${config.xhsBin}`)
  console.log(`  Mail CLI: ${config.agentlyBin}`)
})

function shutdown(signal: string) {
  console.log(`收到 ${signal},正在关闭...`)
  void app.close().then(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
