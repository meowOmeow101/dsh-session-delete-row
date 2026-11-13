/**
 * Host half of the session-delete bundle.
 *
 * Deletes one Session for real: the session and every subagent Session spawned
 * from it, the persisted log directories, the projection cache, the Workspace
 * accounting, and the pin/archive state. A live Session is detached first so its
 * append hooks cannot recreate a log that was just removed.
 *
 * Two plugin-owned HTTP routes carry the work for the browser half:
 * `/session-delete/preview` (what would be deleted) and
 * `/session-delete/delete` (do it). Both sit behind the Connection service's
 * browser-credential and Host/Origin admission.
 */
import { rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { homedir } from 'node:os'

const PREVIEW_PATH = '/session-delete/preview'
const DELETE_PATH = '/session-delete/delete'

/** One session id; nothing larger is a legitimate request body. */
const MAX_BODY_BYTES = 64 * 1024

/** Session ids are opaque, but they are always a single path/URL-safe token. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/

/** Running work is stopped through the archive providers, then awaited this long. */
const STOP_TIMEOUT_MS = 8_000

/** Windows transient locks (AV, indexer, a closing handle) clear within a few tries. */
const REMOVE_ATTEMPTS = 6

/** Session identifiers that name the session's own directory. */
const SESSION_DIR_PATTERN = /^(session-|sess_)[A-Za-z0-9._-]+$/

/** Services this plugin needs before it can answer a request. */
export const inject = ['connection', 'webServer', 'workspaceRegistry', 'sessionPersistence']

/** A refusal that reaches the Client with a stable code instead of a raw stack. */
function refusal(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

/** Project one thrown value into the failure envelope the Client understands. */
function failure(error) {
  return {
    ok: false,
    error: {
      code: typeof error?.code === 'string' ? error.code : 'session-delete/failed',
      message: error instanceof Error ? error.message : String(error),
    },
  }
}

/** Short human-readable reason for a warning entry. */
function reasonOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Resolve after `ms`. */
function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** Read and decode the bounded JSON request body. */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      throw refusal('session-delete/bad-request', 'request body is too large')
    }
    chunks.push(chunk)
  }
  if (size === 0) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw refusal('session-delete/bad-request', 'request body is not JSON')
  }
}

/** Write one JSON response and finish it. */
function sendJson(res, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/** Every persisted Session header plus its materialized location and size. */
async function listStored(ctx) {
  try {
    return await ctx.sessionPersistence.list()
  } catch {
    return []
  }
}

/**
 * Whether one stored Session is a subagent child rather than an ordinary
 * fork. `SessionHeader.parentSession` alone is not enough: historical ordinary
 * forks may retain their source id there, and deleting a fork's parent must not
 * delete the fork.
 */
function isSubagentChild(snapshot) {
  const header = snapshot.header
  if (header.origin === 'subagent') return true
  return typeof header.delegationDepth === 'number' && header.delegationDepth > 0
}

/**
 * The requested Session followed by every subagent Session whose
 * `parentSession` chain reaches it. Discovered from persistence headers, never
 * from UI collapse state, and never across an ordinary fork.
 */
function collectTargets(snapshots, rootId) {
  const children = new Map()
  for (const snapshot of snapshots) {
    const parent = snapshot.header.parentSession
    if (parent === undefined || !isSubagentChild(snapshot)) continue
    const siblings = children.get(parent)
    if (siblings === undefined) children.set(parent, [snapshot.header.id])
    else siblings.push(snapshot.header.id)
  }
  const targets = []
  const seen = new Set()
  const queue = [rootId]
  while (queue.length > 0) {
    const id = queue.shift()
    if (seen.has(id)) continue
    seen.add(id)
    targets.push(id)
    for (const child of children.get(id) ?? []) queue.push(child)
  }
  return targets
}

/** `$DSH_HOME`, preferring the path implied by a stored log location. */
function resolveHome(location) {
  if (typeof location === 'string' && location.length > 0) {
    // The stored layout is <home>/sessions/<project>/<session>/<artifact>, but
    // older or alternative shapes nest differently; walk up to the `sessions`
    // segment instead of assuming a fixed depth.
    let current = location
    for (let depth = 0; depth < 5; depth += 1) {
      current = dirname(current)
      if (basename(current) === 'sessions') return dirname(current)
      if (current === dirname(current)) break
    }
  }
  if (typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.length > 0) {
    return process.env.DSH_HOME
  }
  return join(homedir(), '.dsh')
}

/** The file or directory one stored Session owns on disk. */
function logTarget(path) {
  const directory = dirname(path)
  return SESSION_DIR_PATTERN.test(basename(directory)) ? directory : path
}

/** Remove one target, retrying transient Windows locks with a growing delay. */
async function removeWithRetry(target) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true })
      return
    } catch (error) {
      const code = error?.code
      const retryable = code === 'EBUSY' || code === 'EPERM' || code === 'EACCES' || code === 'ENOTEMPTY'
      if (!retryable || attempt >= REMOVE_ATTEMPTS) throw error
      await wait(100 * (attempt + 1))
    }
  }
}

