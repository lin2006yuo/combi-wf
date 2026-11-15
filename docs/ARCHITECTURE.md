# Combi Flow 架构设计 v0.2

> 状态：signals 重构已完成（2026-11-15）。
> 设计基线，不是营销文档。实现边界统一记录在 `docs/STATUS.md`。

---

## 0. 一句话

把画布拆成 **文档面 / 视图面 / 执行面**；服务端拥有 **doc + change log**，前端拥有 **undo stack**；React Flow 只是 renderer adapter，节点通过 **per-record signal** 订阅。

---

## 1. 为什么不是「给画布加个 undo」

AI 短视频工作流有三个普通图编辑器没有的约束：

1. 拖拽是连续的：一次拖动几十帧，但用户心智里只有一次移动。
2. 生成是异步且花钱的：job、progress、output、stale 属于执行面。
3. Agent 没有「变更」，只有「意图」：它调用 `batch` / `move_nodes`，不是帧。

所以核心不是 undo 栈，而是先定义 **写入口、事实来源、更新粒度**。

---

## 2. 三个平面

| 平面 | 内容 | 持久化 | 进历史 | 谁写 |
|---|---|---|---|---|
| **文档面** | nodes、edges、params、label | ✅ 服务端 | ✅ | Command |
| **视图面** | position preview、selection、viewport、拖拽中间帧 | ❌ | ❌ | 客户端 Graph Runtime / React Flow |
| **执行面** | job、progress、output、stale、日志 | 独立状态 | ❌ | 执行引擎 |

硬规则：

1. 执行面不写进 `CanvasDoc` 或 `HistoryEntry`。
2. 派生状态（stale）不存历史，只存在 runtime。
3. 拖拽中间帧不出浏览器，松手才发一条 `node.move`。

---

## 3. 一致性模型

### 3.1 服务端是事实来源

```
S0 --c1--> S1 --c2--> S2 --c3--> S3 ...
```

- 服务端串行应用命令，给每条命令分配单调递增的 `seq`。
- 文档是 `CanvasDoc`，`rev` 每次成功变更 +1。
- `CommandLog` 保存每条命令的 `forward` / `inverse` patch、来源、actor、状态。
- 所有客户端从同一个 `S0` 开始，按 `seq` 应用同样的 patch，因此文档收敛。

### 3.2 前端拥有 undo stack

- 服务端不再维护全局 undo cursor。
- 客户端从 `snapshot` / `applied` 构建 `history`，`cursor` = 已应用 entry 数。
- 撤销时客户端发 `{ type: 'history.undo', payload: { entryId } }`。
- 服务端校验：目标 entry 必须是当前栈顶 applied，且没有被更新命令覆盖；通过则应用 inverse，把 entry 标为 `undone`。
- 重做：客户端发最早一条 `undone` 的 entryId；服务端应用 forward，把状态改回 `applied`。
- 新命令到来时，服务端把 redo 分支标为 `discarded`，客户端清空重做区。

这不是「前端存事实」，而是：

| 概念 | 归属 |
|---|---|
| 当前文档 | 服务端 |
| 变更日志（事实） | 服务端 |
| 撤销栈 / cursor / 分组 | 客户端 |
| 用户看到的「可撤销 / 可重做」 | 客户端 |

### 3.3 为什么这样收敛

- 文档收敛只依赖：**全序 log + 确定性 apply**。
- undo / redo 也是 log 上的受控操作，不是客户端本地回滚。
- 客户端的 cursor 不同，不会导致文档不同；它只是每个会话的视图。
- 多客户端同时撤销时，服务端串行校验；后到者返回 `OUT_OF_ORDER_UNDO`，客户端 resync。

### 3.4 尚未做的

- 离线编辑。当前是服务端权威、客户端在线。
- 多客户端/多 Agent 的字段级冲突合并。当前是 LIFO + 409。
- CRDT。如果未来离线/多人实时编辑是硬需求，再评估；业务校验仍留在 Command 层。

---

## 4. 总体架构

