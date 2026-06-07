# 前端开发约定

> 此文件通过 CodeWhale Memory 功能注入到每次对话的系统提示中。
> CodeWhale 会在每个 turn 自动加载这些约定。

## 项目技术栈

- **框架**: Vue 3 (Composition API) 或 React 18+（按项目选择）
- **语言**: TypeScript 5.x 严格模式
- **样式**: Tailwind CSS 3.x，不写内联 style
- **包管理**: pnpm（优先）或 npm
- **构建**: Vite
- **测试**: Vitest + Vue Test Utils / React Testing Library
- **Lint**: ESLint flat config + Prettier

## 代码风格

- 使用 `<script setup lang="ts">` 语法
- Props/Emits 使用 TypeScript 类型推导
- 组件名使用 PascalCase，文件名使用 kebab-case
- 每个组件文件不超过 300 行，超出则拆分
- 复杂逻辑抽取为 composable（`useXxx`）
- 避免 any 类型，必要时使用 unknown + 类型守卫

## 文件组织

```
src/
├── api/          # API 层（请求函数 + hooks）
├── components/   # 通用组件
├── composables/  # 组合式函数
├── layouts/      # 布局组件
├── pages/        # 页面组件（路由级别）
├── stores/       # 状态管理（Pinia）
├── types/        # 共享类型定义
└── utils/        # 工具函数
```

## UI/UX 约定

- 优先使用 Tailwind 的语义化颜色 token
- 所有交互元素考虑 hover、focus、disabled 状态
- 移动端优先（mobile-first 响应式）
- 列表/表格必须有 empty 状态提示
- 异步操作必须有 loading 指示
- 错误信息要友好，不要直接展示技术错误

## Git 约定

- 提交信息使用 Conventional Commits：`feat:`, `fix:`, `refactor:`, `style:`, `docs:`
- PR 标题使用中文描述，body 使用英文
- 安装新依赖时说明用途