/** What still runs for a Session, asked through the archive-activity waterfall. */
async function sessionActivity(ctx, sessionId) {
  try {
    const activity = await ctx.waterfall('workspace/session-activity', { sessionId }, () =>
      Promise.resolve([]),
    )
    return Array.isArray(activity) ? activity : []
  } catch {
    return []
  }
}

/** Compact activity description for the confirmation dialog. */
function summarizeActivity(activity) {
  return activity.map((entry) => ({
    kind: typeof entry?.kind === 'string' ? entry.kind : 'other',
    count: Array.isArray(entry?.items) && entry.items.length > 0 ? entry.items.length : 1,
    names: Array.isArray(entry?.items)
      ? entry.items.slice(0, 8).map((item) => item?.label ?? item?.id).filter((value) => typeof value === 'string')
      : [],
  }))
}

/** The live store entry when the runtime layout is the expected one. */
function storeEntryOf(ctx, sessionId) {
  const sessions = ctx.get('sessions')
  const store = sessions?.store
  if (!(store instanceof Map)) return undefined
  return store.get(sessionId)
}

/** Whether the runtime still holds this Session, through its public lookup. */
function runtimeHolds(ctx, sessionId) {
  const sessions = ctx.get('sessions')
  if (sessions === undefined) return false
  try {
    return sessions.get(sessionId) !== undefined
  } catch {
    return false
  }
}

/**
 * Close the live Session entry so its append hooks stop before the log file
 * disappears. `ctx.sessions` has no public detach, so this uses the store
 * entry's own single-shot detach — the same path the owning fiber runs.
 * @returns `'closed'` when nothing holds the Session any more (an id this
 *   plugin already detached counts), or `'blocked'` when the runtime still
 *   owns it and will not let go yet (still announcing, or an unknown layout).
 */
function closeLiveSession(ctx, sessionId) {
  const entry = storeEntryOf(ctx, sessionId)
  if (entry === undefined) {
    return runtimeHolds(ctx, sessionId) ? 'blocked' : 'closed'
  }
  if (entry.announcement !== 'complete') return 'blocked'
  try {
    if (typeof entry.detach !== 'function') return 'blocked'
    entry.detach()
    return 'closed'
  } catch {
    return 'blocked'
  }
}

/**
 * Stop the Session's running work and wait for quiescence. The durable archive
 * set is what every provider's `agent/pre-step` gate reads, so archiving first
 * blocks the wakes its own stops induce; it is undone right after.
 */
async function stopWork(ctx, sessionId) {
  const agents = ctx.get('agents')
  const agent = agents?.get(sessionId)
  const activity = await sessionActivity(ctx, sessionId)
  const running = agent?.status === 'running'
  if (!running && activity.length === 0) return

  const registry = ctx.workspaceRegistry
  let archived = false
  try {
    await registry.archiveSession(sessionId, { stopActivity: true })
    archived = true
  } catch {
    // Unknown or refused archive: fall through to the status check.
  }
  if (agent !== undefined) {
    let idle
    try {
      idle = agent.whenIdle()
    } catch {
      idle = Promise.resolve()
    }
    await Promise.race([Promise.resolve(idle).catch(() => undefined), wait(STOP_TIMEOUT_MS)])
  }
  if (archived) {
    try {
      await registry.unarchiveSession(sessionId)
    } catch {
      // The archive set tolerates a stale id; deletion removes it anyway.
    }
  }
  if (agent?.status === 'running') {
    throw refusal('session-delete/running', `session '${sessionId}' could not be stopped`)
  }
  // Providers stop work asynchronously; give them a beat before deciding the
  // session is safe to unlink.
  await wait(150)
  if ((await sessionActivity(ctx, sessionId)).length > 0) {
    throw refusal('session-delete/running', `session '${sessionId}' still has active work`)
  }
}

/** Remove both known projection-cache spellings for one Session id. */
async function removeProjectionCache(home, sessionId, warnings) {
  const names = new Set([`${sessionId}.json`])
  if (sessionId.startsWith('session-')) names.add(`${sessionId.slice('session-'.length)}.json`)
  if (sessionId.startsWith('sess_')) names.add(`${sessionId.slice('sess_'.length)}.json`)
  for (const name of names) {
    const path = join(home, 'storages', 'session_projcache', 'sessions', name)
    try {
      await rm(path, { force: true })
    } catch (error) {
      warnings.push({ target: sessionId, path, reason: reasonOf(error) })
    }
  }
}

