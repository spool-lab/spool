# Spool UI 前后端分离架构方案

## 现状分析

Spool 目前是一个 Electron 单体应用，前后端通过 Electron IPC 紧耦合：

```
┌─────────────────────────────────────────┐
│  Electron App                           │
│  ┌──────────────┐  IPC  ┌────────────┐  │
│  │  Renderer     │◄────►│  Main      │  │
│  │  (React UI)   │      │  (Node.js) │  │
│  └──────────────┘       └─────┬──────┘  │
│                               │         │
│                         ┌─────▼──────┐  │
│                         │  @spool/   │  │
│                         │  core      │  │
│                         │  (SQLite)  │  │
│                         └────────────┘  │
└─────────────────────────────────────────┘
```

**好的基础：**
- `@spool/core` 已经是独立的纯逻辑包（DB、查询、解析、同步）
- CLI (`@spool/cli`) 已经直接调用 `@spool/core`，证明核心逻辑可复用
- IPC 接口定义清晰，`SpoolAPI` 类型已经描述了完整的 API 面
- ACP 协议本身已经是进程间通信，不依赖 Electron

**需要解决的问题：**
- 所有通信走 Electron IPC，外部客户端无法接入
- 实时事件（sync progress、AI streaming）绑定在 `webContents.send()`
- 剪贴板、终端、主题等 OS 操作嵌在主进程里
- 无认证机制（当前默认可信本地环境）

---

## 目标架构

```
┌─────────────┐  ┌──────────────┐  ┌──────────────────┐
│  Electron    │  │  Raycast     │  │  Community        │
│  App (自带)   │  │  Extension   │  │  Client (SwiftUI, │
│              │  │              │  │  Tauri, Web, etc.) │
└──────┬───────┘  └──────┬───────┘  └──────┬────────────┘
       │                 │                  │
       │    HTTP REST + WebSocket / SSE     │
       └─────────────────┼──────────────────┘
                         │
              ┌──────────▼──────────┐
              │  spool-server       │
              │  (localhost:18484)   │
              │                     │
              │  ┌───────────────┐  │
              │  │  @spool/core  │  │
              │  │  (SQLite+FTS) │  │
              │  └───────────────┘  │
              │  ┌───────────────┐  │
              │  │  AcpManager   │  │
              │  └───────────────┘  │
              │  ┌───────────────┐  │
              │  │  Syncer +     │  │
              │  │  Watcher      │  │
              │  └───────────────┘  │
              └─────────────────────┘
```

---

## 分步实施方案

### Phase 1: 抽取 `@spool/server` 包

**目标：** 将 Electron main process 的业务逻辑抽取为一个独立的 HTTP + WS 服务。

#### 1.1 创建 `packages/server`

```
packages/server/
├── src/
│   ├── index.ts          # 启动入口
│   ├── app.ts            # HTTP server (Hono / Fastify)
│   ├── routes/
│   │   ├── search.ts     # GET /api/search?q=...&limit=10&source=...
│   │   ├── sessions.ts   # GET /api/sessions, GET /api/sessions/:uuid
│   │   ├── status.ts     # GET /api/status
│   │   ├── sync.ts       # POST /api/sync
│   │   ├── ai.ts         # POST /api/ai/search, GET /api/ai/agents
│   │   ├── opencli.ts    # /api/opencli/*
│   │   └── config.ts     # GET/PUT /api/config/agents, /api/config/theme
│   ├── ws/
│   │   └── events.ts     # WebSocket event broadcasting
│   ├── auth.ts           # 本地认证 (bearer token)
│   └── types.ts          # OpenAPI schema types
├── package.json
└── tsconfig.json
```

#### 1.2 REST API 设计

从现有的 `SpoolAPI` 接口直接映射：

```
# 搜索
GET  /api/search?q={query}&limit={n}&source={source}
  → searchAll(db, query, { limit, source })
  → Response: { results: FragmentResult[] }

# 会话
GET  /api/sessions?limit={n}
  → listRecentSessions(db, limit)
  → Response: { sessions: Session[] }

GET  /api/sessions/:uuid
  → getSessionWithMessages(db, uuid)
  → Response: { session: Session, messages: Message[] }

# 状态
GET  /api/status
  → getStatus(db)
  → Response: StatusInfo

# 同步
POST /api/sync
  → syncer.syncAll()
  → Response: SyncResult

# AI 搜索
GET  /api/ai/agents
  → acpManager.detectAgents()
  → Response: { agents: AgentInfo[] }

POST /api/ai/search
  Body: { query, agentId, context }
  → Response: SSE stream (text/event-stream)
     data: {"type":"chunk","text":"..."}
     data: {"type":"tool_call","toolCallId":"...","title":"...","status":"..."}
     data: {"type":"done","fullText":"..."}

DELETE /api/ai/search
  → acpManager.cancel()

# OpenCLI
GET  /api/opencli/setup
GET  /api/opencli/platforms
GET  /api/opencli/sources
POST /api/opencli/sources
DELETE /api/opencli/sources/:id
POST /api/opencli/sources/:id/sync
POST /api/opencli/sync-all
POST /api/opencli/capture
  Body: { url }

# 配置
GET  /api/config/agents
PUT  /api/config/agents
  Body: AgentsConfig
```

