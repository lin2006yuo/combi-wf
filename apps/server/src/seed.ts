import {
  createEmptyDoc,
  type CanvasDoc,
  type CanvasNode,
  type NodeRegistry,
  type Vec2,
} from '@combi/canvas-core'

function node(
  registry: NodeRegistry,
  id: string,
  type: string,
  position: Vec2,
  label: string,
  overrides: Record<string, unknown> = {},
): CanvasNode {
  const def = registry.get(type)
  return {
    id,
    type,
    position,
    data: {
      label,
      params: { ...def.defaults, ...overrides },
    },
  }
}

/** 首次打开时的示例链路：图片 → 视频 → 组合。 */
export function createSeedDoc(docId: string, registry: NodeRegistry): CanvasDoc {
  const doc = createEmptyDoc(docId)
  const nodes: CanvasNode[] = [
    node(registry, 'n_img', 'image.gen', { x: 80, y: 260 }, '开场画面', {
      prompt: '雨夜霓虹街道，湿润地面反光，电影感，35mm',
    }),
    node(registry, 'n_vid', 'video.gen', { x: 440, y: 260 }, '镜头生成', {
      prompt: '镜头缓慢推进，雨滴划过霓虹灯牌，赛博朋克氛围',
    }),
    node(registry, 'n_out', 'compose', { x: 800, y: 240 }, '成片合成'),
  ]
  for (const item of nodes) {
    doc.nodes[item.id] = item
    doc.nodeOrder.push(item.id)
  }
  doc.edges.e_frame = {
    id: 'e_frame',
    source: 'n_img',
    sourcePort: 'image',
    target: 'n_vid',
    targetPort: 'firstFrame',
  }
  doc.edges.e_clip = {
    id: 'e_clip',
    source: 'n_vid',
    sourcePort: 'video',
    target: 'n_out',
    targetPort: 'clips',
  }
  doc.edgeOrder.push('e_frame', 'e_clip')
  return doc
}
