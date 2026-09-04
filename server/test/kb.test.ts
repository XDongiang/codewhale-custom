import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { JsonStore } from '../src/services/storage.js'
import { KbService, buildAskPrompt, chunkText, tokenize } from '../src/services/kb.js'

function makeKb(): KbService {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccnu-kb-'))
  return new KbService(new JsonStore(dir))
}

describe('chunkText', () => {
  it('按句切块并保留内容', () => {
    const text = '第一条内容。第二条内容!第三条内容?第四条内容。'
    const chunks = chunkText(text, 5, 0)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('')).toContain('第一条内容')
  })

  it('空文本返回空数组', () => {
    expect(chunkText('   \n ')).toEqual([])
  })

  it('长无标点文本强制截断且带重叠', () => {
    const long = '无标点内容'.repeat(200)
    const chunks = chunkText(long, 100, 20)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((c) => c.length <= 100)).toBe(true)
    // 有重叠时相邻块尾部与头部应重叠
    const overlap = chunks[0].slice(-20)
    expect(chunks[1]!.startsWith(overlap)).toBe(true)
  })
})

describe('tokenize', () => {
  it('中文出二元组,英文出整词', () => {
    const tokens = tokenize('华中师范大学 regex123 华')
    expect(tokens).toContain('华中')
    expect(tokens).toContain('师范')
    expect(tokens).toContain('regex123')
    expect(tokens).toContain('华')
  })
})

describe('KbService', () => {
  it('add 切块并保存元数据;空内容拒绝', () => {
    const kb = makeKb()
    const meta = kb.add({ filename: '办法.txt', scope: 'school', text: '第一章总则。第一条本办法适用于全校。', uploadedBy: 'admin' })
    expect(meta.chunkCount).toBeGreaterThan(0)
    expect(meta.charCount).toBeGreaterThan(0)
    expect(meta.scope).toBe('school')
    expect(() => kb.add({ filename: '空.txt', scope: 'school', text: '   ', uploadedBy: 'admin' })).toThrow(/内容为空/)
  })

  it('college 文件必须带学院', () => {
    const kb = makeKb()
    expect(() => kb.add({ filename: 'x.txt', scope: 'college', text: '内容', uploadedBy: 'admin' })).toThrow(/必须指定所属学院/)
  })

  it('可见性:admin/school 全部;college 仅 school 或本院', () => {
    const kb = makeKb()
    kb.add({ filename: '全校办法.txt', scope: 'school', text: '全校内容。', uploadedBy: 'admin' })
    kb.add({ filename: '文学院细则.txt', scope: 'college', college: '文学院', text: '文学院内容。', uploadedBy: 'admin' })
    kb.add({ filename: '物院细则.txt', scope: 'college', college: '物理学院', text: '物院内容。', uploadedBy: 'admin' })

    expect(kb.listMeta({ role: 'admin' })).toHaveLength(3)
    expect(kb.listMeta({ role: 'school' })).toHaveLength(3)
    const wen = kb.listMeta({ role: 'college', college: '文学院' })
    expect(wen.map((d) => d.filename)).toEqual(['全校办法.txt', '文学院细则.txt'])
  })

  it('search 只检索可见文档,且命中相关片段', () => {
    const kb = makeKb()
    kb.add({ filename: '差旅管理办法.txt', scope: 'school', text: '差旅费报销办法。出差人员需凭发票报销差旅费。', uploadedBy: 'admin' })
    kb.add({ filename: '文学院考勤细则.txt', scope: 'college', college: '文学院', text: '文学院考勤管理细则。考勤迟到扣分。', uploadedBy: 'admin' })
    kb.add({ filename: '物院考勤细则.txt', scope: 'college', college: '物理学院', text: '物理学院考勤管理细则。考勤迟到扣分。', uploadedBy: 'admin' })

    // 全校用户:检索"差旅费"只命中差旅办法
    const hits = kb.search('差旅费怎么报销', { role: 'school' })
    expect(hits).toHaveLength(1)
    expect(hits[0]!.doc.filename).toBe('差旅管理办法.txt')

    // 文学院用户:检索"考勤"不包含物院文件
    const wenHits = kb.search('考勤迟到怎么处理', { role: 'college', college: '文学院' })
    for (const h of wenHits) {
      expect(h.doc.filename).not.toBe('物院考勤细则.txt')
    }
    expect(wenHits.map((h) => h.doc.filename)).toContain('文学院考勤细则.txt')
  })

  it('search 无可见命中返回空', () => {
    const kb = makeKb()
    kb.add({ filename: '物院.txt', scope: 'college', college: '物理学院', text: '物理学院内容。', uploadedBy: 'admin' })
    expect(kb.search('物理', { role: 'college', college: '文学院' })).toEqual([])
  })

  it('remove', () => {
    const kb = makeKb()
    const meta = kb.add({ filename: 'a.txt', scope: 'school', text: '内容。', uploadedBy: 'admin' })
    expect(kb.remove(meta.id)).toBe(true)
    expect(kb.remove(meta.id)).toBe(false)
  })
})

describe('buildAskPrompt', () => {
  it('包含问题、片段与出处约束', () => {
    const prompt = buildAskPrompt('报销流程', [
      { doc: { id: '1', filename: '办法.txt', scope: 'school', uploadedBy: 'a', uploadedAt: '', charCount: 1, chunkCount: 1 }, chunks: [{ idx: 0, text: '凭票报销。' }] },
    ])
    expect(prompt).toContain('$kb-ask')
    expect(prompt).toContain('报销流程')
    expect(prompt).toContain('办法.txt')
    expect(prompt).toContain('不得使用外部知识')
  })
})