```
┌──────────────────────────┐        ┌──────────────────────────┐
│ Web                      │        │ External Agent           │
│ React 18 + React Flow 12 │        │ Claude / Cursor / 自研    │
│ @preact/signals-core     │        │ MCP Streamable HTTP      │
│ Graph Runtime / undo     │        │                          │
└───────────┬──────────────┘        └───────────┬──────────────┘
            │ WS: command / snapshot             │ tools/call
            │ HTTP: commands（脚本/集成）         │
            ▼                                    ▼
┌─────────────────────────────────────────────────────────────┐
│ Canvas Service (Node + Fastify)                             │
│                                                             │
│  validate → apply → append log → broadcast                  │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ CommandLog   │  │ Execution    │  │ MCP tools         │  │
│  │ doc + log    │  │ jobs / stale │  │ agent gateway     │  │
│  └──────┬───────┘  └──────┬───────┘  └───────────────────┘  │
│         │                 │                                  │
│         ▼                 ▼                                  │
│  ┌──────────────┐   ┌─────────────┐                         │
│  │ DocStore     │   │ 模拟 provider│                         │
│  │ JSON → PG    │   │ 未来：队列   │                         │
│  └──────────────┘   └─────────────┘                         │
└─────────────────────────────────────────────────────────────┘
```

关键：MCP 不直连数据库，也不直连执行引擎。它和 UI 一样是 Command 生产者。

---

## 5. 文档模型

```ts
interface CanvasDoc {
  id: string
  rev: number
  nodes: Record<NodeId, CanvasNode>
  edges: Record<EdgeId, CanvasEdge>
  nodeOrder: NodeId[]
  edgeOrder: EdgeId[]
}
```

- `nodeOrder` / `edgeOrder` 是渲染顺序，也是 `compose.clips` 的拼接顺序。
- 资产只存 URL / hash。
- `rev` 是服务端文档版本，客户端用它判断是否需要 resync。

节点类型：

| type | 输入 | 输出 | 关键参数 |
|---|---|---|---|
| `image.gen` | — | image | prompt、model、aspectRatio、seed |
| `video.gen` | image（首帧） | video | prompt、model、duration、aspectRatio、motion |
| `compose` | video（clips，多输入）、audio（music） | video | transition、resolution、bgmVolume、mute |

---

## 6. Node Registry

同一个定义驱动：属性面板、端口校验、执行器、MCP 的 `list_node_types`、默认参数。

```ts
const videoGenNode: NodeDefinition<typeof videoParams> = {
  type: 'video.gen',
  title: '视频生成',
  inputs: [{ id: 'firstFrame', label: '首帧', type: 'image', required: false }],
  outputs: [{ id: 'video', label: '视频', type: 'video' }],
  params: z.object({ prompt: z.string(), model: z.enum([...]) }),
  defaults: { ... },
  ui: { accent: '#06b6d4', icon: 'video', fields: [...] },
}
```

端口类型不兼容、单输入端口被占用、成环，都在 Command 层拒绝。

---

## 7. Command

```ts
type Command =
  | { type: 'node.add'; payload: { node: {...} } }
  | { type: 'node.move'; payload: { moves: Array<{ id, position }> } }
  | { type: 'node.update'; payload: { id, params?, label? } }
  | { type: 'node.delete'; payload: { ids: string[] } }
  | { type: 'edge.connect'; payload: {...} }
  | { type: 'edge.disconnect'; payload: { ids: string[] } }
  | { type: 'batch'; payload: { ops: DocumentCommand[] } }
  | { type: 'history.undo' | 'history.redo' }
  | { type: 'node.run' | 'graph.run' | 'job.cancel' }
```

- **意图粒度**：`node.move` 接收最终坐标数组，不是 dx/dy。
- **batch 是事务**：内部可先 add 再 connect；失败整体回滚。
- **run 不是文档命令**：由执行引擎处理，不产生历史。
- **undo/redo 也是命令**：服务端校验后应用 patch，广播给所有客户端。

校验：节点/边存在、参数过 zod、端口类型、单/多输入、自环/成环、级联删除。

---

## 8. CommandLog（服务端历史）

```ts
interface HistoryEntry {
  id: string
  seq: number
  docId: string
  type: string
  source: 'user' | 'agent' | 'undo' | 'system'
  actorId?: string
  label: string
  forward: Patch[]
  inverse: Patch[]
  nodes: string[]
  edges: string[]
  ts: number
  status: 'applied' | 'undone' | 'discarded'
}
```