#### 1.3 实时事件通道

两种方案可选，推荐 **SSE (Server-Sent Events)**，因为更简单且客户端兼容性好：

**方案 A: SSE (推荐)**
```
GET /api/events
  → Content-Type: text/event-stream

  event: sync-progress
  data: {"phase":"indexing","count":42,"total":100}

  event: new-sessions
  data: {"count":3}

  event: capture-progress
  data: {"phase":"fetching","message":"Parsing page..."}
```

**方案 B: WebSocket**
```
WS /api/ws
  → {"type":"sync-progress","data":{...}}
  → {"type":"ai-chunk","data":{"text":"..."}}
```

AI 搜索的 streaming 用 SSE 在 `POST /api/ai/search` 的响应上直接返回（类似 OpenAI API 的 stream 模式），不需要走全局事件通道。

#### 1.4 技术选型建议

| 组件 | 推荐 | 理由 |
|------|------|------|
| HTTP 框架 | **Hono** | 轻量、TypeScript-first、支持 SSE、无运行时依赖 |
| 序列化 | JSON | 已有类型，直接用 |
| API 规范 | OpenAPI 3.1 | 方便社区生成客户端 SDK |
| 认证 | Bearer token | 简单、本地足够 |

---

### Phase 2: 认证与安全

Spool 处理个人思考记录，即使只监听 localhost 也需要认证。

#### 2.1 本地 Token 认证

```
~/.spool/auth.json
{
  "token": "spool_xxxxxxxxxxxxxxxxxxxx"
}
```

- 首次启动时自动生成随机 token
- 所有 API 请求需要 `Authorization: Bearer spool_xxx`
- Token 通过 CLI `spool auth token` 命令查看/重新生成
- Electron 客户端直接读文件获取 token

#### 2.2 安全约束

- **仅绑定 `127.0.0.1`**，不暴露到网络
- CORS 限制为 localhost origin
- Rate limiting（防止恶意本地进程暴力搜索）
- 敏感操作（删除数据、修改配置）需要额外确认头 `X-Spool-Confirm: true`

---

### Phase 3: 改造 Electron App

Electron app 从"自带后端"变为"连接本地 server"：

#### 3.1 两种运行模式

```typescript
// packages/app/src/main/index.ts
if (isServerRunning()) {
  // 连接外部 spool-server
  connectToServer('http://127.0.0.1:18484')
} else {
  // 内嵌模式：自己启动 server（保持现有行为）
  const server = await startEmbeddedServer()
}
```

这保证了：
- **独立使用 Electron app 时**：行为不变，server 内嵌启动
- **有 spool-server 守护进程时**：Electron 只是一个前端壳

#### 3.2 替换 IPC 为 HTTP 客户端

创建一个适配层，让现有 React 代码无需修改：

```typescript
// packages/app/src/preload/index.ts (改造后)
const api = isElectronMode()
  ? createIpcApi()      // 现有逻辑
  : createHttpApi()     // HTTP + SSE 客户端

contextBridge.exposeInMainWorld('spool', api)
```

或者更简单：**Renderer 直接用 fetch**，绕过 preload：

```typescript
// packages/app/src/renderer/api.ts
export const spoolApi = {
  search: (q: string, limit = 10) =>
    fetch(`http://127.0.0.1:18484/api/search?q=${encodeURIComponent(q)}&limit=${limit}`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json()),
  // ...
}
```

---

### Phase 4: 守护进程化

让 spool-server 可以脱离 Electron 独立运行。

#### 4.1 `spool serve` 命令

在 `@spool/cli` 中添加：

```bash
# 前台运行
spool serve --port 18484

# 守护进程模式
spool serve --daemon
spool serve --stop
spool serve --status
```

#### 4.2 Launchd / systemd 集成

```xml
<!-- ~/Library/LaunchAgents/pro.spool.server.plist -->
<plist>
  <dict>
    <key>Label</key><string>pro.spool.server</string>
    <key>ProgramArguments</key>
    <array>
      <string>/usr/local/bin/spool</string>
      <string>serve</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
  </dict>
</plist>
```

这让 server 在开机时启动，Raycast extension 等客户端随时可用。

---

### Phase 5: 社区客户端协议

#### 5.1 OpenAPI 规范发布

生成 `openapi.yaml` 并发布到 docs/，社区可以用它：
- 自动生成 Swift / Kotlin / Rust / Python 客户端
- 在 Raycast、Alfred、Hammerspoon 等工具中集成

#### 5.2 客户端 SDK（可选）

```
packages/client-sdk/
├── src/
│   ├── index.ts
│   ├── client.ts      # SpoolClient class
│   └── types.ts       # 从 OpenAPI 生成
└── package.json
```

```typescript
import { SpoolClient } from '@spool/client'

