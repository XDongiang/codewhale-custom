import { loadConfig } from './config.js'
import { startServer } from './http/server.js'
import { JsonStore } from './services/storage.js'
import { PersonnelService, ReportsService } from './services/personnel.js'

const config = loadConfig()

const storage = new JsonStore(config.dataDir)
const personnel = new PersonnelService(storage)
const reports = new ReportsService(storage)

const server = startServer(config, { personnel, reports })

server.listen(config.port, '0.0.0.0', () => {
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
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