- `apply`：校验 → `produceWithPatches` → 追加 entry（applied）→ 清除 redo 分支（标 discarded）。
- `undo(entryId)`：目标必须是 **最后一个 applied entry**；应用 inverse，标 undone。
- `redo(entryId)`：目标必须是 **最早一个 undone entry**；应用 forward，标 applied。
- 历史按 LIFO；客户端 cursor 是视图，服务端负责校验。
- 每个 entry 的 patch 只影响被触及的节点/边，不会全图快照。

**为什么前端不存唯一 log：**

- Agent 在浏览器关闭时也要能操作；
- 多标签页/多设备需要同一份全序；
- 审计、计费、安全需要服务端事实；
- 客户端历史可以被清缓存/篡改。

---

## 9. 客户端 Graph Runtime（signals）

### 9.1 状态分层

```
GraphState
├── nodeSignals: Map<id, Signal<CanvasNode>>       // per-record
├── runtimeSignals: Map<id, Signal<NodeRuntime>>   // per-record
├── views: Signal<Record<id, {type, position}>>    // React Flow 几何
├── edgeViews: Signal<Record<id, EdgeView>>        // React Flow 拓扑
├── nodeOrder / edgeOrder
├── history / appliedCount / canUndo / canRedo
├── selectedIds / dragPositions
├── runtimeMap / anyRunning
└── status / activity / toasts / info / tab
```

- 节点参数变化 → 只改 `nodeSignals[id]`。
- 生成进度变化 → 只改 `runtimeSignals[id]`。
- 位置变化 → 只改 `views[id]` / `dragPositions[id]`。
- 结构变化 → 改 `nodeOrder` / `edgeOrder`。
- 历史变化 → 改 `history`；`appliedCount` 由 computed 推导。

### 9.2 组件订阅

每个组件调用一次 `useSignals()`（手动模式，不用 Babel transform），然后读 hook 返回的值：

```tsx
function FlowNode({ id, selected }) {
  const { node, runtime } = useFlowNodeModel(id)
  ...
}
```

```ts
export function useFlowNodeModel(id: string) {
  useSignals()
  return {
    node: graph.nodeSignal(id)?.value,
    runtime: graph.runtimeSignal(id).value,
  }
}
```

- `useCanvasModel` 只读 `nodeOrder / edgeOrder / views / edgeViews / dragPositions / selectedIds`，**不读** node/runtime signal。
- `FlowNode` 只读自己的 node/runtime signal。
- `Toolbar` 只读 history / canUndo / canRedo / anyRunning。
- `HistoryPanel` 只读 history / appliedCount。

### 9.3 拖拽

```
pointermove
  → React Flow 内部更新位置
  → onNodesChange
  → graph.setDrag(id, position)       // 只改 dragPositions
  → Canvas 重建 nodes 数组（数据层只动一个坐标）
  → FlowNode 不重渲染（未读 dragPositions）

pointerup
  → 一条 node.move
  → 服务端 patch
  → graph.applyApplied：更新 views[id]
  → clearDrag(id)
```

拖动期间不发 WS、不写文档、不进历史。

### 9.4 为什么用 signals

- 读值即订阅，不需要 selector / shallow compare。
- `computed` 做派生（appliedCount、anyRunning），值不变不通知。
- per-record signal 让一个节点的参数/进度只影响该节点。
- `views` 把 React Flow 需要的几何和业务数据分开，避免 progress 触发全图重建。

---

## 10. 传输协议

### WebSocket

上行：

```ts
{ type: 'command'; requestId: string; command: Command }
{ type: 'resync' }
{ type: 'ping' }
```

下行：

```ts
type ServerMessage =
  | { type: 'snapshot'; doc; history; runtime }
  | { type: 'applied'; requestId?; patch; entry?; history?; discarded?; undone?; redone?; ... }
  | { type: 'runtime'; nodeId; runtime: NodeRuntime | null }
  | { type: 'command.result'; requestId?; data }
  | { type: 'command.error'; requestId?; error }
  | { type: 'toast'; level; message }
```

- `snapshot`：连接/重连/resync 全量下发；history 含 applied + undone。
- `applied`：普通命令带 `entry`；undo/redo 带完整 `history`；新命令截断 redo 时带 `discarded`。
- `runtime`：执行面，独立消息，不进 patch。
- 客户端 `requestId` 关联命令与 `applied`。

