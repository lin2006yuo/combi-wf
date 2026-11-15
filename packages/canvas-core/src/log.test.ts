import { describe, expect, it } from 'vitest'
import { CommandLog } from './log'
import { createDefaultRegistry } from './registry/nodes'
import { createEmptyDoc } from './doc'
import { CanvasError } from './errors'
import type { DocumentCommand } from './commands'
import type { NodeRegistry } from './registry/registry'

function setup() {
  const registry: NodeRegistry = createDefaultRegistry()
  let tick = 1_700_000_000_000
  const log = new CommandLog({
    doc: createEmptyDoc('doc-test'),
    registry,
    now: () => (tick += 10),
  })
  return { log, registry }
}

function addNode(log: CommandLog, id: string, type: string, position = { x: 0, y: 0 }) {
  return log.apply({
    type: 'node.add',
    payload: { node: { id, type, position } },
  })
}

function connect(
  log: CommandLog,
  source: string,
  sourcePort: string,
  target: string,
  targetPort: string,
  id?: string,
) {
  return log.apply({
    type: 'edge.connect',
    payload: { id, source, sourcePort, target, targetPort },
  })
}

function expectCode(fn: () => unknown, code: string) {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(CanvasError)
    expect((error as CanvasError).code).toBe(code)
    return
  }
  throw new Error(`expected CanvasError(${code}) but nothing was thrown`)
}

describe('command log + history boundaries', () => {
  it('treats one move command as one history entry regardless of distance', () => {
    const { log } = setup()
    addNode(log, 'n1', 'image.gen', { x: 100, y: 100 })
    expect(log.getHistory()).toHaveLength(1)

    log.apply({
      type: 'node.move',
      payload: { moves: [{ id: 'n1', position: { x: 300, y: 250 } }] },
    })

    expect(log.getHistory()).toHaveLength(2)
    expect(log.getDoc().nodes.n1.position).toEqual({ x: 300, y: 250 })
    expect(log.getHistory()[1].label).toBe('移动「图片生成」')

    log.undo()
    expect(log.getDoc().nodes.n1.position).toEqual({ x: 100, y: 100 })

    log.redo()
    expect(log.getDoc().nodes.n1.position).toEqual({ x: 300, y: 250 })
  })

  it('does not create an entry when a move is a no-op', () => {
    const { log } = setup()
    addNode(log, 'n1', 'image.gen', { x: 100, y: 100 })
    const result = log.apply({
      type: 'node.move',
      payload: { moves: [{ id: 'n1', position: { x: 100, y: 100 } }] },
    })
    expect(result.changed).toBe(false)
    expect(log.getHistory()).toHaveLength(1)
  })

  it('keeps each write as an independent atomic entry', () => {
    const { log } = setup()
    addNode(log, 'n1', 'image.gen')
    log.apply({ type: 'node.update', payload: { id: 'n1', params: { prompt: '分类' } } })
    log.apply({ type: 'node.update', payload: { id: 'n1', params: { prompt: '分类一下' } } })

    expect(log.getHistory()).toHaveLength(3)
    log.undo()
    expect(log.getDoc().nodes.n1.data.params.prompt).toBe('分类')
  })
})

describe('delete cascade', () => {
  it('removes cascaded edges atomically and restores everything on undo', () => {
    const { log } = setup()
    addNode(log, 'img', 'image.gen', { x: 0, y: 0 })
    addNode(log, 'vid', 'video.gen', { x: 300, y: 0 })
    addNode(log, 'out', 'compose', { x: 600, y: 0 })
    connect(log, 'img', 'image', 'vid', 'firstFrame', 'e1')
    connect(log, 'vid', 'video', 'out', 'clips', 'e2')
    expect(log.getDoc().edgeOrder).toHaveLength(2)

    const result = log.apply({ type: 'node.delete', payload: { ids: ['vid'] } })
    expect(result.patch.length).toBeGreaterThan(0)
    expect(log.getDoc().nodes.vid).toBeUndefined()
    expect(log.getDoc().edgeOrder).toHaveLength(0)
    expect(log.getHistory().at(-1)?.label).toBe('删除「视频生成」')

    log.undo()
    expect(log.getDoc().nodes.vid).toBeDefined()
    expect(log.getDoc().edges.e1).toBeDefined()
    expect(log.getDoc().edges.e2).toBeDefined()
    expect([...log.getDoc().edgeOrder].sort()).toEqual(['e1', 'e2'])

    log.redo()
    expect(log.getDoc().nodes.vid).toBeUndefined()
    expect(log.getDoc().edgeOrder).toHaveLength(0)
  })

  it('rejects deleting an unknown node', () => {
    const { log } = setup()
    expectCode(() => log.apply({ type: 'node.delete', payload: { ids: ['nope'] } }), 'NODE_NOT_FOUND')
  })
})

