# Issue #27 分析：启动时磁盘写入过大导致 macOS 杀进程

## 一、项目背景

Spool 是一个 macOS 桌面应用（Electron），用于索引和搜索用户本地的 AI 对话记录。它会读取以下来源的 JSONL 文件：

- `~/.claude/projects/**/*.jsonl`（Claude Code 的对话记录）
- `~/.codex/sessions/**/*.jsonl`（Codex CLI 的对话记录）

这些 JSONL 文件由 Claude Code / Codex 生成，每个文件对应一个对话 session，里面是一行一条的 JSON 消息记录。

Spool 的核心功能是对这些对话记录建立全文搜索索引，让用户可以快速搜索历史对话内容。

## 二、技术选型

- **运行时**：Electron（Chromium + Node.js）
- **数据库**：SQLite（通过 better-sqlite3，同步 API）
- **全文搜索**：SQLite FTS5（内置全文搜索扩展）
- **日志模式**：WAL（Write-Ahead Log）

选择 SQLite 的原因是它是嵌入式数据库，不需要单独的服务进程，适合桌面应用场景。FTS5 是 SQLite 内置的全文搜索引擎，不需要额外依赖。

## 三、数据库表结构

### 核心表

```sql
-- 数据来源（claude / codex / opencli）
CREATE TABLE sources (
  id        INTEGER PRIMARY KEY,
  name      TEXT NOT NULL UNIQUE,
  base_path TEXT NOT NULL
);

-- 项目（按工作目录分组）
CREATE TABLE projects (
  id           INTEGER PRIMARY KEY,
  source_id    INTEGER NOT NULL REFERENCES sources(id),
  slug         TEXT NOT NULL,
  display_path TEXT NOT NULL,
  display_name TEXT NOT NULL,
  UNIQUE (source_id, slug)
);

-- 会话
CREATE TABLE sessions (
  id             INTEGER PRIMARY KEY,
  project_id     INTEGER NOT NULL REFERENCES projects(id),
  source_id      INTEGER NOT NULL REFERENCES sources(id),
  session_uuid   TEXT NOT NULL UNIQUE,
  file_path      TEXT NOT NULL UNIQUE,
  title          TEXT,
  started_at     TEXT NOT NULL,
  ended_at       TEXT NOT NULL,
  message_count  INTEGER NOT NULL DEFAULT 0,
  has_tool_use   INTEGER NOT NULL DEFAULT 0,
  cwd            TEXT,
  model          TEXT,
  raw_file_mtime TEXT   -- 用于跳过未变更的文件
);

-- 消息（主体数据，量最大的表）
CREATE TABLE messages (
  id           INTEGER PRIMARY KEY,
  session_id   INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  source_id    INTEGER NOT NULL REFERENCES sources(id),
  msg_uuid     TEXT,
  parent_uuid  TEXT,
  role         TEXT NOT NULL,           -- user / assistant / system
  content_text TEXT NOT NULL DEFAULT '', -- 消息正文，全文搜索的目标字段
  timestamp    TEXT NOT NULL,
  is_sidechain INTEGER NOT NULL DEFAULT 0,
  tool_names   TEXT NOT NULL DEFAULT '[]',
  seq          INTEGER NOT NULL
);

CREATE INDEX idx_messages_session   ON messages(session_id);
CREATE INDEX idx_messages_timestamp ON messages(timestamp);
```

### FTS 全文搜索索引

```sql
-- FTS5 虚拟表，对 messages.content_text 建全文索引
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content_text,
  content='messages',         -- content-sync 模式，FTS 不存原文，引用 messages 表
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 1'
);

-- 通过 trigger 自动维护 FTS 索引
CREATE TRIGGER messages_fts_insert
AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content_text)
    VALUES(NEW.id, NEW.content_text);
END;

CREATE TRIGGER messages_fts_delete
AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content_text)
    VALUES('delete', OLD.id, OLD.content_text);
END;
```

### SQLite 配置（db.ts）

```typescript
const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 5000')
// 注意：没有设置 synchronous，默认为 FULL
// 注意：没有设置 cache_size，默认约 2MB
// 注意：没有设置 mmap_size，默认为 0（不使用内存映射）
// 注意：没有设置 wal_autocheckpoint，默认为 1000 页（约 4MB）
```

