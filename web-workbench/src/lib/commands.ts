// Slash command registry — add new commands here
// Each command: /<name> [args...]

export interface SlashCommand {
  name: string
  description: string
  usage?: string // e.g. "/model deepseek-v4-pro"
  action: (args: string[], context: CommandContext) => CommandResult | Promise<CommandResult>
}

export interface CommandContext {
  /** Navigate to a new chat */
  newChat: () => void
  /** Navigate to a specific thread */
  openThread: (id: string) => void
  /** Navigate to history page */
  openHistory: () => void
  /** Navigate to settings page */
  openSettings: () => void
  /** Current thread id (if any) */
  threadId: string | null
}

export interface CommandResult {
  /** Message to display in the chat (as system message) */
  message?: string
  /** If true, clear the input after executing */
  clearInput?: boolean
  /** If true, the command was handled */
  handled: boolean
}

// ── Built-in Commands ──

const builtinCommands: SlashCommand[] = [
  {
    name: 'help',
    description: 'Show available commands',
    action: (_args, _ctx) => {
      const list = commands
        .map((c) => `  **/${c.name}**${c.usage ? ` ${c.usage}` : ''} — ${c.description}`)
        .join('\n')
      return {
        message: `**Available commands:**\n\n${list}`,
        clearInput: true,
        handled: true,
      }
    },
  },
  {
    name: 'clear',
    description: 'Start a new conversation',
    action: (_args, ctx) => {
      ctx.newChat()
      return { clearInput: true, handled: true }
    },
  },
  {
    name: 'new',
    description: 'Start a new conversation (same as /clear)',
    action: (_args, ctx) => {
      ctx.newChat()
      return { clearInput: true, handled: true }
    },
  },
  {
    name: 'history',
    description: 'Open conversation history',
    action: (_args, ctx) => {
      ctx.openHistory()
      return { clearInput: true, handled: true }
    },
  },
  {
    name: 'settings',
    description: 'Open settings page',
    action: (_args, ctx) => {
      ctx.openSettings()
      return { clearInput: true, handled: true }
    },
  },
]

// ── Registry ──

const commands: SlashCommand[] = [...builtinCommands]

/** Register a custom slash command (for skills, plugins, etc.) */
export function registerCommand(cmd: SlashCommand): void {
  // Replace if already exists, otherwise add
  const idx = commands.findIndex((c) => c.name === cmd.name)
  if (idx >= 0) {
    commands[idx] = cmd
  } else {
    commands.push(cmd)
  }
}

/** Get all registered commands */
export function getCommands(): readonly SlashCommand[] {
  return commands
}

/** Parse input: if it starts with /, extract command name and args */
export function parseCommand(input: string): { name: string; args: string[] } | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return null
  const parts = trimmed.slice(1).split(/\s+/)
  if (parts.length === 0 || !parts[0]) return null
  return { name: parts[0].toLowerCase(), args: parts.slice(1) }
}

/** Execute a slash command. Returns null if not handled (should send as normal message). */
export async function executeCommand(
  input: string,
  ctx: CommandContext
): Promise<CommandResult | null> {
  const parsed = parseCommand(input)
  if (!parsed) return null

  const cmd = commands.find((c) => c.name === parsed.name)
  if (!cmd) {
    return {
      message: `Unknown command: **/${parsed.name}**. Type **/help** to see available commands.`,
      clearInput: true,
      handled: true,
    }
  }

  return cmd.action(parsed.args, ctx)
}
