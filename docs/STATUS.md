# 项目状态 · 2026-11-14

> 版本：v0.1.0 骨架
> 分支：`main`（初始提交）
> 设计基线：[`docs/ARCHITECTURE.md`](./ARCHITECTURE.md)

---

## 1. 一句话

一个可运行的 AI 短视频工作流骨架：React Flow 画布 + Command/History 内核 + 服务端命令日志 + 模拟执行引擎 + 可用的 MCP Agent 入口。

当前已经能演示三件关键的事：

1. 拖动 3 秒（几十帧）只产生 **1 条**历史，Ctrl+Z 一次回到起点。
2. 外部 Agent 通过 MCP 用一次 `batch` 搭建一条链路，用户按 Ctrl+Z 能整体撤销。
3. 生成进度、输出、stale 只走执行面，**不进入**撤销栈。

![画布](./assets/canvas.png)

---

## 2. 已落地

### 2.1 `packages/canvas-core`

纯 TypeScript，不依赖浏览器 / Node 内置模块（可被 Web、Server、测试共用）。

- [x] `CanvasDoc` 归一化模型、`NodeRuntime` / `HistoryEntry` 类型
- [x] Node Registry + 三种节点定义（`image.gen` / `video.gen` / `compose`）
- [x] zod 参数校验、端口类型校验、单/多输入约束、自环/成环检测
- [x] 文档命令：add / move / update / delete / connect / disconnect / batch
- [x] 删除节点级联删边，undo 原子恢复
- [x] Immer patch 历史、cursor、redo 分支截断、历史上限
- [x] undo / redo 作为 Command
- [x] `source` / `actorId` / `label` / 幂等 id 字段
- [x] 19 个单元测试

### 2.2 `apps/server`

- [x] Fastify 5 + CORS + WebSocket
- [x] 文档快照 / 命令 / runtime 的 HTTP API
- [x] WS 协议：snapshot / applied / runtime / command.error / resync
- [x] 多标签页广播；HTTP 命令也会广播给 WS 客户端
- [x] JSON 文件持久化（doc + history patch + cursor）
- [x] 模拟执行引擎：queued → running → succeeded、progress、取消
- [x] 输入签名（参数 + 上游输出 hash）、stale 派生
- [x] 删除节点时取消任务、清 runtime
- [x] 本地 SVG mock 资产（不依赖外网图床）
- [x] MCP Server（Streamable HTTP，无状态）
- [x] 15 个 MCP 工具：读、写、batch、run、job、undo_my_last
- [x] 可选 Bearer token（HTTP / WS / MCP）
- [x] 端到端 demo 脚本 `scripts/agent-demo.ts`

### 2.3 `apps/web`

- [x] React 18 + Vite + Zustand + React Flow 12（受控）
- [x] 自定义节点：参数摘要、runtime 状态、progress、输出预览、stale 徽标、端口颜色
- [x] 拖拽本地 preview → 松手一条命令
- [x] 属性面板：失焦提交，select / switch / number / textarea
- [x] 历史面板：source 标签、已撤销态、cursor 标记
- [x] 动态面板：命令 / 撤销 / 生成状态汇总
- [x] 工具栏：撤销、重做、运行工作流、连接状态、rev
- [x] Agent 面板：MCP 地址复制、工具提示
- [x] 自动重连 + snapshot 恢复
- [x] 深色 UI、节点选中态、toast

### 2.4 文档

- [x] `docs/ARCHITECTURE.md`：三个平面、Command、历史、执行、MCP、并发、反模式
- [x] `docs/STATUS.md`：本文件
- [x] `README.md`：快速开始与目录说明

---

## 3. 如何运行

```bash
pnpm install
pnpm dev
```

- Web：http://127.0.0.1:5173
- Server：http://127.0.0.1:8787
- MCP：http://127.0.0.1:8787/mcp/main
- 健康检查：`GET /api/health`

默认不校验 token。若要开启：

```bash
cp .env.example .env
# .env 里设置 CANVAS_TOKEN=dev-token
# Web 需要 VITE_CANVAS_TOKEN=dev-token（Vite 已配置从仓库根读取 .env）
```

Agent 端到端验收：

```bash
# 先启动 server
pnpm agent:demo
```

测试与构建：

```bash
pnpm test
pnpm -r typecheck
pnpm --filter @combi/web build
```

---

## 4. 验证记录

| 项 | 结果 |
|---|---|
| `pnpm --filter @combi/canvas-core test` | ✅ 19 passed |
| `pnpm -r typecheck` | ✅ core / server / web 全部通过 |
| `pnpm --filter @combi/web build` | ✅ 1642 modules，JS 434KB（gzip 137KB） |
| MCP demo | ✅ batch 成功、`run_node` 任务 succeeded、产出 runtime |
| CDP 拖拽测试 | ✅ 15 次 mousemove → 1 条「移动「开场画面」」；⌘Z 后坐标回到 (80,260) |
| 页面截图 | ✅ 1440×900 正常渲染（`docs/assets/canvas.png`） |

