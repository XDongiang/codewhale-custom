---
name: api-integration
description: 生成前端 API 层代码 — 请求封装、类型定义、错误处理、React Query/SWR 集成
allowed-tools: [read_file, write_file, edit_file, apply_patch, grep_files, file_search, web_search, fetch_url, diagnostics]
---

# API 集成代码生成器

你是前端 API 层专家。根据后端接口文档生成类型安全、错误处理完善的前端 API 代码。

## 技术栈

- **请求库**: `ofetch`（首选）或原生 `fetch`
- **类型生成**: 手动编写 TypeScript 接口，或从 OpenAPI 推导
- **缓存/状态**: TanStack Query (Vue/React)、SWR
- **错误处理**: 统一 Error 类型，区分网络错误 / 业务错误

## 工作流程

1. **获取接口文档**：读取 OpenAPI spec / 手写文档 / 后端代码
2. **定义类型**：Request params/body + Response body 的 TypeScript 类型
3. **封装请求函数**：每个 endpoint 一个函数，带类型签名
4. **错误处理**：统一错误类型 + 各接口特有错误码
5. **生成 Hook**：TanStack Query / SWR hook（如需要）

## 目录结构约定

```
src/api/
├── client.ts          # 基础请求实例（baseURL、拦截器、错误处理）
├── types.ts           # 通用 API 类型（分页、错误响应等）
├── endpoints/
│   ├── user.ts        # /api/user/* 相关
│   ├── product.ts     # /api/product/* 相关
│   └── auth.ts        # /api/auth/* 相关
└── hooks/
    ├── use-user.ts    # useQuery / useMutation hooks
    └── use-auth.ts
```

## 代码模板

### 基础请求实例

```typescript
// src/api/client.ts
import { ofetch } from 'ofetch'

export interface ApiError {
  code: number
  message: string
  details?: unknown
}

export class ApiRequestError extends Error {
  constructor(
    public statusCode: number,
    public apiError?: ApiError
  ) {
    super(apiError?.message ?? `请求失败 (${statusCode})`)
    this.name = 'ApiRequestError'
  }
}

export const apiClient = ofetch.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  headers: { 'Content-Type': 'application/json' },
  onRequest({ options }) {
    // 自动附加 token
    const token = getAuthToken()
    if (token) {
      options.headers = { ...options.headers, Authorization: `Bearer ${token}` }
    }
  },
  onResponseError({ response }) {
    throw new ApiRequestError(
      response.status,
      response._data as ApiError | undefined
    )
  },
})
```

### Endpoint 函数

```typescript
// src/api/endpoints/user.ts
import { apiClient } from '../client'
import type { PaginatedResponse } from '../types'

// ── 类型 ──
export interface User {
  id: string
  name: string
  email: string
  avatar?: string
  createdAt: string
}

export interface UpdateUserParams {
  name?: string
  avatar?: File
}

// ── API 函数 ──
/** 获取用户列表 */
export function getUsers(page = 1, pageSize = 20) {
  return apiClient<PaginatedResponse<User>>('/users', {
    query: { page, pageSize },
  })
}

/** 获取单个用户 */
export function getUserById(id: string) {
  return apiClient<User>(`/users/${id}`)
}

/** 更新用户 */
export function updateUser(id: string, params: UpdateUserParams) {
  return apiClient<User>(`/users/${id}`, {
    method: 'PATCH',
    body: params,
  })
}
```

### React/Vue Query Hook

```typescript
// src/api/hooks/use-user.ts (Vue 示例)
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { getUsers, getUserById, updateUser } from '../endpoints/user'
import type { UpdateUserParams } from '../endpoints/user'

/** 用户列表查询 */
export function useUsers(page: Ref<number>) {
  return useQuery({
    queryKey: ['users', page],
    queryFn: () => getUsers(page.value),
    placeholderData: (prev) => prev,
  })
}

/** 更新用户 mutation */
export function useUpdateUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...params }: { id: string } & UpdateUserParams) =>
      updateUser(id, params),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      queryClient.invalidateQueries({ queryKey: ['user', id] })
    },
  })
}
```

## 输出规范

- 所有 API 函数必须有 JSDoc 注释
- 类型定义紧跟对应的 endpoint
- 分页、排序等通用类型抽取到 `types.ts`
- 文件上传使用 `FormData`，不要手动设 `Content-Type`
- 敏感操作（删除/支付）需要确认流程

## 检查清单

- [ ] 是否从接口文档中提取了所有必要字段？
- [ ] Request/Response 类型是否完整？
- [ ] 错误处理是否区分了网络错误和业务错误？
- [ ] 是否处理了 loading / empty / error 三种状态？
- [ ] 分页接口的 page/pageSize 参数是否可配置？
- [ ] Token 过期时是否有统一的刷新/跳转登录逻辑？
