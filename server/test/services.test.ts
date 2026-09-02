import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { JsonStore } from '../src/services/storage.js'
import { PersonnelService, ReportsService } from '../src/services/personnel.js'

function makeServices() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccnu-svc-'))
  const storage = new JsonStore(dir)
  return { personnel: new PersonnelService(storage), reports: new ReportsService(storage) }
}

describe('PersonnelService', () => {
  it('create 生成 id 并保存', () => {
    const { personnel } = makeServices()
    const entry = personnel.create({ name: '张三', level: 'college', category: '院领导' })
    expect(entry).not.toBeNull()
    expect(entry!.id).toMatch(/^person-\d+-/)
    expect(entry!.category).toBe('院领导')
    expect(personnel.list().entries).toHaveLength(1)
  })

  it('姓名为空拒绝创建', () => {
    const { personnel } = makeServices()
    expect(personnel.create({ name: '  ' })).toBeNull()
    expect(personnel.create({})).toBeNull()
  })

  it('非法 level 回退 individual', () => {
    const { personnel } = makeServices()
    const entry = personnel.create({ name: '李四', level: 'boss' })
    expect(entry!.level).toBe('individual')
  })

  it('update 只改传入字段并更新时间戳', () => {
    const { personnel } = makeServices()
    const created = personnel.create({ name: '张三', role: '主任' })!
    const updated = personnel.update(created.id, { role: '副主任' })
    expect(updated!.name).toBe('张三')
    expect(updated!.role).toBe('副主任')
    expect(updated!.updatedAt >= created.updatedAt).toBe(true)
  })

  it('update 不存在返回 null', () => {
    const { personnel } = makeServices()
    expect(personnel.update('nope', {})).toBeNull()
  })

  it('bulkAdd 追加并跳过已存在 id', () => {
    const { personnel } = makeServices()
    const first = personnel.create({ name: '张三' })!
    const result = personnel.bulkAdd([
      { id: first.id, name: '张三' }, // 已存在,跳过
      { id: 'client-1', name: '王五' },
      { name: '赵六', level: 'school' },
    ])
    expect(result.added).toBe(2)
    expect(personnel.list().entries).toHaveLength(3)
    expect(personnel.list().entries.map((e) => e.name)).toEqual(['张三', '王五', '赵六'])
    expect(personnel.list().entries.find((e) => e.name === '赵六')!.level).toBe('school')
  })

  it('remove 与 clear', () => {
    const { personnel } = makeServices()
    const a = personnel.create({ name: 'A' })!
    personnel.create({ name: 'B' })
    expect(personnel.remove(a.id)).toBe(true)
    expect(personnel.remove(a.id)).toBe(false)
    personnel.clear()
    expect(personnel.list().entries).toHaveLength(0)
  })
})

describe('ReportsService', () => {
  it('create 后最新在前', () => {
    const { reports } = makeServices()
    reports.create({ content: 'c1', dept: '文学院', level: 'college' })
    reports.create({ content: 'c2', dept: '全校', level: 'school' })
    const list = reports.list()
    expect(list.map((r) => r.content)).toEqual(['c2', 'c1'])
    expect(list[0].level).toBe('school')
  })

  it('内容为空拒绝', () => {
    const { reports } = makeServices()
    expect(reports.create({ content: '' })).toBeNull()
  })

  it('上限 50 份', () => {
    const { reports } = makeServices()
    for (let i = 0; i < 60; i++) {
      reports.create({ content: `r${i}`, dept: 'x' })
    }
    expect(reports.list()).toHaveLength(50)
    expect(reports.list()[0].content).toBe('r59')
  })

  it('remove', () => {
    const { reports } = makeServices()
    const r = reports.create({ content: 'c', dept: 'x' })!
    expect(reports.remove(r.id)).toBe(true)
    expect(reports.remove(r.id)).toBe(false)
  })
})