describe('graph validation', () => {
  it('rejects incompatible port types', () => {
    const { log } = setup()
    addNode(log, 'img', 'image.gen')
    addNode(log, 'out', 'compose')
    expectCode(() => connect(log, 'img', 'image', 'out', 'clips'), 'TYPE_MISMATCH')
  })

  it('rejects a second edge into a single-input port', () => {
    const { log } = setup()
    addNode(log, 'a', 'image.gen')
    addNode(log, 'b', 'image.gen')
    addNode(log, 'v', 'video.gen')
    connect(log, 'a', 'image', 'v', 'firstFrame', 'e1')
    expectCode(() => connect(log, 'b', 'image', 'v', 'firstFrame', 'e2'), 'PORT_OCCUPIED')
  })

  it('allows multiple edges into a multi input port', () => {
    const { log } = setup()
    addNode(log, 'v1', 'video.gen')
    addNode(log, 'v2', 'video.gen')
    addNode(log, 'out', 'compose')
    connect(log, 'v1', 'video', 'out', 'clips', 'e1')
    connect(log, 'v2', 'video', 'out', 'clips', 'e2')
    expect(log.getDoc().edgeOrder).toHaveLength(2)
  })

  it('rejects self loops and cycles', () => {
    const { log } = setup()
    addNode(log, 'out1', 'compose')
    expectCode(() => connect(log, 'out1', 'video', 'out1', 'clips'), 'SELF_LOOP')

    addNode(log, 'out2', 'compose')
    connect(log, 'out1', 'video', 'out2', 'clips', 'e1')
    expectCode(() => connect(log, 'out2', 'video', 'out1', 'clips'), 'CYCLE')
  })

  it('rejects duplicate edges', () => {
    const { log } = setup()
    addNode(log, 'img', 'image.gen')
    addNode(log, 'vid', 'video.gen')
    connect(log, 'img', 'image', 'vid', 'firstFrame', 'e1')
    expectCode(() => connect(log, 'img', 'image', 'vid', 'firstFrame', 'e2'), 'DUPLICATE_EDGE')
  })

  it('validates params against the node registry', () => {
    const { log } = setup()
    addNode(log, 'img', 'image.gen')
    expectCode(
      () => log.apply({ type: 'node.update', payload: { id: 'img', params: { model: 'nope' } } }),
      'INVALID_PARAMS',
    )
    expectCode(
      () => log.apply({ type: 'node.add', payload: { node: { type: 'nope' } } }),
      'NODE_TYPE_UNKNOWN',
    )
  })
})

describe('batch transactions', () => {
  it('applies add + connect atomically as one history entry', () => {
    const { log } = setup()
    addNode(log, 'img', 'image.gen')
    const before = log.getHistory().length

    const command: DocumentCommand = {
      type: 'batch',
      label: '搭建视频链路',
      payload: {
        ops: [
          {
            type: 'node.add',
            payload: { node: { id: 'vid', type: 'video.gen', position: { x: 320, y: 0 } } },
          },
          {
            type: 'edge.connect',
            payload: { source: 'img', sourcePort: 'image', target: 'vid', targetPort: 'firstFrame' },
          },
        ],
      },
    }
    const result = log.apply(command)

    expect(result.changed).toBe(true)
    expect(log.getHistory()).toHaveLength(before + 1)
    expect(log.getHistory().at(-1)?.label).toBe('搭建视频链路')
    expect(log.getDoc().nodes.vid).toBeDefined()
    expect(log.getDoc().edgeOrder).toHaveLength(1)

    log.undo()
    expect(log.getDoc().nodes.vid).toBeUndefined()
    expect(log.getDoc().edgeOrder).toHaveLength(0)
    expect(log.getDoc().nodes.img).toBeDefined()
  })

  it('is all-or-nothing on validation failure', () => {
    const { log } = setup()
    addNode(log, 'img', 'image.gen')
    const snapshot = log.getDoc()

    const command: DocumentCommand = {
      type: 'batch',
      payload: {
        ops: [
          { type: 'node.add', payload: { node: { id: 'vid', type: 'video.gen' } } },
          {
            type: 'edge.connect',
            payload: { source: 'img', sourcePort: 'image', target: 'vid', targetPort: 'firstFrame' },
          },
          {
            type: 'edge.connect',
            payload: { source: 'vid', sourcePort: 'video', target: 'img', targetPort: 'firstFrame' },
          },
        ],
      },
    }
    expectCode(() => log.apply(command), 'PORT_NOT_FOUND')
    expect(log.getDoc()).toBe(snapshot)
    expect(log.getHistory()).toHaveLength(1)
  })

  it('rejects nested batches and empty batches', () => {
    const { log } = setup()
    expectCode(
      () => log.apply({ type: 'batch', payload: { ops: [] } } as DocumentCommand),
      'INVALID_BATCH',
    )
    expectCode(
      () =>
        log.apply({
          type: 'batch',
          payload: { ops: [{ type: 'batch', payload: { ops: [] } }] },
        } as DocumentCommand),
      'INVALID_BATCH',
    )
  })
})