CDP 拖拽验证的关键结果：

```text
after drag  pos={x:513,y:566} rev=1 history=[移动「开场画面」] cursor=1
after undo  pos={x:80,y:260}  rev=2 cursor=0 historyLen=1
```

说明：拖动过程中所有 position 变化都被本地 preview 吸收，只有松手时的一条命令进入历史。

---

## 5. 当前示例数据

- 首次启动会 seed 三个节点：`n_img`（开场画面）→ `n_vid`（镜头生成）→ `n_out`（成片合成）。
- 文档与历史落盘在 `apps/server/data/doc-main.json`。
- **runtime 不持久化**：重启 server 后任务状态 / 输出会清空，文档与历史保留。
- `apps/server/data/` 已在 `.gitignore` 中。

重置为初始示例：

```bash
rm -f apps/server/data/doc-main.json
# 重启 server
```

---

## 6. 已知限制与技术债

按优先级排序。

### P0 — 上线前必须解决

1. **没有预算 / 额度控制。** Agent 可以无限触发 `run_node` / `run_graph`，真实 provider 会直接产生费用。
2. **命令幂等未实现。** 工具接受 `clientRequestId` 并写入 command id，但服务端没有去重表；MCP 客户端重试可能重复添加节点 / 重复运行。
3. **没有乐观并发。** 用户与 Agent 同时改同一节点时是 last-write-wins，Agent 可能用旧值覆盖用户的新值。
4. **执行器是模拟的。** 还没有真实 provider adapter、队列、重试、超时、限流。
5. **JSON 单文件持久化。** 只适合单机骨架；多实例、备份、迁移都需要 Postgres。

### P1 — 体验 / 正确性

6. **历史只支持 LIFO。** 点击历史面板跳转撤销尚未实现；需要字段级版本检测避免覆盖。
7. **undo 与异步的边界较粗。** 删除运行中的节点会取消任务；undo 恢复节点是 idle，不自动重跑（这是有意设计，但 UI 需要更明确地提示）。
8. **run 命令没有审计记录。** 目前只有文档命令进历史，run / cancel 没有独立 log。
9. **边不能选中 / 编辑。** 只能双击删除；缺少边的属性面板与重连。
10. **属性输入框在 Agent 同时修改时可能被 remount。** 非受控输入的 key 包含参数值，外部变更会重置草稿。
11. **多选只支持 Shift 点击。** 没有框选；`selectionKeyCode={null}`。
12. **history limit 默认 100，没有配置界面。**
13. **MCP 无状态模式。** 每次请求重建 server，不支持 server-initiated notifications / 长连接进度推送；Agent 需要轮询 `get_job`。

### P2 — 架构演进

14. **没有多用户协作。** 单文档、单写者串行，last-write-wins。
15. **没有 CRDT。** 如果未来要多人同时拖同一节点，需要 Yjs 或类似方案；但业务校验必须留在 Command 层。
16. **没有插件化 provider。** 节点执行逻辑写死在 `execution.ts`，下一步应抽象成 adapter。
17. **没有资源生命周期管理。** mock 资产是 data URI；真实资产需要对象存储、清理、配额。
18. **测试覆盖不均。** core 有 19 个测试；server / web 还没有自动化测试（CDP 脚本是一次性验证，未入库）。

---

## 7. 下一步（按顺序）

### Step 1：把执行面做成真的（M1）

- 抽象 `NodeExecutor` 接口：`execute(ctx) → { output, cost, meta }`。
- 接入真实 provider（先接 1 个图片、1 个视频），失败重试 / 超时 / 限流。
- `run` / `cancel` 写独立 `run_log`（不进 undo 历史）。
- 预算：per-doc / per-agent 额度；超限拒绝并返回明确错误。
- 验收：一次 `graph.run` 能产生真实资产；花费可查询；删除节点会取消任务。

### Step 2：并发与幂等（M1）

- 命令去重表：`(docId, commandId) → result`，TTL 24h。
- 节点级 `version`：写命令带 `baseVersion`，不匹配返回 409 + 当前节点。
- Agent 工具返回 409 时提示「重新读取后重试」。
- 验收：同一 `clientRequestId` 调用两次只生效一次；并发改同一节点时后写者被拒绝。

### Step 3：持久化迁移（M2）

- Postgres：`documents`、`command_log`、`run_log`、`assets`。
- 命令日志按 `seq` 分页；快照每 100 条。
- 多实例部署：广播换成 Redis pub/sub 或 Postgres LISTEN/NOTIFY。
- 验收：重启不丢历史；两个 server 实例看到同一文档。

### Step 4：历史体验（M2）

