import fs from 'node:fs'
import path from 'node:path'

/**
 * 持久化存储接口。当前实现为 JSON 文件仓库(原子写 + 备份恢复),
 * 未来知识库模块引入 SQLite 时,替换实现而不替换调用方。
 */
export interface Storage {
  /** 读取文档;不存在或损坏时回退到 fallback 并尝试 .bak 恢复 */
  readDoc<T>(name: string, fallback: T): T
  /** 原子写入文档(tmp + rename),写前保留单份 .bak */
  writeDoc(name: string, data: unknown): void
  exists(name: string): boolean
}

const BACKUP_SUFFIX = '.bak'
const TMP_SUFFIX = '.tmp'

/**
 * JSON 文件存储:dataDir/<name>.json
 *
 * - 原子写:先写 <name>.json.tmp,再 rename 覆盖正式文件
 * - 写前把旧文件复制为 <name>.json.bak(单份轮换)
 * - 正式文件损坏时尝试从 .bak 恢复;恢复失败则使用 fallback
 */
export class JsonStore implements Storage {
  private readonly dir: string

  constructor(dir: string) {
    this.dir = dir
    fs.mkdirSync(dir, { recursive: true })
  }

  private filePath(name: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error(`illegal document name: ${name}`)
    }
    return path.join(this.dir, `${name}.json`)
  }

  readDoc<T>(name: string, fallback: T): T {
    const file = this.filePath(name)
    const parsed = this.tryParse(file)
    if (parsed !== undefined) return parsed as T

    // 正式文件缺失或损坏:尝试 .bak
    const restored = this.tryParse(`${file}${BACKUP_SUFFIX}`)
    if (restored !== undefined) {
      try {
        fs.copyFileSync(`${file}${BACKUP_SUFFIX}`, file)
      } catch {
        // 恢复失败不阻塞启动,由 fallback 兜底
      }
      return restored as T
    }
    return fallback
  }

  writeDoc(name: string, data: unknown): void {
    const file = this.filePath(name)
    const tmp = `${file}${TMP_SUFFIX}`
    const json = JSON.stringify(data, null, 2) + '\n'

    // 保留上一份正式文件为备份
    if (fs.existsSync(file)) {
      try {
        fs.copyFileSync(file, `${file}${BACKUP_SUFFIX}`)
      } catch {
        // 备份失败不阻塞写入
      }
    }

    fs.writeFileSync(tmp, json, 'utf8')
    fs.renameSync(tmp, file)
  }

  exists(name: string): boolean {
    return fs.existsSync(this.filePath(name))
  }

  private tryParse(file: string): unknown | undefined {
    let raw: string
    try {
      raw = fs.readFileSync(file, 'utf8')
    } catch {
      return undefined
    }
    try {
      return JSON.parse(raw)
    } catch {
      return undefined
    }
  }
}