describe('undo / redo stack', () => {
  it('discards the redo branch when a new command arrives', () => {
    const { log } = setup()
    addNode(log, 'n1', 'image.gen')
    addNode(log, 'n2', 'video.gen')
    log.undo()
    expect(log.getHistory().filter((entry) => entry.status === 'applied')).toHaveLength(1)

    const result = addNode(log, 'n3', 'compose')
    expect(result.discarded).toHaveLength(1)
    expect(log.getHistory()).toHaveLength(2)
    expect(log.getDoc().nodes.n2).toBeUndefined()
    expect(log.getDoc().nodes.n3).toBeDefined()
    expectCode(() => log.redo(), 'NOTHING_TO_REDO')
  })

  it('rejects out-of-order undo', () => {
    const { log } = setup()
    addNode(log, 'n1', 'image.gen')
    addNode(log, 'n2', 'video.gen')
    const first = log.getHistory()[0]
    expectCode(() => log.undo(first.id), 'OUT_OF_ORDER_UNDO')
  })

  it('redoes undone entries in chronological order', () => {
    const { log } = setup()
    addNode(log, 'n1', 'image.gen')
    addNode(log, 'n2', 'video.gen')
    addNode(log, 'n3', 'compose')

    const entries = log.getHistory()
    const second = entries[1]
    const third = entries[2]

    log.undo(third.id)
    log.undo(second.id)
    expect(log.getDoc().nodes.n2).toBeUndefined()
    expect(log.getDoc().nodes.n3).toBeUndefined()

    expectCode(() => log.redo(third.id), 'OUT_OF_ORDER_REDO')
    log.redo(second.id)
    expect(log.getDoc().nodes.n2).toBeDefined()
    log.redo(third.id)
    expect(log.getDoc().nodes.n3).toBeDefined()
  })

  it('tags agent commands and keeps them on the unified stack', () => {
    const { log } = setup()
    const result = log.apply({
      type: 'node.add',
      source: 'agent',
      actorId: 'agent:demo',
      payload: { node: { id: 'a1', type: 'image.gen' } },
    })
    expect(result.entry?.source).toBe('agent')
    expect(result.entry?.actorId).toBe('agent:demo')

    log.undo()
    expect(log.getDoc().nodes.a1).toBeUndefined()
  })

  it('rejects undo/redo when the stack is empty', () => {
    const { log } = setup()
    expectCode(() => log.undo(), 'NOTHING_TO_UNDO')
    expectCode(() => log.redo(), 'NOTHING_TO_REDO')
  })
})

describe('snapshot roundtrip', () => {
  it('restores doc, history and statuses from JSON', () => {
    const { log, registry } = setup()
    addNode(log, 'n1', 'image.gen')
    log.apply({ type: 'node.move', payload: { moves: [{ id: 'n1', position: { x: 10, y: 20 } }] } })
    log.undo()

    const serialized = JSON.parse(JSON.stringify(log.toSnapshot()))
    const restored = CommandLog.fromSnapshot(registry, serialized)

    expect(restored.getDoc()).toEqual(log.getDoc())
    expect(restored.getHistory().map((entry) => entry.status)).toEqual(['applied', 'undone'])
    restored.redo()
    expect(restored.getDoc().nodes.n1.position).toEqual({ x: 10, y: 20 })
  })
})