## 四、同步逻辑（syncer.ts）

### 启动流程

```typescript
// app 启动时（index.ts）
app.whenReady().then(() => {
  db = getDB()
  syncer = new Syncer(db)
  
  setImmediate(() => {
    syncer.syncAll()   // 在 event loop 的下一个 tick 同步执行全量 sync
    watcher.start()    // sync 完成后启动文件监听
  })
  
  mainWindow = createWindow()
})
```

### syncAll 逻辑

```typescript
syncAll(): SyncResult {
  // 1. 收集所有 JSONL 文件路径
  const files = [...collectJSONL(claudeDirs), ...collectJSONL(codexDirs)]
  
  // 2. 获取已知文件的 mtime（用于跳过未变更的文件）
  const knownMtimes = getAllSessionMtimes(this.db)
  
  // 3. 遍历所有文件，逐个同步
  const BATCH = 20  // 仅用于 progress 汇报，不影响事务边界
  for (let i = 0; i < files.length; i += BATCH) {
    for (const file of files.slice(i, i + BATCH)) {
      this.syncFile(file.path, file.source, knownMtimes)
    }
    this.onProgress?.(...)
  }
}
```

### syncFile 逻辑（每个文件独立事务）

```typescript
syncFile(filePath, source, knownMtimes) {
  const mtime = getMtime(filePath)
  const existingMtime = knownMtimes.get(filePath)
  if (existingMtime === mtime) return 'skipped'  // mtime 未变，跳过
  
  const parsed = parseSession(filePath)  // 解析 JSONL 为结构化数据
  
  // ★ 每个文件开一个独立事务
  this.db.transaction(() => {
    // 如果是已存在的 session，先删除所有旧消息
    // DELETE FROM messages WHERE session_id = ?
    // → 触发 N 次 messages_fts_delete trigger
    
    const sessionId = upsertSession(this.db, { ... })
    
    // 逐条插入消息
    // → 每条触发 1 次 messages_fts_insert trigger
    insertMessages(this.db, sessionId, sourceId, parsed.messages)
    
    // 记录 sync log
    INSERT INTO sync_log (source_id, file_path, status) VALUES (?, ?, 'ok')
  })()
  // ★ 事务提交 → 在 synchronous=FULL 下触发 fsync
}
```

### insertMessages 逻辑（逐条插入）

```typescript
function insertMessages(db, sessionId, sourceId, messages) {
  const stmt = db.prepare(`INSERT INTO messages (...) VALUES (?, ?, ?, ...)`)
  for (const m of messages) {
    stmt.run(sessionId, sourceId, m.uuid, ..., m.contentText, ...)
    // 每次 stmt.run() 触发 messages_fts_insert trigger
  }
}
```

## 五、用户报告的问题（Issue #27）

### 环境

- macOS 15.7.5 (Build 24G624)
- Apple Silicon (Mac15,9 = M4 Max, arm64)
- RAM: 128 GB
- Spool 0.2.1

### 现象

首次安装后启动 app，28 秒内写入约 2.1GB 数据到磁盘，触发 macOS 的 disk write limit 后被系统杀掉。

### macOS Crash Report

```
Event:            disk writes
Action taken:     none
Writes:           2147.49 MB of file backed memory dirtied over 28 seconds
                  (76.53 MB per second average), exceeding limit of 24.86 KB
                  per second over 86400 seconds
Writes limit:     2147.48 MB
Limit duration:   86400s
Writes duration:  28s
```

macOS 的 disk write limit 机制：这是 Mach 内核 ledger 子系统的 I/O 监控功能（`task_ledgers.physical_writes`），对每个进程在 24 小时滚动窗口内的 file-backed memory dirtied 总量设有配额。XNU 默认限制为 20GB/24h（`IOMON_DEFAULT_LIMIT = 20480 MB`），但 Apple 会按平台覆盖——该用户的 macOS 配置为 ~2.1GB（`24.86 KB/s × 86400s`），iOS 通常约 1GB。可通过 boot argument `task_iomon_limit_mb` 调整。