const spool = new SpoolClient({
  baseUrl: 'http://127.0.0.1:18484',
  token: 'spool_xxx'  // 或自动从 ~/.spool/auth.json 读取
})

const results = await spool.search('Claude API rate limiting')
const stream = spool.aiSearch('summarize my recent work', 'claude')
for await (const chunk of stream) {
  process.stdout.write(chunk.text)
}
```

#### 5.3 Raycast Extension 示例架构

```typescript
// raycast-spool/src/search.tsx
import { SpoolClient } from '@spool/client'

export default function SearchSpool() {
  const [results, setResults] = useState<FragmentResult[]>([])
  const spool = new SpoolClient({ autoAuth: true })

  async function onSearchTextChange(text: string) {
    const { results } = await spool.search(text, 5)
    setResults(results)
  }

  return (
    <List onSearchTextChange={onSearchTextChange}>
      {results.map(r => (
        <List.Item key={r.id} title={r.snippet} subtitle={r.project} />
      ))}
    </List>
  )
}
```

---

## 需要考虑的特殊问题

### 1. OS 级操作的处理

当前有些 IPC handler 依赖 Electron/OS 能力：

| 操作 | 当前实现 | API 化方案 |
|------|----------|-----------|
| `copy-fragment` | `clipboard.writeText()` | 返回文本，客户端自行复制 |
| `resume-cli` | `openTerminal()` | 返回命令字符串，客户端自行打开终端 |
| `set-theme` | `nativeTheme.themeSource` | 仅影响 Electron，API 版存配置 |
| `download-update` | electron-updater | 仅 Electron 使用，API 不暴露 |

原则：**API 只负责数据和业务逻辑，OS 操作留给客户端**。

### 2. AI Streaming 的协议设计

AI 搜索是最复杂的接口，需要支持三种事件类型的 streaming：

```
POST /api/ai/search
Content-Type: application/json
Accept: text/event-stream

{"query":"...","agentId":"claude","context":[...]}

---

HTTP/1.1 200 OK
Content-Type: text/event-stream

event: chunk
data: {"text":"Based on your sessions"}

event: chunk
data: {"text":", I found that..."}

event: tool_call
data: {"toolCallId":"tc_1","title":"Reading file","status":"running"}

event: tool_call
data: {"toolCallId":"tc_1","title":"Reading file","status":"done"}

event: done
data: {"fullText":"Based on your sessions, I found that..."}
```

### 3. 数据库并发访问

当前 SQLite 使用 WAL 模式，支持并发读。但需要注意：
- 多个客户端同时写入（如同时触发 sync）需要排队
- Server 应持有唯一的 DB 写入权
- CLI 的直接 DB 访问需要改为走 API（或加文件锁）

### 4. 版本兼容

API 加 version prefix：`/api/v1/search`。未来破坏性变更通过 v2 实现，保持旧版本兼容。

---

## 实施优先级

| 优先级 | 阶段 | 工作量 | 价值 |
|--------|------|--------|------|
| P0 | Phase 1: `@spool/server` + REST API | ~2-3 天 | 解锁所有后续可能性 |
| P0 | Phase 2: 本地 Token 认证 | ~0.5 天 | 安全基础 |
| P1 | Phase 4: `spool serve` 守护进程 | ~1 天 | 让 server 独立运行 |
| P1 | Phase 5.1: OpenAPI spec | ~1 天 | 社区可以开始开发客户端 |
| P2 | Phase 3: Electron app 改造 | ~1-2 天 | 统一两种模式 |
| P2 | Phase 5.2: Client SDK | ~1 天 | 降低社区接入门槛 |

**最小可行路径：Phase 1 + 2 + 4 ≈ 4 天**，之后社区就可以用 `curl` 或任何 HTTP 客户端与 Spool 交互。

---

## 架构决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 传输协议 | HTTP REST + SSE | 比 gRPC 简单，比纯 WS 易调试，SSE 天然适合服务端推送 |
| 框架 | Hono | 零依赖、TypeScript-first、支持 SSE helper、Bun/Node 通用 |
| 认证 | Local file token | 无需 OAuth 复杂度，本地文件权限即可保护 |
| 绑定地址 | 127.0.0.1 only | 个人数据不应暴露到网络 |
| API 版本 | URL prefix `/api/v1/` | 简单、显式、不依赖 header negotiation |
| Electron 模式 | 内嵌 server 兜底 | 不强制用户单独跑 server，保持开箱即用 |
| SSE vs WebSocket | SSE 为主，AI streaming 也用 SSE | 单向推送足够，SSE 可 auto-reconnect，更简单 |
