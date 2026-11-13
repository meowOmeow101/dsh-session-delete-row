# 删除会话按钮（dsh-session-delete-row）

在 DSH Web 侧边栏的每个会话行末尾加一个垃圾桶按钮，用于**永久删除**指定会话。

## 功能

- **入口**：会话行悬停时，在 `…` 菜单按钮之后的动作条里（内置的归档、置顶按钮右侧）。
- **确认框**：打开时先向 Host 读取预览，显示
  - 会话标题，以及"将永久删除、无法恢复"的说明；
  - 将被一并删除的**子智能体会话数量**；
  - 本地日志总大小；
  - 该会话仍打开 / 正在运行的状态提示；
  - 将被停止的工作清单（当前轮次、子代理、后台任务、定时任务）。
- **删除范围**
  1. 会话本体 + 通过 `parentSession` 链发现、且 `origin === 'subagent'` 或 `delegationDepth > 0` 的子智能体会话（普通 fork 不会被误删）；
  2. 每个会话的日志目录（`sessions/<project>/<session>/`，含所有格式代际）；
  3. 投影缓存 `storages/session_projcache/sessions/<id>.json`（兼容带/不带 `session-` 前缀两种命名）；
  4. 工作区记账、置顶集合、归档集合；
  5. 向前端广播 `api-session/removed`，列表立即移除该行。
- **安全策略**
  - 会话正在运行（或仍有后台工作）时，先用 DSH 自己的归档停止路径停掉它的工作，最多等 8 秒；停不下来就整次中止，不改任何数据。
  - 空闲但仍在内存里的会话可以直接删：删除前会先关闭它的内存 Session 实例（停掉 append 钩子），避免删完日志又被写回来。
  - 删除失败（日志文件被占用等）时，主会话整体回滚为"未删除"；子会话或缓存清理失败则记为警告，不影响主删除。
- **部分失败报告**：主日志删掉但个别清理项失败时，对话框显示"已删除，但 N 项未能清理"，并列出前几条原因。

## 安装

通过 DSH 的 `plugin_manager` 安装：

```
plugin_manager install_bundle github:meowOmeow101/dsh-session-delete-row
```

本地开发时直接指向 checkout：

```
plugin_manager install_bundle <本目录绝对路径>
```

安装后刷新一次页面（Client 半需要重新加载）。修改 `client.js` 后刷新页面生效；修改 `index.js` 后需要重新启用该插件行（`include:session-delete`）。

## 卸载

```
plugin_manager remove_bundle dsh-session-delete-row
```

## 改名时注意

包名同时出现在三处，必须一起改，否则 Host 能加载而浏览器端模块会被丢弃（表现为重启后按钮消失）：

1. `package.json` 的 `name`；
2. `cordis.patch.yml` 里 `insert.name`；
3. `client.js` 中 `window.__ModuleLoader__.load({ id })`。

## 实现

- Host 半 `index.js`：注册 `POST /session-delete/preview` 与 `POST /session-delete/delete`。两条路由都用 `ctx.connection.admit()` 做浏览器凭据与 Host/Origin 校验，只接受 owner 主体的请求。
- Client 半 `client.js`：向 `sidebar.workspaces.session.row.action` 注册序号 300 的按钮，并在 `shell.overlay` 注册确认对话框；文案走 `ctx.locale`（en / zh）。

## 兼容性

- DSH `>= 0.2.0`（Web profile）。
- 只用 Node 内置模块和 DSH 既有服务（`connection`、`webServer`、`sessionPersistence`、`workspaceRegistry`、`sessions`、`agents`），没有第三方运行时依赖。
- 关闭内存 Session 依赖 `ctx.sessions` 的 store 条目（当前版本没有公开的 detach API）；升级后若该结构变化，删除会返回"稍后再试"，不会误删。若 `sessions.store` 不可用但运行时仍持有该会话，插件会拒绝删除（宁可不动）。

## 已知局限

- 没有回收站/撤销，删除不可恢复；不提供 CLI、批量删除、工作区分组等附加功能。
- 子智能体会话仅通过持久化 header 的 `parentSession` + `origin/delegationDepth` 发现；未落盘的临时子会话不会被列入。
- 删除当前正在查看的会话时，对话区可能停留在旧内容，直到切换或刷新。
- 触屏设备（`hover: none`）会隐藏行尾按钮所在的 slot；这些场景下可改用会话行 `…` 菜单里的内置"归档"。
- 若根会话已关闭但日志文件仍被占用而删除失败，行会先消失、刷新后回来；重试一次即可。

## 与同类插件的定位差异

同类插件大多把入口放在会话行 `…` 菜单里。本插件的差异是**行尾一键按钮 + 删除前预览**，并把"子会话、投影缓存、运行中停止、部分失败报告"一起纳入删除流程。

## License

MIT
