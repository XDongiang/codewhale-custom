import { describe, expect, it } from 'vitest'
import { extractJson, errorMessageFromCli, validateMailPayload } from '../src/services/mail.js'
import { bearerToken } from '../src/http/auth.js'
import type { IncomingMessage } from 'node:http'

describe('mail helpers', () => {
  it('extractJson 解析整段 JSON', () => {
    expect(extractJson('{"action":"prepared"}')).toEqual({ action: 'prepared' })
  })

  it('extractJson 从混杂输出中截取 JSON', () => {
    expect(extractJson('stdout noise\n{"error":{"message":"bad"}}\nmore')).toEqual({
      error: { message: 'bad' },
    })
  })

  it('extractJson 无 JSON 返回 null', () => {
    expect(extractJson('plain text output')).toBeNull()
    expect(extractJson('')).toBeNull()
  })

  it('errorMessageFromCli 提取嵌套错误', () => {
    expect(errorMessageFromCli('{"error":{"message":"授权失败"}}', '')).toBe('授权失败')
    expect(errorMessageFromCli('', '{"message":"配额不足"}')).toBe('配额不足')
  })

  it('errorMessageFromCli 兜底', () => {
    expect(errorMessageFromCli('', '', '自定义兜底')).toBe('自定义兜底')
  })

  it('validateMailPayload', () => {
    expect(validateMailPayload({ to: 'a@b.com', subject: 's', body: 'b' })).toBeNull()
    expect(validateMailPayload({ to: 'bad', subject: 's', body: 'b' })).toMatch(/邮箱格式/)
    expect(validateMailPayload({ to: 'a@b.com', subject: '', body: 'b' })).toMatch(/主题/)
    expect(validateMailPayload({ to: 'a@b.com', subject: 's', body: '  ' })).toMatch(/正文/)
  })
})

describe('auth', () => {
  function makeReq(authorization?: string): IncomingMessage {
    return { headers: authorization ? { authorization } : {} } as IncomingMessage
  }

  it('bearerToken 提取', () => {
    expect(bearerToken(makeReq('Bearer abc'))).toBe('abc')
    expect(bearerToken(makeReq('bearer abc'))).toBe('abc')
    expect(bearerToken(makeReq('Basic abc'))).toBeNull()
    expect(bearerToken(makeReq())).toBeNull()
  })

  it('无 Bearer 前缀视为未携带 token', () => {
    expect(bearerToken(makeReq('Basic abc'))).toBeNull()
    expect(bearerToken(makeReq())).toBeNull()
  })
})
