import { existsSync } from 'node:fs'

// 依次尝试仓库根目录与 package 目录的 .env（pnpm --filter 的 cwd 是 apps/server）
for (const candidate of ['../../.env', '.env']) {
  if (!existsSync(candidate)) continue
  try {
    process.loadEnvFile(candidate)
  } catch {
    // .env 只是便利，不阻断启动
  }
}

export interface ServerConfig {
  port: number
  host: string
  dataDir: string
  token?: string
  historyLimit: number
}

export const config: ServerConfig = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '127.0.0.1',
  dataDir: process.env.DATA_DIR ?? './data',
  token: process.env.CANVAS_TOKEN || undefined,
  historyLimit: Number(process.env.HISTORY_LIMIT ?? 100),
}