- 历史面板支持「撤销到此处」（先只允许 LIFO 的批量 undo）。
- 字段级冲突检测 + 冲突提示。
- 输入框在外部修改时的「已更新」提示，而不是静默 remount。
- 验收：用户与 Agent 交替编辑后，撤销不会静默覆盖对方的新值。

### Step 5：Agent 生产化（M3）

- OAuth / 每用户 token 映射到 `actorId` 与 doc 权限（read / write / run）。
- MCP 进度通知（或 SSE）替代轮询。
- 工具级权限：read-only agent、禁用 destructive、run 需人工审批。
- 验收：一个只读 Agent 无法写；一个受限 Agent 无法超预算；所有操作可审计。

### Step 6：协作（M4，按需）

- 先做 presence / 光标 / 在线状态。
- 只有在「多人同时编辑同一字段」成为真实需求时再引入 CRDT。
- 验收：两人同时编辑不同节点无冲突；同一节点有明确的合并 / 拒绝策略。

---

## 8. 里程碑

| 里程碑 | 状态 | 范围 | 验收标准 |
|---|---|---|---|
| **M0 骨架** | ✅ 2026-11-14 | 三平面、Command、patch 历史、WS、模拟执行、MCP、Web UI | 拖拽 1 条历史；Agent batch 可撤销；测试 / 构建通过 |
| **M1 可用的单人工作流** | 🔜 下一步 | 真实 provider 1–2 个、run_log、预算、幂等、409 并发 | 能生成真实视频；花费可控；重试不重复；冲突可感知 |
| **M2 生产基础设施** | ⬜ 计划 | Postgres、Redis、对象存储、快照、多实例 | 重启不丢、可水平扩展、资产可管理 |
| **M3 Agent 生产化** | ⬜ 计划 | OAuth、权限、审批、进度通知、审计面板 | 只读 / 受限 / 审批三种模式可配置 |
| **M4 协作** | ⬜ 按需 | presence、多人编辑、按需 CRDT | 多人同时编辑不互相覆盖 |

---

## 9. 需要产品确认的问题

这些会影响架构，建议在 M1 前定下来：

1. **计费主体**：按用户额度、按文档额度，还是按 workspace？Agent 的花费算谁的？
2. **Agent 权限模型**：外部 Agent 是「用户的另一个手」，还是「受限协作者」？是否允许删除 / 运行？
3. **协作范围**：v1 是否需要多人实时编辑？还是「单人 + Agent」就够？
4. **资产留存**：生成失败的中间产物是否保留？撤销删除的节点，其资产是否保留 / 进入回收站？
5. **视频节点的真实语义**：首帧图 + 提示词，还是图生视频 / 视频生视频 / 多图参考？这会影响端口类型与执行器接口。

---

## 10. 目录结构

```
combi-wf/
├── apps/
│   ├── server/
│   │   ├── src/
│   │   │   ├── index.ts        # Fastify + WS + MCP 路由
│   │   │   ├── service.ts      # Command 编排 / 广播 / 持久化
│   │   │   ├── execution.ts    # 模拟执行引擎 + stale
│   │   │   ├── store.ts        # JSON 持久化
│   │   │   ├── mcp.ts          # MCP tools
│   │   │   ├── seed.ts         # 初始示例画布
│   │   │   └── ...
│   │   └── scripts/agent-demo.ts
│   └── web/
│       └── src/
│           ├── components/     # Canvas / FlowNode / Inspector / History...
│           ├── store.ts        # doc + ui + runtime 镜像
│           ├── ws.ts           # 连接 / 重连 / pending
│           ├── commands.ts     # UI 侧命令封装
│           └── styles.css
├── packages/
│   └── canvas-core/
│       └── src/
│           ├── engine.ts       # 命令应用 + 历史
│           ├── registry/       # 节点定义
│           ├── commands.ts
│           ├── history.ts
│           └── engine.test.ts
├── docs/
│   ├── ARCHITECTURE.md
│   ├── STATUS.md
│   └── assets/canvas.png
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

---

## 11. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 真实生成费用失控 | 直接亏钱 | M1 预算 + 审批 + 缓存 |
| Agent 与用户并发覆盖 | 数据丢失 / 信任下降 | M1 节点版本 + 409 |
| 单文件 JSON 损坏 | 文档丢失 | 立即迁移 Postgres；写临时文件 + rename |
| 执行状态与文档不一致 | UI 误导 | runtime 只读、签名校验、resync |
| 节点 schema 演进 | 旧文档参数不合法 | zod 默认值 + 迁移脚本 |
| MCP token 泄露 | 画布被任意操作 | 短期：token 轮换 + 范围限制；长期：OAuth |
| 历史语义与用户预期不符 | 「撤销撤错了」 | source 标签、Agent 操作可见、LIFO 明确 |
