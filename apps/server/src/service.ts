import {
  CanvasError,
  type AppliedMessage,
  type CanvasDoc,
  type Command,
  type HistoryEntry,
  type LogResult,
  type NodeRuntime,
  type SnapshotMessage,
  type Source,
} from '@combi/canvas-core'
import type { ExecutionService, JobView } from './execution'
import type { Hub } from './hub'
import type { DocStore } from './store'
import { sanitizeDocId } from './util'

export interface ServiceMeta {
  source?: Source
  actorId?: string
  requestId?: string
}

export type ServiceResponse =
  | { kind: 'doc'; result: LogResult }
  | { kind: 'run'; data: unknown }

export class CanvasService {
  constructor(
    private readonly store: DocStore,
    private readonly execution: ExecutionService,
    private readonly hub: Hub,
  ) {}

  getSnapshot(docIdInput: string): SnapshotMessage {
    const docId = sanitizeDocId(docIdInput)
    const log = this.store.get(docId)
    return {
      type: 'snapshot',
      doc: log.getDoc(),
      history: log.getHistory(),
      runtime: this.execution.getRuntime(docId),
    }
  }

  getHistory(docIdInput: string): HistoryEntry[] {
    return this.store.get(sanitizeDocId(docIdInput)).getHistory()
  }

  getRuntime(docIdInput: string): Record<string, NodeRuntime> {
    return this.execution.getRuntime(sanitizeDocId(docIdInput))
  }

  getJob(jobId: string): JobView | null {
    return this.execution.getJob(jobId)
  }

  getDoc(docIdInput: string): CanvasDoc {
    return this.store.get(sanitizeDocId(docIdInput)).getDoc()
  }

  async execute(docIdInput: string, raw: unknown, meta: ServiceMeta = {}): Promise<ServiceResponse> {
    const docId = sanitizeDocId(docIdInput)
    if (!raw || typeof raw !== 'object' || typeof (raw as { type?: unknown }).type !== 'string') {
      throw new CanvasError('INVALID_COMMAND', '命令必须是带 type 的对象')
    }

    const log = this.store.get(docId)
    const input = raw as Command
    const command: Command = {
      ...input,
      docId,
      source: meta.source ?? input.source ?? 'user',
      actorId: meta.actorId ?? input.actorId,
    }

    if (command.type === 'node.run') {
      if (!command.payload || typeof command.payload.id !== 'string') {
        throw new CanvasError('INVALID_COMMAND', 'node.run 缺少节点 id')
      }
      const jobId = this.execution.runNode(docId, command.payload.id)
      return { kind: 'run', data: { jobId, nodeId: command.payload.id } }
    }

    if (command.type === 'graph.run') {
      const targetId = command.payload?.targetId
      if (targetId !== undefined && typeof targetId !== 'string') {
        throw new CanvasError('INVALID_COMMAND', 'targetId 必须是字符串')
      }
      const started = await this.execution.startGraph(docId, targetId)
      return { kind: 'run', data: { started: true, ...started } }
    }

    if (command.type === 'job.cancel') {
      if (!command.payload || typeof command.payload.jobId !== 'string') {
        throw new CanvasError('INVALID_COMMAND', 'job.cancel 缺少 jobId')
      }
      const canceled = this.execution.cancelJob(command.payload.jobId)
      return { kind: 'run', data: { canceled } }
    }

    let result: LogResult
    if (command.type === 'history.undo') {
      result = log.undo(command.payload?.entryId)
    } else if (command.type === 'history.redo') {
      result = log.redo(command.payload?.entryId)
    } else {
      result = log.apply(command)
    }

    this.store.save(docId)
    this.execution.syncAfterCommand(docId, result.affected.nodes, result.affected.edges)
    this.hub.broadcast(docId, toAppliedMessage(result, meta.requestId))
    return { kind: 'doc', result }
  }
}

function toAppliedMessage(result: LogResult, requestId?: string): AppliedMessage {
  return {
    type: 'applied',
    requestId,
    commandId: result.commandId,
    rev: result.rev,
    patch: result.patch,
    entry: result.entry,
    history: result.history,
    discarded: result.discarded,
    undone: result.undone,
    redone: result.redone,
    changed: result.changed,
    affected: result.affected,
    created: result.created,
  }
}
