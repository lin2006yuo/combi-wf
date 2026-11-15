import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CommandLog,
  type CommandLogSnapshot,
  type NodeRegistry,
} from '@combi/canvas-core'
import { createSeedDoc } from './seed'
import { sanitizeDocId } from './util'

/**
 * 骨架阶段用 JSON 文件持久化：doc + command log。
 * 生产替换为 Postgres（documents + command_log）时，CommandLog 接口不变。
 */
export class DocStore {
  private readonly logs = new Map<string, CommandLog>()
  private readonly timers = new Map<string, NodeJS.Timeout>()

  constructor(
    private readonly dir: string,
    private readonly registry: NodeRegistry,
  ) {}

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const files = await readdir(this.dir)
    for (const file of files) {
      if (!file.endsWith('.json') || file.endsWith('.tmp')) continue
      const path = join(this.dir, file)
      try {
        const raw = await readFile(path, 'utf8')
        const snapshot = JSON.parse(raw) as CommandLogSnapshot
        const docId = sanitizeDocId(snapshot.doc?.id)
        this.logs.set(docId, CommandLog.fromSnapshot(this.registry, snapshot))
      } catch (error) {
        console.warn(`[store] 跳过无法读取的文档 ${file}:`, (error as Error).message)
      }
    }
  }

  has(docId: string): boolean {
    return this.logs.has(sanitizeDocId(docId))
  }

  get(docIdInput: string): CommandLog {
    const docId = sanitizeDocId(docIdInput)
    let log = this.logs.get(docId)
    if (!log) {
      log = new CommandLog({
        doc: createSeedDoc(docId, this.registry),
        registry: this.registry,
      })
      this.logs.set(docId, log)
      this.save(docId)
    }
    return log
  }

  save(docId: string): void {
    const existing = this.timers.get(docId)
    if (existing) clearTimeout(existing)
    this.timers.set(
      docId,
      setTimeout(() => {
        this.timers.delete(docId)
        void this.persist(docId)
      }, 120),
    )
  }

  private async persist(docId: string): Promise<void> {
    const log = this.logs.get(docId)
    if (!log) return
    const path = join(this.dir, `doc-${docId}.json`)
    const tmp = `${path}.tmp`
    try {
      await writeFile(tmp, JSON.stringify(log.toSnapshot(), null, 2), 'utf8')
      await rename(tmp, path)
    } catch (error) {
      console.error(`[store] 持久化失败 ${docId}:`, error)
    }
  }

  async flush(): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    await Promise.all([...this.logs.keys()].map((docId) => this.persist(docId)))
  }
}
