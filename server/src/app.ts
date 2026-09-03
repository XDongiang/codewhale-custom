import http from 'node:http'
import type { ServerConfig } from './config.js'
import { startServer } from './http/server.js'
import { JsonStore } from './services/storage.js'
import { PersonnelService, ReportsService } from './services/personnel.js'
import { UserService } from './services/users.js'
import { SessionService } from './services/sessions.js'
import type { RouteDeps } from './http/routes.js'

export interface App {
  server: http.Server
  config: ServerConfig
  deps: RouteDeps
  /** 关闭 HTTP 服务(Promise 在连接全部结束后 resolve)。 */
  close: () => Promise<void>
}

/**
 * 组装应用(不监听端口)。测试与入口共用的工厂。
 */
export function createApp(config: ServerConfig): App {
  const storage = new JsonStore(config.dataDir)
  const personnel = new PersonnelService(storage)
  const reports = new ReportsService(storage)
  const users = new UserService(storage)
  const sessions = new SessionService(storage, config.sessionTtlMs)
  sessions.pruneExpired()

  const deps: RouteDeps = { personnel, reports, users, sessions }
  const server = startServer(config, deps)

  return {
    server,
    config,
    deps,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}
