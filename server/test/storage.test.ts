import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { JsonStore } from '../src/services/storage.js'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ccnu-store-'))
}

describe('JsonStore', () => {
  it('写入后可读回', () => {
    const store = new JsonStore(tmpDir())
    store.writeDoc('personnel', { entries: [{ id: '1' }] })
    expect(store.readDoc('personnel', { entries: [] })).toEqual({ entries: [{ id: '1' }] })
  })

  it('不存在时返回 fallback', () => {
    const store = new JsonStore(tmpDir())
    expect(store.readDoc('missing', 'fb')).toBe('fb')
  })

  it('原子写保留备份', () => {
    const dir = tmpDir()
    const store = new JsonStore(dir)
    store.writeDoc('doc', { v: 1 })
    store.writeDoc('doc', { v: 2 })
    // 正式文件为最新,备份为上一份
    expect(store.readDoc('doc', null)).toEqual({ v: 2 })
    const bak = JSON.parse(fs.readFileSync(path.join(dir, 'doc.json.bak'), 'utf8'))
    expect(bak).toEqual({ v: 1 })
  })

  it('正式文件损坏时从备份恢复', () => {
    const dir = tmpDir()
    const store = new JsonStore(dir)
    store.writeDoc('doc', { v: 1 })
    store.writeDoc('doc', { v: 2 }) // 第二次写入后 .bak 为上一份 { v: 1 }
    // 损坏正式文件,保留 .bak
    fs.writeFileSync(path.join(dir, 'doc.json'), '{broken json')
    expect(store.readDoc('doc', 'fallback')).toEqual({ v: 1 })
    // 恢复后正式文件可读
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'doc.json'), 'utf8'))).toEqual({ v: 1 })
  })

  it('损坏且无备份时返回 fallback', () => {
    const dir = tmpDir()
    const store = new JsonStore(dir)
    fs.writeFileSync(path.join(dir, 'doc.json'), '{broken json')
    expect(store.readDoc('doc', 'fallback')).toBe('fallback')
  })

  it('拒绝非法文档名', () => {
    const store = new JsonStore(tmpDir())
    expect(() => store.writeDoc('../escape', {})).toThrow(/illegal document name/)
    expect(() => store.readDoc('a/b', {})).toThrow(/illegal document name/)
  })
})
