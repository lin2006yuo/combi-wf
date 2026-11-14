import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CanvasEngine,
  type EngineSnapshot,
  type NodeRegistry,
} from '@combi/canvas-core'
import { createSeedDoc } from './seed'
import { sanitizeDocId } from './util'

/**
 * 骨架阶段用 JSON 文件持久化：doc + 历史 patch + cursor。
 * 生产替换为 Postgres（文档行 + command_log 表）时，接口不变。
 */
export class DocStore {
  private readonly engines = new Map<string, CanvasEngine>()
  private readonly timers = new Map<string, NodeJS.Timeout>()

  constructor(
    private readonly dir: string,
    private readonly registry: NodeRegistry,
    private readonly historyLimit = 100,
  ) {}

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const files = await readdir(this.dir)
    for (const file of files) {
      if (!file.endsWith('.json') || file.endsWith('.tmp')) continue
      const path = join(this.dir, file)
      try {
        const raw = await readFile(path, 'utf8')
        const snapshot = JSON.parse(raw) as EngineSnapshot
        const docId = sanitizeDocId(snapshot.doc?.id)
        const engine = CanvasEngine.fromSnapshot(this.registry, snapshot, {
          historyLimit: this.historyLimit,
        })
        this.engines.set(docId, engine)
      } catch (error) {
        console.warn(`[store] 跳过无法读取的文档 ${file}:`, (error as Error).message)
      }
    }
  }

  has(docId: string): boolean {
    return this.engines.has(sanitizeDocId(docId))
  }

  get(docIdInput: string): CanvasEngine {
    const docId = sanitizeDocId(docIdInput)
    let engine = this.engines.get(docId)
    if (!engine) {
      engine = new CanvasEngine({
        doc: createSeedDoc(docId, this.registry),
        registry: this.registry,
        historyLimit: this.historyLimit,
      })
      this.engines.set(docId, engine)
      this.save(docId)
    }
    return engine
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
    const engine = this.engines.get(docId)
    if (!engine) return
    const path = join(this.dir, `doc-${docId}.json`)
    const tmp = `${path}.tmp`
    try {
      await writeFile(tmp, JSON.stringify(engine.toSnapshot(), null, 2), 'utf8')
      await rename(tmp, path)
    } catch (error) {
      console.error(`[store] 持久化失败 ${docId}:`, error)
    }
  }

  async flush(): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    await Promise.all([...this.engines.keys()].map((docId) => this.persist(docId)))
  }
}