/** Validate the id and build the shared target plan. */
async function plan(ctx, sessionId) {
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
    throw refusal('session-delete/invalid-id', `invalid session id: ${String(sessionId)}`)
  }
  const snapshots = await listStored(ctx)
  const byId = new Map(snapshots.map((snapshot) => [snapshot.header.id, snapshot]))
  const registry = ctx.workspaceRegistry
  const workspaces = registry.list()
  const agents = ctx.get('agents')
  const live = agents?.get(sessionId)
  const storeEntry = storeEntryOf(ctx, sessionId)
  const held = storeEntry !== undefined || runtimeHolds(ctx, sessionId) || live !== undefined
  const accounted = workspaces.some((workspace) => workspace.sessionIds.includes(sessionId))
  if (!byId.has(sessionId) && !accounted && !held) {
    throw refusal('session-delete/not-found', `unknown session '${sessionId}'`)
  }
  const targets = collectTargets(snapshots, sessionId)
  const home = resolveHome(byId.get(sessionId)?.location?.path ?? targets.map((id) => byId.get(id)?.location?.path).find(Boolean))
  return { sessionId, snapshots, byId, registry, workspaces, agents, live, held, targets, home }
}

/** Report what a delete would remove, without changing anything. */
async function previewSession(ctx, sessionId) {
  const planned = await plan(ctx, sessionId)
  const bytes = planned.targets.reduce((sum, id) => sum + (planned.byId.get(id)?.sizeBytes ?? 0), 0)
  const files = planned.targets.filter(
    (id) => typeof planned.byId.get(id)?.location?.path === 'string',
  ).length
  const activity = await sessionActivity(ctx, planned.sessionId)
  return {
    sessionId: planned.sessionId,
    open: planned.held,
    running: planned.live?.status === 'running',
    activity: summarizeActivity(activity),
    subagents: Math.max(0, planned.targets.length - 1),
    logs: files,
    bytes,
  }
}

/**
 * Delete the Session, its subagent Sessions, their logs, their projection
 * caches, and their accounting. Cleanup steps that fail after the primary log
 * is gone are reported as warnings instead of failing the whole call.
 */
async function deleteSession(ctx, sessionId) {
  const planned = await plan(ctx, sessionId)
  const warnings = []
  const deleted = []

  await stopWork(ctx, planned.sessionId)

  // Close the root first: an append after the unlink would recreate it. If the
  // runtime still owns it, refuse before detaching anything else.
  const rootState = closeLiveSession(ctx, planned.sessionId)
  if (rootState === 'blocked') {
    throw refusal('session-delete/open', `session '${planned.sessionId}' cannot be closed yet`)
  }
  const closed = planned.targets
    .filter((id) => id !== planned.sessionId)
    .map((id) => closeLiveSession(ctx, id))
  if (rootState === 'closed' || closed.some((state) => state === 'closed')) await wait(50)

  for (const id of planned.targets) {
    const location = planned.byId.get(id)?.location?.path
    if (typeof location !== 'string' || location.length === 0) continue
    try {
      await removeWithRetry(logTarget(location))
      deleted.push(id)
    } catch (error) {
      if (id === planned.sessionId) {
        throw refusal('session-delete/busy', `cannot remove the log at '${location}': ${reasonOf(error)}`)
      }
      warnings.push({ target: id, path: location, reason: reasonOf(error) })
    }
  }

  for (const id of planned.targets) {
    await removeProjectionCache(planned.home, id, warnings)
    for (const workspace of planned.workspaces) {
      if (!workspace.sessionIds.includes(id)) continue
      try {
        await workspace.detachSession(id)
      } catch (error) {
        warnings.push({ target: id, path: workspace.path, reason: reasonOf(error) })
      }
    }
    try {
      await planned.registry.unpinSession(id)
    } catch (error) {
      warnings.push({ target: id, path: 'pin', reason: reasonOf(error) })
    }
    try {
      await planned.registry.unarchiveSession(id)
    } catch (error) {
      warnings.push({ target: id, path: 'archive', reason: reasonOf(error) })
    }
    try {
      ctx.emit('api-session/removed', id)
    } catch {
      // A profile without the Session catalog has no list to refresh.
    }
  }

  return {
    sessionId: planned.sessionId,
    deleted,
    subagents: Math.max(0, planned.targets.length - 1),
    warnings,
  }
}

/** One authenticated JSON route: admit, read the body, answer with the result. */
function route(ctx, operation) {
  return async (req, res) => {
    const admission = ctx.connection.admit(req)
    if ('rejection' in admission) {
      res.writeHead(admission.rejection)
      res.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden')
      return
    }
    if (admission.peer.principal.kind !== 'owner') {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end('method not allowed')
      return
    }
    try {
      const body = await readJsonBody(req)
      sendJson(res, { ok: true, value: await operation(body?.sessionId) })
    } catch (error) {
      sendJson(res, failure(error))
    }
  }
}

/** Register both routes for the lifetime of the plugin. */
export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: PREVIEW_PATH,
        handler: route(ctx, (sessionId) => previewSession(ctx, sessionId)),
      }),
    'session-delete: preview route',
  )
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: DELETE_PATH,
        handler: route(ctx, (sessionId) => deleteSession(ctx, sessionId)),
      }),
    'session-delete: delete route',
  )
}