**重要：在 macOS 上，超出此限制触发的 `EXC_RESOURCE` 异常是非致命的（`Action taken: none`），系统只生成诊断报告，不会终止进程。** 用户报告的"app crashes on launch"可能另有原因——最可能的是同步操作同步阻塞了 Electron 主线程（`setImmediate` 中的 `syncer.syncAll()` 是同步调用），导致 UI 长时间无响应，被用户手动强制退出或被 macOS 的 Application Not Responding 机制干预。这一点需要与用户进一步确认。

crash report 中 heaviest stack trace 指向 Electron main process / V8 / Node.js event loop，佐证了同步写入阻塞主线程的判断。

### 用户的 session 文件规模（推测）

用户有 Mac15,9（M4 Max）+ 128GB RAM，是重度开发者。可能有数千个 session 文件，总 JSONL 数据在数百 MB 到 GB 级别。

## 六、本地复现测试

### 测试环境

本地有 414 个 Claude session + 25 个 Codex session = 439 个文件，原始 JSONL 约 258MB。

### 测试方法

删除数据库后重新执行 syncAll()，模拟首次启动。

### 测试结果

```
Sync complete in 2.0s
DB: 10.1MB, WAL: 4.4MB, Total: 14.5MB
Files synced: 439
```

439 个文件在 2 秒内同步完成，总磁盘写入 14.5MB。问题在本地数据量下未能直接复现。

加 `synchronous=NORMAL` + `cache_size=-64000` + `mmap_size=268435456` 后测试结果：

```
Sync complete in 1.54s
DB: 10.1MB, WAL: 4.4MB, Total: 15.3MB
```

性能略有提升，但总写入量基本相同（因为数据量不足以触发多层 FTS 段合并）。

## 七、分析结论

### 写入放大的来源（按贡献大小排序）

**1. FTS5 索引的段合并（Segment Merge）—— 最大来源**

FTS5 内部使用类似 LSM-Tree 的分段存储策略。通过 trigger 逐条 INSERT 时：

- 每次 INSERT 创建一个新的小段（segment）
- 小段积累后触发合并（merge）成更大的段
- 大段继续合并成更大的段
- 合并过程中，旧段数据被读出、与新数据合并、写成新段

这导致同一份索引数据在合并过程中被反复重写。数据量越大，合并层数越多，写放大越严重（非线性增长）。

这也解释了为什么本地 439 个文件（258MB JSONL → 14.5MB 写入）看不出明显放大，但用户的大数据量下会触发多层合并导致 GB 级写入。

**2. WAL 双写 —— 固定 2x**

所有脏页先写入 WAL 文件，再在 checkpoint 时写回主数据库文件。这是 WAL 模式的固有开销，固定约 2 倍。

**3. 更新时的"删除再插入"策略**

更新已存在的 session 时，先 DELETE 所有旧消息（触发 FTS delete trigger × N 次），再全量 INSERT 新消息（触发 FTS insert trigger × N 次）。一次更新产生 2N 次 FTS 操作。

不过首次启动时所有文件都是新增，不存在 delete，这一层在首次启动场景贡献不大。

**4. 事务粒度 —— 间接放大**

每个文件一个独立事务（2000 个文件 = 2000 个事务），导致：

- 在 synchronous=FULL 下每个事务提交触发一次 fsync（性能影响为主）
- WAL auto-checkpoint 每 ~4MB 触发一次，2000 个事务会导致多次 checkpoint 循环

### 放大估算（用户场景）

假设用户有 2000 个 session，100 万条消息，原始 JSONL 约 500MB：

```
messages 表 + B-tree 索引：          ~700MB 脏页写入
FTS5 索引 + 段合并写放大：           ~1-3GB 脏页写入
以上合计脏页 × 2（WAL 双写）：       ~3.5-7.5GB 总磁盘 I/O
在写到 ~2.1GB 时触发 macOS EXC_RESOURCE 诊断（但进程不会被杀）。
实际崩溃原因更可能是主线程被同步 I/O 长时间阻塞导致 ANR。
```

## 八、问题定性修正

最初假设是"磁盘写入超限导致 macOS 杀掉进程"，但经过验证这是错误的：

