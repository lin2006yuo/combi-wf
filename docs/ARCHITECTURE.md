# Combi Flow 架构设计

> 状态：v0.1 骨架已落地（2026-11-14）。
> 本文是设计基线，不是营销文档。实现与设计的差距统一记录在 `docs/STATUS.md`。

---

## 0. 一句话

把 AI 短视频画布拆成 **文档面 / 交互面 / 执行面** 三个平面；**Command 是唯一写入口**；历史记录命令产生的 **patch**；MCP Agent 只是另一个 Command 生产者。

---

## 1. 为什么不是「给画布加个 undo」

这个产品的 undo 有三个特殊约束，普通图形编辑器没有：

1. **拖拽是连续的**：一次拖动产生几十次 position 变更，但用户心智里只有「一次移动」。
2. **生成是异步且花钱的**：视频节点是分钟级任务，有 progress、output、stale、费用。
3. **Agent 没有「变更」，只有「意图」**：它调用的是 `move_nodes` / `batch`，不是 60 帧坐标。

如果监听 store 写入来做历史，第 1 条会让撤销栈被帧淹没；如果执行状态进入文档，第 2 条会让撤销把 `succeeded` 回滚成 `queued`，状态机直接坏掉；如果 Agent 直接改数据库，第 3 条会让它绕过校验、审计和预算。

所以核心不是「加一个 undo 栈」，而是**先定义写入口和平面边界**。

---

## 2. 三个平面

| 平面 | 内容 | 持久化 | 进 undo | 谁写 |
|---|---|---|---|---|
| **文档面** | nodes、edges、params、label、端口连接 | ✅ | ✅ | Command |
| **交互面** | selection、hover、拖拽 preview、viewport、输入框草稿、面板开合 | ❌（视图状态可按用户存） | ❌ | UI 本地 |
| **执行面** | job 状态、progress、output 资产、耗时、stale、日志 | 独立表 / 当前为内存 | ❌ | 执行引擎事件 |

三条硬规则：

1. **执行面永不写进 `CanvasDoc` 或 `HistoryEntry`。**
2. **派生状态不存历史**：`stale` 由「当前输入签名」与「产出时的输入签名」比较得到，只存在于 runtime。
3. **拖拽的中间帧不出浏览器**：松手才发一条 `node.move`。

违反第 1 条的典型症状：Agent 每 2 秒轮询一次任务，历史栈里出现几百条「修改 status」；Ctrl+Z 把正在跑的任务撤成排队。

---

## 3. 总体架构

```
┌──────────────────────────┐        ┌──────────────────────────┐
│ Web                      │        │ External Agent           │
│ React 18 + React Flow 12 │        │ Claude / Cursor / 自研    │
│ Zustand (doc/ui/runtime) │        │ MCP Streamable HTTP      │
└───────────┬──────────────┘        └───────────┬──────────────┘
            │ WS: command / snapshot             │ tools/call
            │ HTTP: commands（脚本/集成）         │
            ▼                                    ▼
┌─────────────────────────────────────────────────────────────┐
│ Canvas Service (Node + Fastify)                             │
│                                                             │
│  validate → authorize → apply → append log → broadcast      │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Command Bus  │  │ History      │  │ Execution Engine  │  │
│  │ (唯一入口)    │  │ (patch log)  │  │ (job / stale)     │  │
│  └──────┬───────┘  └──────────────┘  └─────────┬─────────┘  │
│         │                                       │            │
│         ▼                                       ▼            │
│  ┌──────────────┐                        ┌─────────────┐     │
│  │ DocStore     │  JSON（骨架）→ PG       │ 模拟 provider │     │
│  │ doc + log    │                        │ 未来：队列    │     │
│  └──────────────┘                        └─────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

关键点：**MCP 不直连数据库，也不直连执行引擎。** 它和 UI 一样，只是 Command 的生产者。

---

## 4. 文档模型

归一化存储，方便 patch、精确寻址和 Agent 操作：

```ts
interface CanvasDoc {
  id: string
  rev: number
  nodes: Record<NodeId, CanvasNode>
  edges: Record<EdgeId, CanvasEdge>
  nodeOrder: NodeId[]
  edgeOrder: EdgeId[]
}

interface CanvasNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: {
    label?: string
    params: Record<string, unknown>
  }
}

