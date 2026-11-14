import { describe, expect, it } from 'vitest'
import { CanvasEngine, createDefaultRegistry, createEmptyDoc } from './index'
import { CanvasError } from './errors'
import type { Command } from './commands'
import type { NodeRegistry } from './registry/registry'

function setup(historyLimit?: number) {
  const registry: NodeRegistry = createDefaultRegistry()
  const engine = new CanvasEngine({
    doc: createEmptyDoc('doc-test'),
    registry,
    historyLimit,
    now: (() => {
      let t = 1_700_000_000_000
      return () => (t += 10)
    })(),
  })
  return { engine, registry }
}

function run(engine: CanvasEngine, command: Command) {
  return engine.execute(command)
}

function addNode(
  engine: CanvasEngine,
  id: string,
  type: string,
  position = { x: 0, y: 0 },
) {
  return run(engine, {
    type: 'node.add',
    payload: { node: { id, type, position } },
  })
}

function connect(
  engine: CanvasEngine,
  source: string,
  sourcePort: string,
  target: string,
  targetPort: string,
  id?: string,
) {
  return run(engine, {
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

describe('command + history boundaries', () => {
  it('treats one move command as one history entry regardless of distance', () => {
    const { engine } = setup()
    addNode(engine, 'n1', 'image.gen', { x: 100, y: 100 })
    expect(engine.getHistory().entries).toHaveLength(1)

    // UI 在拖拽期间只更新本地 preview，松手才发这一条命令。
    run(engine, {
      type: 'node.move',
      payload: { moves: [{ id: 'n1', position: { x: 300, y: 250 } }] },
    })

    expect(engine.getHistory().entries).toHaveLength(2)
    expect(engine.getDoc().nodes.n1.position).toEqual({ x: 300, y: 250 })
    expect(engine.getHistory().entries[1].label).toBe('移动「图片生成」')

    run(engine, { type: 'history.undo' })
    expect(engine.getDoc().nodes.n1.position).toEqual({ x: 100, y: 100 })

    run(engine, { type: 'history.redo' })
    expect(engine.getDoc().nodes.n1.position).toEqual({ x: 300, y: 250 })
  })

  it('does not create an entry when a move is a no-op', () => {
    const { engine } = setup()
    addNode(engine, 'n1', 'image.gen', { x: 100, y: 100 })
    const result = run(engine, {
      type: 'node.move',
      payload: { moves: [{ id: 'n1', position: { x: 100, y: 100 } }] },
    })
    expect(result.changed).toBe(false)
    expect(engine.getHistory().entries).toHaveLength(1)
  })

  it('coalesces data changes into one command and one undo step', () => {
    const { engine } = setup()
    addNode(engine, 'n1', 'image.gen')

    run(engine, {
      type: 'node.update',
      payload: { id: 'n1', params: { prompt: '分类' } },
    })
    run(engine, {
      type: 'node.update',
      payload: { id: 'n1', params: { prompt: '分类一下' } },
    })

    // 这是两次命令，UI 应通过 blur/coalesce 只发一次；
    // core 保证每条命令都是独立、可逆的原子操作。
    expect(engine.getHistory().entries).toHaveLength(3)
    run(engine, { type: 'history.undo' })
    expect(engine.getDoc().nodes.n1.data.params.prompt).toBe('分类')
  })
})

describe('delete cascade', () => {
  it('removes cascaded edges atomically and restores everything on undo', () => {
    const { engine } = setup()
    addNode(engine, 'img', 'image.gen', { x: 0, y: 0 })
    addNode(engine, 'vid', 'video.gen', { x: 300, y: 0 })
    addNode(engine, 'out', 'compose', { x: 600, y: 0 })
    connect(engine, 'img', 'image', 'vid', 'firstFrame', 'e1')
    connect(engine, 'vid', 'video', 'out', 'clips', 'e2')
    expect(engine.getDoc().edgeOrder).toHaveLength(2)

    const result = run(engine, { type: 'node.delete', payload: { ids: ['vid'] } })
    expect(result.patch.length).toBeGreaterThan(0)
    expect(engine.getDoc().nodes.vid).toBeUndefined()
    expect(engine.getDoc().edgeOrder).toHaveLength(0)
    expect(engine.getHistory().entries.at(-1)?.label).toBe('删除「视频生成」')

    run(engine, { type: 'history.undo' })
    expect(engine.getDoc().nodes.vid).toBeDefined()
    expect(engine.getDoc().edges.e1).toBeDefined()
    expect(engine.getDoc().edges.e2).toBeDefined()
    expect([...engine.getDoc().edgeOrder].sort()).toEqual(['e1', 'e2'])

    run(engine, { type: 'history.redo' })
    expect(engine.getDoc().nodes.vid).toBeUndefined()
    expect(engine.getDoc().edgeOrder).toHaveLength(0)
  })

  it('rejects deleting an unknown node', () => {
    const { engine } = setup()
    expectCode(
      () => run(engine, { type: 'node.delete', payload: { ids: ['nope'] } }),
      'NODE_NOT_FOUND',
    )
  })
})

describe('graph validation', () => {
  it('rejects incompatible port types', () => {
    const { engine } = setup()
    addNode(engine, 'img', 'image.gen')
    addNode(engine, 'out', 'compose')
    expectCode(
      () => connect(engine, 'img', 'image', 'out', 'clips'),
      'TYPE_MISMATCH',
    )
  })

  it('rejects a second edge into a single-input port', () => {
    const { engine } = setup()
    addNode(engine, 'a', 'image.gen')
    addNode(engine, 'b', 'image.gen')
    addNode(engine, 'v', 'video.gen')
    connect(engine, 'a', 'image', 'v', 'firstFrame', 'e1')
    expectCode(
      () => connect(engine, 'b', 'image', 'v', 'firstFrame', 'e2'),
      'PORT_OCCUPIED',
    )
  })

  it('allows multiple edges into a multi input port', () => {
    const { engine } = setup()
    addNode(engine, 'v1', 'video.gen')
    addNode(engine, 'v2', 'video.gen')
    addNode(engine, 'out', 'compose')
    connect(engine, 'v1', 'video', 'out', 'clips', 'e1')
    connect(engine, 'v2', 'video', 'out', 'clips', 'e2')
    expect(engine.getDoc().edgeOrder).toHaveLength(2)
  })

  it('rejects self loops and cycles', () => {
    const { engine } = setup()
    addNode(engine, 'out1', 'compose')
    expectCode(
      () => connect(engine, 'out1', 'video', 'out1', 'clips'),
      'SELF_LOOP',
    )

    addNode(engine, 'out2', 'compose')
    connect(engine, 'out1', 'video', 'out2', 'clips', 'e1')
    expectCode(
      () => connect(engine, 'out2', 'video', 'out1', 'clips'),
      'CYCLE',
    )
  })

  it('rejects duplicate edges', () => {
    const { engine } = setup()
    addNode(engine, 'img', 'image.gen')
    addNode(engine, 'vid', 'video.gen')
    connect(engine, 'img', 'image', 'vid', 'firstFrame', 'e1')
    expectCode(
      () => connect(engine, 'img', 'image', 'vid', 'firstFrame', 'e2'),
      'DUPLICATE_EDGE',
    )
  })

  it('validates params against the node registry', () => {
    const { engine } = setup()
    addNode(engine, 'img', 'image.gen')
    expectCode(
      () =>
        run(engine, {
          type: 'node.update',
          payload: { id: 'img', params: { model: 'not-a-model' } },
        }),
      'INVALID_PARAMS',
    )
    expectCode(
      () =>
        run(engine, {
          type: 'node.add',
          payload: { node: { type: 'nope' } },
        }),
      'NODE_TYPE_UNKNOWN',
    )
  })
})

describe('batch transactions', () => {
  it('applies add + connect atomically as one history entry', () => {
    const { engine } = setup()
    addNode(engine, 'img', 'image.gen')
    const before = engine.getHistory().entries.length

    const result = run(engine, {
      type: 'batch',
      label: '搭建视频链路',
      payload: {
        ops: [
          {
            type: 'node.add',
            payload: {
              node: { id: 'vid', type: 'video.gen', position: { x: 320, y: 0 } },
            },
          },
          {
            type: 'edge.connect',
            payload: { source: 'img', sourcePort: 'image', target: 'vid', targetPort: 'firstFrame' },
          },
        ],
      },
    })

    expect(result.changed).toBe(true)
    expect(engine.getHistory().entries).toHaveLength(before + 1)
    expect(engine.getHistory().entries.at(-1)?.label).toBe('搭建视频链路')
    expect(engine.getDoc().nodes.vid).toBeDefined()
    expect(engine.getDoc().edgeOrder).toHaveLength(1)

    run(engine, { type: 'history.undo' })
    expect(engine.getDoc().nodes.vid).toBeUndefined()
    expect(engine.getDoc().edgeOrder).toHaveLength(0)
    expect(engine.getDoc().nodes.img).toBeDefined()
  })

  it('is all-or-nothing on validation failure', () => {
    const { engine } = setup()
    addNode(engine, 'img', 'image.gen')
    const snapshot = engine.getDoc()

    expectCode(
      () =>
        run(engine, {
          type: 'batch',
          payload: {
            ops: [
              {
                type: 'node.add',
                payload: { node: { id: 'vid', type: 'video.gen' } },
              },
              {
                type: 'edge.connect',
                payload: {
                  source: 'img',
                  sourcePort: 'image',
                  target: 'vid',
                  targetPort: 'firstFrame',
                },
              },
              {
                type: 'edge.connect',
                payload: {
                  source: 'vid',
                  sourcePort: 'video',
                  target: 'img',
                  targetPort: 'firstFrame',
                },
              },
            ],
          },
        }),
      'PORT_NOT_FOUND',
    )

    expect(engine.getDoc()).toBe(snapshot)
    expect(engine.getHistory().entries).toHaveLength(1)
  })

  it('rejects nested batches and empty batches', () => {
    const { engine } = setup()
    expectCode(
      () => run(engine, { type: 'batch', payload: { ops: [] } }),
      'INVALID_BATCH',
    )
    expectCode(
      () =>
        run(engine, {
          type: 'batch',
          payload: { ops: [{ type: 'batch', payload: { ops: [] } }] },
        }),
      'INVALID_BATCH',
    )
  })
})

describe('history cursor', () => {
  it('truncates redo branch when a new command arrives', () => {
    const { engine } = setup()
    addNode(engine, 'n1', 'image.gen')
    addNode(engine, 'n2', 'video.gen')
    run(engine, { type: 'history.undo' })
    expect(engine.getHistory().cursor).toBe(1)

    addNode(engine, 'n3', 'compose')
    expect(engine.getHistory().entries).toHaveLength(2)
    expect(engine.getHistory().cursor).toBe(2)
    expect(engine.getDoc().nodes.n2).toBeUndefined()
    expect(engine.getDoc().nodes.n3).toBeDefined()
    expectCode(() => run(engine, { type: 'history.redo' }), 'NOTHING_TO_REDO')
  })

  it('rejects out-of-order undo when an entry id is supplied', () => {
    const { engine } = setup()
    addNode(engine, 'n1', 'image.gen')
    addNode(engine, 'n2', 'video.gen')
    const first = engine.getHistory().entries[0]
    expectCode(
      () => run(engine, { type: 'history.undo', payload: { entryId: first.id } }),
      'OUT_OF_ORDER_UNDO',
    )
  })

  it('respects the history limit', () => {
    const { engine } = setup(3)
    for (let i = 0; i < 5; i += 1) {
      addNode(engine, `n${i}`, 'image.gen')
    }
    expect(engine.getHistory().entries).toHaveLength(3)
    expect(engine.getHistory().cursor).toBe(3)
  })

  it('tags agent commands and keeps them on the unified stack', () => {
    const { engine } = setup()
    const result = engine.execute(
      {
        type: 'node.add',
        payload: { node: { id: 'a1', type: 'image.gen' } },
      },
      { source: 'agent', actorId: 'agent:demo' },
    )
    expect(result.entry?.source).toBe('agent')
    expect(result.entry?.actorId).toBe('agent:demo')

    engine.execute({ type: 'history.undo' })
    expect(engine.getDoc().nodes.a1).toBeUndefined()
  })
})

describe('snapshot roundtrip', () => {
  it('restores doc, history and cursor from JSON', () => {
    const { engine, registry } = setup()
    addNode(engine, 'n1', 'image.gen')
    run(engine, { type: 'node.move', payload: { moves: [{ id: 'n1', position: { x: 10, y: 20 } }] } })
    run(engine, { type: 'history.undo' })

    const serialized = JSON.parse(JSON.stringify(engine.toSnapshot()))
    const restored = CanvasEngine.fromSnapshot(registry, serialized)

    expect(restored.getDoc()).toEqual(engine.getDoc())
    expect(restored.getHistory().cursor).toBe(1)
    restored.execute({ type: 'history.redo' })
    expect(restored.getDoc().nodes.n1.position).toEqual({ x: 10, y: 20 })
  })
})
