export type CanvasErrorCode =
  | 'INVALID_COMMAND'
  | 'INVALID_PARAMS'
  | 'NODE_TYPE_UNKNOWN'
  | 'NODE_NOT_FOUND'
  | 'EDGE_NOT_FOUND'
  | 'DUPLICATE_ID'
  | 'DUPLICATE_EDGE'
  | 'PORT_NOT_FOUND'
  | 'PORT_OCCUPIED'
  | 'TYPE_MISMATCH'
  | 'SELF_LOOP'
  | 'CYCLE'
  | 'NOTHING_TO_UNDO'
  | 'NOTHING_TO_REDO'
  | 'OUT_OF_ORDER_UNDO'
  | 'INVALID_BATCH'

export class CanvasError extends Error {
  readonly code: CanvasErrorCode
  readonly details?: unknown

  constructor(code: CanvasErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'CanvasError'
    this.code = code
    this.details = details
  }
}

export function isCanvasError(value: unknown): value is CanvasError {
  return value instanceof CanvasError
}