interface CanvasEdge {
  id: string
  source: string
  sourcePort: string
  target: string
  targetPort: string
}
```

- `nodeOrder` / `edgeOrder` 是渲染顺序，也是多输入端口（组合节点的 clips）的拼接顺序。
- 资产只存 URL / hash，不存 base64。
- `rev` 是服务端文档版本，每次成功命令 +1，客户端用它判断是否需要 resync。

当前节点类型：

| type | 输入 | 输出 | 关键参数 |
|---|---|---|---|
| `image.gen` | — | image | prompt、model、aspectRatio、seed |
| `video.gen` | image（首帧，可选） | video | prompt、model、duration、aspectRatio、motion |
| `compose` | video（clips，多输入、有序）、audio（music，可选） | video | transition、resolution、bgmVolume、mute |

---

## 5. Node Registry 是单一事实源

同一个定义同时驱动：属性面板、端口校验、执行器、MCP 的 `list_node_types`、默认参数。

```ts
const videoGenNode: NodeDefinition<typeof videoParams> = {
  type: 'video.gen',
  title: '视频生成',
  inputs: [{ id: 'firstFrame', label: '首帧', type: 'image', required: false }],
  outputs: [{ id: 'video', label: '视频', type: 'video' }],
  params: z.object({
    prompt: z.string().min(1),
    model: z.enum(['kling-2.1', 'runway-gen4']),
    duration: z.union([z.literal(5), z.literal(10)]),
    // ...
  }),
  defaults: { /* ... */ },
  ui: {
    accent: '#06b6d4',
    icon: 'video',
    fields: [/* 属性面板描述 */],
  },
}
```

为什么要有 `ui.fields`：zod 负责校验，但它不擅长推导「这个 enum 应该渲染成下拉、这个数字是 1–10 的滑块」。把 UI 描述留在 registry，避免每个面板手写一遍。

**组合节点**的 `clips` 端口是 `multi: true`，允许接多条边；`edgeOrder` 决定拼接顺序。端口类型不兼容、单输入端口被占用、成环，都会在 Command 层被拒绝。

---

## 6. Command 是唯一写入口

```ts
interface CommandBase {
  id?: string          // 幂等键，客户端生成
  docId?: string
  source?: 'user' | 'agent' | 'undo' | 'system'
  actorId?: string     // userId / agent session
  ts?: number
  label?: string       // 覆盖历史面板文案
}

type Command =
  | { type: 'node.add'; payload: { node: {...} } }
  | { type: 'node.move'; payload: { moves: Array<{ id, position }> } }
  | { type: 'node.update'; payload: { id, params?, label? } }
  | { type: 'node.delete'; payload: { ids: string[] } }
  | { type: 'edge.connect'; payload: { source, sourcePort?, target, targetPort? } }
  | { type: 'edge.disconnect'; payload: { ids: string[] } }
  | { type: 'batch'; payload: { ops: DocumentCommand[] } }
  | { type: 'history.undo' | 'history.redo' }
  | { type: 'node.run' | 'graph.run' | 'job.cancel' }