### HTTP

- `GET /api/health`
- `GET /api/info`
- `GET /api/docs/:docId`
- `GET /api/docs/:docId/runtime`
- `POST /api/docs/:docId/commands`
- `POST /mcp/:docId`

HTTP 命令同样广播给 WS 客户端。

### 认证

- `CANVAS_TOKEN` 为空时开发不校验；设置后 HTTP/WS/MCP 都带 token。
- WS 用 `?token=`，HTTP/MCP 用 `Authorization: Bearer`。
- MCP 的 `x-actor-id` 写入 `actorId`。

---

## 11. 执行面

- Job 状态机：`queued → running → succeeded/failed/canceled`。
- 当前是模拟执行器；真实实现替换 `runNode`，状态机/签名/stale/取消/事件语义不变。
- `signature = sha1(type + params + 上游 output hash)`。
- 成功后把 `inputSignature` 写进 output；之后参数/上游变化 → `stale = true`（只在 runtime）。
- 删除节点：取消任务、清 runtime。
- **undo/redo 永不自动创建 job**；恢复被删节点是 idle。

未实现：预算/额度、真实 provider、队列、缓存、run_log。

---

## 12. MCP

端点：

```
POST http://127.0.0.1:8787/mcp/main
Authorization: Bearer <CANVAS_TOKEN>
x-actor-id: agent:my-agent
```

工具：

- 读：`get_canvas`、`get_node`、`list_node_types`、`get_job`
- 写：`add_node`、`update_node`、`move_nodes`、`connect`、`disconnect`、`delete_nodes`、`batch`
- 运行：`run_node`、`run_graph`、`cancel_job`
- 撤销：`undo_my_last`（仅本 agent 的栈顶）

推荐循环：

```
list_node_types → get_canvas → batch → run_node/run_graph → get_job → get_canvas
```

安全：所有写操作走 Command 校验；历史带 source/actor；Agent 只能撤自己的栈顶；预算/幂等未实现。

---

## 13. 反模式

- ❌ 把 status / progress / output 放进 doc 或 history
- ❌ 监听 store 每次写入做历史
- ❌ 用 zundo + throttle 猜边界
- ❌ MCP 直接写数据库 / 绕过 Command
- ❌ undo 自动重新生成
- ❌ 客户端本地回滚而不经过服务端
- ❌ 文档里存 base64
- ❌ Agent 没有预算 / 审计
- ❌ 每个字段一个 signal 作为默认建模（见下）

### signal 粒度

推荐：

- **记录级**：`nodeSignal(id)` / `runtimeSignal(id)`。
- **字段级**：`computed(() => nodeSignal(id).value.data.prompt)`，组件读 computed；值不变不重渲染。
- **瞬态**：drag / hover / progress 单独 signal。

不推荐默认给每个字段开 signal：多字段原子性、历史分组、序列化、协作都会变复杂；500 节点不需要靠字段 signal 才能细粒度。

---

## 14. 当前实现边界

| 项 | 现状 | 目标 |
|---|---|---|
| 历史顺序 | LIFO | 任意点撤销 + 字段级冲突检测 |
| 冲突 | 无 | 节点/字段版本 + 409 |
| 持久化 | JSON 文件 | Postgres doc + command_log |
| 执行 | 模拟 | 队列 + provider adapter |
| 缓存/预算 | 无 | 输入 hash 缓存 + per-agent 额度 |
| 协作 | 单文档、在线 | 多用户 / 离线按需 CRDT |
| MCP 幂等 | 接受 clientRequestId，未去重 | 命令去重表 |
| Run 审计 | 无 | 独立 run_log（不进 undo） |

---

## 15. 与 v0.1 的差异

| v0.1 | v0.2 |
|---|---|
| Zustand 单一 store | `@preact/signals-core` per-record signals |
| Canvas 全量推导 nodes | views / nodeSignals / runtimeSignals 分层 |
| `dragPositions` 在全局 store | GraphState 内部 signal |
| 服务端维护全局 cursor | 服务端只存 log；客户端 cursor |
| `CanvasEngine` 含历史 | `applyDocumentCommand` + `CommandLog` |
| 历史无状态 | `applied` / `undone` / `discarded` |
| 19 tests | 20 tests |

下一阶段优先级见 `docs/STATUS.md`。