1. macOS 的 `EXC_RESOURCE` disk write 诊断在 macOS 上是**非致命的**（`Action taken: none`），系统不会因此终止进程。日常大量写磁盘的应用（如下载工具写入数百 GB）从不会被系统杀掉，佐证了这一点。
2. crash report 中的 disk write 诊断只是伴随现象，不是崩溃原因。

**实际崩溃原因**：`syncer.syncAll()` 是一个同步调用（better-sqlite3 是同步 API），通过 `setImmediate()` 跑在 Electron 主进程的事件循环上。当需要同步的文件数量很大时，这个调用会阻塞主线程数十秒，导致：

- Electron 渲染进程无法收到 IPC 响应
- 窗口 UI 完全冻结（白屏/转菊花）
- macOS 判定 Application Not Responding
- 用户以为 app crash 并强制退出

所以核心问题有两层：
1. **性能层**：FTS 写放大导致 sync 耗时过长
2. **架构层**：sync 操作阻塞了主线程，没有放到 worker thread

## 九、修复方案

### 方案 A：优化 SQLite pragma

```typescript
db.pragma('synchronous = NORMAL')     // WAL 模式下安全，减少 fsync
db.pragma('cache_size = -64000')      // 64MB 内存缓存
db.pragma('mmap_size = 268435456')    // 256MB 内存映射
```

效果：减少 fsync 延迟，间接减少 checkpoint 时的 I/O 峰值。不直接减少写入总量。
风险：synchronous=NORMAL 在操作系统崩溃/断电时可能丢失最后几个事务，但 DB 可从 JSONL 原文件重建，风险可接受。

### 方案 B：合并事务

将多个 syncFile 的操作包在同一个事务内（如每 50-100 个文件一个事务），减少事务提交次数和 checkpoint 频率。

效果：减少 fsync 次数，减少 checkpoint 循环导致的重复写入。
风险：一个文件解析出错会回滚同一批次内所有文件的写入（可通过 try-catch 缓解）。

### 方案 C：首次同步时关闭 FTS trigger，完成后一次性 rebuild

```sql
DROP TRIGGER messages_fts_insert;
DROP TRIGGER messages_fts_delete;
-- ... 批量插入所有消息 ...
INSERT INTO messages_fts(messages_fts) VALUES('rebuild');
CREATE TRIGGER messages_fts_insert ...;
CREATE TRIGGER messages_fts_delete ...;
```

效果：FTS rebuild 使用内部的批量归并排序算法，比逐条 trigger 的段合并高效得多，可以大幅减少 FTS 的写放大。这是对首次启动场景效果最显著的优化。
风险：rebuild 期间搜索功能不可用（首次启动时本来也没数据可搜）；需要处理 rebuild 中途失败的恢复。

### 方案 D：增量更新而非全量替换

更新 session 时只插入新增消息，而非删除所有旧消息后重新全量插入。

效果：减少后续增量同步时的写入量（减少 FTS delete + insert 的次数）。
风险：实现复杂度高，需要可靠的消息 diff 逻辑。

### 方案 E：将 sync 移到 Worker Thread

当前 `syncer.syncAll()` 跑在 Electron 主进程的事件循环上，阻塞 UI。改为在 Node.js Worker Thread 中执行 sync，主线程只负责接收进度事件和结果。

```typescript
// 主进程
import { Worker } from 'node:worker_threads'

const worker = new Worker('./sync-worker.js')
worker.on('message', (msg) => {
  if (msg.type === 'progress') mainWindow?.webContents.send('spool:sync-progress', msg.data)
  if (msg.type === 'done') { /* sync 完成 */ }
})

// sync-worker.js
import { parentPort } from 'node:worker_threads'
const db = getDB()
const syncer = new Syncer(db, (e) => parentPort.postMessage({ type: 'progress', data: e }))
syncer.syncAll()
parentPort.postMessage({ type: 'done' })
```

效果：即使 sync 跑 30 秒，UI 也不会冻结，用户可以正常使用 app（只是搜索结果还不完整）。这直接解决了用户感知到的"crash"。
风险：better-sqlite3 的 Database 对象不能跨线程传递，worker 需要自己开 DB 连接。WAL 模式支持多连接并发读写，但需要确保不会出现锁冲突。