```

### 语义

- **意图粒度**：`moveNodes` 接收最终坐标数组，不是「dx=5」的增量。
- **一次 Command = 一次原子变更**：校验失败不会留下半个图，Immer 的 draft 直接丢弃。
- **batch 是一个事务**：内部可以「先 add 再 connect 到这个新节点」，因为校验和变更都发生在同一个 draft 上；任何一步失败，整体回滚。
- **run 命令不是文档命令**：`node.run` / `graph.run` / `job.cancel` 由执行引擎处理，不产生历史。
- **undo/redo 也是 Command**：它们由历史层转成 patch 应用，因此同样走广播、持久化和审计。

### 校验（全部在服务端）

- 节点类型存在、参数过 zod。
- 节点 / 连线存在。
- 端口存在、类型兼容（`image` 不能接 `video`）。
- 单输入端口只能一条边；多输入端口可多条。
- 禁止自环、禁止成环（DFS）。
- 删除节点级联删除相关边。

### 为什么命令里带 `source`

统一历史栈里，用户、Agent、撤销、系统操作是混在一起的。`source` 让：

- 历史面板区分「你 / Agent / 系统」。
- Agent 只能通过 `undo_my_last` 撤销自己最后一步，不能误伤用户。
- 未来的同步 / 自动优化逻辑可以过滤 `source: 'undo'`，避免「撤销触发重新生成」的死循环。

---

## 7. 历史层

### 表示：patch，不是快照

使用 Immer `produceWithPatches`，每条历史保存正向与反向 patch：

```ts
interface HistoryEntry {
  id: string
  seq: number
  docId: string
  type: string
  source: 'user' | 'agent' | 'undo' | 'system'
  actorId?: string
  label: string          // "移动 2 个节点"
  forward: Patch[]
  inverse: Patch[]
  nodes: string[]
  edges: string[]
  ts: number
}
```

为什么不用全量快照：

- 300 节点 × 100 条历史 = 30000 个节点对象常驻内存；patch 只存变化字段。
- 快照撤销通常直接替换数组，容易绕过业务事件；patch 是显式的数据变更。
- Agent 场景下需要审计和重放，patch log 本身就是操作日志。

### 边界：由意图结束定义，不由时间猜

| 操作 | 边界 |
|---|---|
| 拖节点 | `onNodeDragStart` 本地 preview → `onNodeDragStop` 发一条 `node.move` |
| 拖滑块 | pointerdown 暂停记录 → pointerup 提交（当前骨架未接滑块） |
| 打字 | 输入框本地草稿 → blur / ⌘Enter 提交一条 `node.update` |
| 删除 | 一条 `node.delete`，级联边在同一个 patch 里 |
| Agent 多步 | 一次 `batch` 工具调用 = 一个事务 = 一条历史 |
| 未来多步 UI | `txId` 分组（协议已预留，当前主要用 batch） |

**不用 `throttle` / `debounce` 猜边界。** 拖 3 秒和拖 10 秒都只产生一条；打字快慢不影响历史条数。

### 栈形态

线性历史 + cursor：

```
entries: [E1, E2, E3, E4]   cursor = 4  （全部已应用）
undo → cursor = 3
redo → cursor = 4
新命令 → 截断 cursor 之后的 E4，再 push
```

- 普通命令：`entry` 追加，`cursor++`。
- undo：应用 `entry.inverse`，`cursor--`，entry 保留供 redo。
- redo：应用 `entry.forward`，`cursor++`。
- 上限默认 100，超出丢弃最旧。
- 当前**只支持 LIFO**：显式撤销一个非栈顶 entry 会返回 `OUT_OF_ORDER_UNDO`。

### 撤销 stale entry（当前策略）

单用户 + Agent 的场景下，撤销总是栈顶，理论上不会覆盖后续修改。若未来支持点击历史面板跳到任意点，需要按字段级版本做冲突检测（见 `docs/STATUS.md` 的下一步）。

### 为什么历史在服务端

Agent 在没有浏览器的时候也会操作画布。如果历史只存在浏览器里：

- 用户关掉页面，Agent 改了图，再打开时无法撤销 Agent 的操作。
- 多标签页各自维护栈，会分叉。
- 审计日志和撤销日志变成两份。

因此服务端持有 `doc + entries + cursor`，客户端只做镜像。当前用 JSON 文件持久化，生产替换为 Postgres 的 `documents` + `command_log` 两张表即可，接口不变。

---

## 8. 传输协议

### WebSocket（Web 主通道）

上行：

```ts
{ type: 'command'; requestId: string; command: Command }
{ type: 'resync' }
{ type: 'ping' }
```

下行：

```ts
type ServerMessage =
  | { type: 'snapshot'; doc; history; cursor; runtime }
  | { type: 'applied'; requestId?; patch; entry?; history?; cursor; ... }
  | { type: 'runtime'; nodeId; runtime: NodeRuntime | null }
  | { type: 'command.result'; requestId?; data }
  | { type: 'command.error'; requestId?; error }
  | { type: 'toast'; level; message }
```

- `snapshot`：连接 / 重连 / resync 时全量下发。
- `applied`：普通命令带 `entry`，客户端 append；undo/redo 带完整 `history`，客户端替换。
- `runtime`：执行面事件，独立消息，永不混进 patch。
- 发送方通过 `requestId` 关联命令与 `applied`，同时也会收到广播并应用 patch。

### HTTP（脚本 / 外部集成）

- `GET /api/health`
- `GET /api/info`
- `GET /api/docs/:docId`
- `GET /api/docs/:docId/runtime`
- `POST /api/docs/:docId/commands` （body: `{ command }`）
- `POST /mcp/:docId` （MCP Streamable HTTP）

HTTP 命令同样会广播给 WS 客户端。

### 认证

- `CANVAS_TOKEN` 为空时开发模式不校验；设置后 HTTP / WS / MCP 都必须带 token（WS 用 `?token=`，HTTP/MCP 用 `Authorization: Bearer`）。
- MCP 的 `x-actor-id` 写入 `actorId`，当前默认 `agent:external`。生产应换成 OAuth / 每用户 token 映射。

---

## 9. 执行面

### Job 状态机

```
queued → running → succeeded
                 → failed
        → canceled（任意阶段）
