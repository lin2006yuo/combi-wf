import type { Source, Vec2 } from './types'

export interface CommandBase {
  /** 幂等键；不传由 core 生成。MCP 客户端重试时应复用同一个 id。 */
  id?: string
  docId?: string
  source?: Source
  actorId?: string
  ts?: number
  /** 覆盖历史面板里的默认文案 */
  label?: string
}

export interface NodeAddCommand extends CommandBase {
  type: 'node.add'
  payload: {
    node: {
      id?: string
      type: string
      position?: Vec2
      params?: Record<string, unknown>
      label?: string
    }
  }
}

export interface NodeMoveCommand extends CommandBase {
  type: 'node.move'
  payload: {
    moves: Array<{ id: string; position: Vec2 }>
  }
}

export interface NodeUpdateCommand extends CommandBase {
  type: 'node.update'
  payload: {
    id: string
    params?: Record<string, unknown>
    label?: string
  }
}

export interface NodeDeleteCommand extends CommandBase {
  type: 'node.delete'
  payload: { ids: string[] }
}

export interface EdgeConnectCommand extends CommandBase {
  type: 'edge.connect'
  payload: {
    id?: string
    source: string
    sourcePort?: string
    target: string
    targetPort?: string
  }
}

export interface EdgeDisconnectCommand extends CommandBase {
  type: 'edge.disconnect'
  payload: { ids: string[] }
}

export interface BatchCommand extends CommandBase {
  type: 'batch'
  payload: { ops: DocumentCommand[] }
}

export interface HistoryUndoCommand extends CommandBase {
  type: 'history.undo'
  payload?: { entryId?: string }
}

export interface HistoryRedoCommand extends CommandBase {
  type: 'history.redo'
  payload?: { entryId?: string }
}

export interface NodeRunCommand extends CommandBase {
  type: 'node.run'
  payload: { id: string }
}

export interface GraphRunCommand extends CommandBase {
  type: 'graph.run'
  payload?: { targetId?: string }
}

export interface JobCancelCommand extends CommandBase {
  type: 'job.cancel'
  payload: { jobId: string }
}

export type DocumentCommand =
  | NodeAddCommand
  | NodeMoveCommand
  | NodeUpdateCommand
  | NodeDeleteCommand
  | EdgeConnectCommand
  | EdgeDisconnectCommand
  | BatchCommand

export type HistoryCommand = HistoryUndoCommand | HistoryRedoCommand

export type RunCommand = NodeRunCommand | GraphRunCommand | JobCancelCommand

export type Command = DocumentCommand | HistoryCommand | RunCommand

export type DocumentCommandType = DocumentCommand['type']
export type RunCommandType = RunCommand['type']

const DOCUMENT_TYPES = new Set<string>([
  'node.add',
  'node.move',
  'node.update',
  'node.delete',
  'edge.connect',
  'edge.disconnect',
  'batch',
])

export function isDocumentCommand(cmd: Command): cmd is DocumentCommand {
  return DOCUMENT_TYPES.has(cmd.type)
}

export function isRunCommand(cmd: Command): cmd is RunCommand {
  return cmd.type === 'node.run' || cmd.type === 'graph.run' || cmd.type === 'job.cancel'
}