```

当前是模拟执行器（`apps/server/src/execution.ts`）：260ms 后进入 running，每 ~460ms 推进 progress，约 4–6 秒完成。真实实现把 `runNode` 替换成队列 + provider adapter，**状态机、签名、stale、取消、事件语义保持不变**。

### 输入签名与 stale

```ts
signature = sha1(stableStringify({
  type,
  params,
  inputs: incomingEdges.map(e => ({
    source: e.source,
    port: e.targetPort,
    output: runtime[e.source]?.output?.hash ?? null,
  })),
}))
```

- 节点成功时把 `signature` 写进 `output.inputSignature`。
- 之后任何参数 / 上游产出的变化都会改变当前 signature。
- 当前 signature ≠ 产出时的 signature → `stale = true`，仅存在于 runtime，不进历史。
- `undo` 参数修改后，stale 会自动重新计算（因为 signature 回到旧值 → 变回 false）。

### 取消与删除

- 删除节点：先取消该节点的 running/queued job，再删除 runtime entry，广播 `runtime: null`。
- **undo/redo 永不自动创建 job**。恢复被删节点时是 idle，不是自动重跑——否则一次 Ctrl+Z 可能烧掉几十块。
- `graph.run` 按拓扑序串行执行（骨架）。生产应改为 DAG 调度，允许并行分支。

### 预算 / 缓存（未实现）

- 预算：`node.run` / `graph.run` 前检查 per-doc / per-agent 额度；昂贵操作要求确认。
- 缓存：`hash(nodeType, params, 上游输出 hash, 模型版本)` 命中则复用产出，避免 undo/redo 或重复运行重复计费。

这两项是上线前必须补的，已列入里程碑 M2/M3。

---

## 10. MCP 设计

### 端点

```
POST http://127.0.0.1:8787/mcp/main
Authorization: Bearer <CANVAS_TOKEN>   // 配置了 token 时
x-actor-id: agent:my-agent
```

使用 Streamable HTTP，无状态模式（每个请求新建 server + transport），`enableJsonResponse: true`。

### 工具

**读**

| 工具 | 说明 |
|---|---|
| `get_canvas` | 节点、连线、参数、runtime、可撤销/可重做状态 |
| `get_node` | 单节点详情 |
| `list_node_types` | 节点类型、端口、参数 JSON Schema |
| `get_job` | 任务状态 |

**写**

| 工具 | 映射 |
|---|---|
| `add_node` | `node.add` |
| `update_node` | `node.update` |
| `move_nodes` | `node.move` |
| `connect` | `edge.connect` |
| `disconnect` | `edge.disconnect` |
| `delete_nodes` | `node.delete` |
| `batch` | `batch`（一次事务） |
| `run_node` | `node.run` |
| `run_graph` | `graph.run` |
| `cancel_job` | `job.cancel` |
| `undo_my_last` | 仅撤销本 agent 的栈顶 |

### 推荐的 Agent 循环

```
1. list_node_types        → 了解可用节点与参数 schema
2. get_canvas             → 读取当前 rev / 节点 / 端口
3. batch                  → 意图级多步操作（一条历史）
4. run_node / run_graph   → 拿 jobId
5. get_job 轮询           → 直到 succeeded / failed
6. get_canvas             → 确认产出与 stale
```

### 安全边界

- **不直连存储**：所有写操作经过 Command 校验。
- **actor 审计**：每条历史带 `actorId`，UI 能显示「Agent 修改了 B.prompt」。
- **只撤自己**：`undo_my_last` 检查栈顶 `source === 'agent' && actorId === 当前 agent`，否则拒绝。
- **幂等键**：工具接受 `clientRequestId` 作为 command id（服务端去重尚未实现，见 STATUS）。
- **预算**：未实现，Agent 触发的生成目前没有额度上限——上线前必须补。

### 两种 MCP 方向

1. **我们作为 MCP Server**（已实现）：外部 Agent 操作画布。
2. **我们作为 MCP Client**（未实现）：用户配置外部工具（视频模型、素材库）作为节点执行器。这属于 provider adapter，不影响画布 / 历史架构。

---

## 11. 前端实现

- React 18 + `@xyflow/react` v12 受控模式，`nodes/edges` 从 Zustand 派生。
- 拖拽：`onNodesChange` 的 position 变化只写入 `dragPositions`（交互面）；`onNodeDragStop` 合并成一条 `node.move`，ack 后清除本地 preview。
- 文本：属性面板用非受控输入，blur 时提交；不在每次 keystroke 写 store。
- 选中态在 `ui`，不进入文档。
- `deleteKeyCode={null}`：删除键由我们处理，必须走 `node.delete` Command，不能绕过历史。
- 连线：`onConnect` → `edge.connect`；`isValidConnection` 做端口类型预检，服务端仍是最终权威。
- 撤销/重做：⌘Z / ⇧⌘Z / Ctrl+Y，发送 `history.undo/redo`，不在客户端本地回滚。
- 断线：自动重连 + snapshot 全量恢复；pending 命令 reject。

**不用 zundo。** 它是时间/快照驱动的，和「显式事务 + Agent 共用命令日志」的架构冲突。

---

## 12. 并发与一致性

当前：

- 服务端串行应用命令，全局 `rev` 单调递增。
- 客户端通过 WS 接收所有变更，按序应用 patch。
- 多标签页天然一致（同一份命令日志）。
- 用户与 Agent 同时在操作时，最后到达服务端的命令获胜（last-write-wins）。

未实现：

- 字段级 `baseVersion` / 乐观锁。Agent 在 t1 读到 prompt，t2 用户改了 prompt，t3 Agent 基于旧值写回会覆盖用户。
- 多用户实时协作（Yjs / CRDT）。
- 冲突时的三方合并。

这些在单人 + 单 Agent 的 MVP 中可以接受，但多 Agent 或多用户前必须补齐。CRDT 不是万能：它的静默合并与「校验后拒绝非法命令」语义冲突，业务校验仍要留在 Command 层。

---

## 13. 反模式清单

- ❌ 把 `status / progress / output` 放进 `CanvasDoc` 或 `HistoryEntry`
- ❌ 监听 store 每次写入做历史（60 帧问题）
- ❌ 用 `zundo` + `throttle` 猜边界
- ❌ MCP 工具直接写数据库 / 绕过 Command 校验
- ❌ undo 自动重新执行生成任务（费用爆炸）
- ❌ 客户端本地回滚而不经过服务端（多端分叉）
- ❌ 文档里存 base64 资产
- ❌ Agent 没有 actor、预算、审计

---

## 14. 当前实现的边界

| 项 | 现状 | 目标 |
|---|---|---|
| 历史顺序 | 严格 LIFO | 支持任意 entry 撤销 + 字段级冲突检测 |
| 冲突 | 无 | 字段级版本 / 409 + rebase |
| 持久化 | JSON 文件 | Postgres 文档 + command_log |
| 执行 | 内存模拟 | 队列 + provider adapter + 重试 |
| 缓存 / 预算 | 无 | 输入 hash 缓存 + per-agent 额度 |
| 协作 | 单文档 last-write-wins | 多用户 / 多 Agent，按需 CRDT |
| MCP 幂等 | 只接受 clientRequestId，未去重 | 命令级去重表 |
| Run 命令审计 | 无历史 | 独立 run_log（不进 undo） |

---

## 15. 与初版讨论的差异

初版方案里提到「按 source 过滤栈 / 字段级冲突 / Yjs」。v0.1 刻意做了减法：

- **统一栈 + source 标记**，不做分栈：实现简单，UI 可见，Agent 的 `undo_my_last` 用栈顶检查即可。
- **LIFO**，不做任意点撤销：先保证「一次意图 = 一条历史」和「Agent 与用户共用一条栈」正确，再谈随机跳转。
- **服务端命令日志**从第一天就做：因为 Agent 在没有浏览器时也会写，这个不能后补。
- **执行器模拟**：先把状态机、签名、stale、取消的语义跑通，真实 provider 只是替换 `finish()` 里的产出逻辑。

下一阶段的优先级见 `docs/STATUS.md`。
