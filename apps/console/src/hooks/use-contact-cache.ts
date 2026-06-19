import { useCallback, useEffect, useSyncExternalStore } from "react"
import {
  contactDisplayName,
  type DriverContact,
} from "@/lib/driver-types"
import {
  fetchDriverContact,
  fetchDriverSessionAuth,
} from "@/lib/driver-client"

const PREFETCH_CONCURRENCY = 6
const CONTACT_CACHE_TTL_MS = 5 * 60 * 1000

type ContactCacheSnapshot = {
  loggedInUser: string | null
  version: number
}

let cache = new Map<string, { contact: DriverContact; fetchedAt: number }>()
let loggedInUser: string | null = null
let version = 0
const listeners = new Set<() => void>()
const inflight = new Map<string, Promise<DriverContact | null>>()

function notify() {
  version += 1
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

let snapshotCache: ContactCacheSnapshot = { loggedInUser: null, version: 0 }

function getSnapshot(): ContactCacheSnapshot {
  if (
    snapshotCache.loggedInUser !== loggedInUser ||
    snapshotCache.version !== version
  ) {
    snapshotCache = { loggedInUser, version }
  }
  return snapshotCache
}

async function loadContact(username: string): Promise<DriverContact | null> {
  const id = username.trim()
  if (!id) return null

  const hit = cache.get(id)
  if (hit && Date.now() - hit.fetchedAt < CONTACT_CACHE_TTL_MS) {
    return hit.contact
  }

  const pending = inflight.get(id)
  if (pending) return pending

  const promise = (async () => {
    try {
      const contact = await fetchDriverContact(id)
      if (contact) {
        cache.set(id, { contact, fetchedAt: Date.now() })
        notify()
      }
      return contact
    } catch {
      return null
    } finally {
      inflight.delete(id)
    }
  })()

  inflight.set(id, promise)
  return promise
}

async function prefetchIds(ids: string[]): Promise<void> {
  const queue = [...new Set(ids.map((id) => id.trim()).filter(Boolean))].filter(
    (id) => {
      const hit = cache.get(id)
      return (
        !inflight.has(id) &&
        (!hit || Date.now() - hit.fetchedAt >= CONTACT_CACHE_TTL_MS)
      )
    },
  )
  if (queue.length === 0) return

  let index = 0
  async function worker() {
    while (index < queue.length) {
      const id = queue[index++]!
      await loadContact(id)
    }
  }

  const workers = Array.from(
    { length: Math.min(PREFETCH_CONCURRENCY, queue.length) },
    () => worker(),
  )
  await Promise.all(workers)
}

let authLoaded = false

function ensureAuthLoaded() {
  if (authLoaded) return
  authLoaded = true
  void fetchDriverSessionAuth()
    .then((auth) => {
      const next = auth.loggedInUser?.trim() || null
      if (next !== loggedInUser) {
        loggedInUser = next
        notify()
      }
      if (next) void loadContact(next)
    })
    .catch(() => {
      loggedInUser = null
      notify()
    })
}

export function useContactCache() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  useEffect(() => {
    ensureAuthLoaded()
  }, [])

  const ensureContact = useCallback(async (username: string) => {
    ensureAuthLoaded()
    return loadContact(username)
  }, [])

  const prefetch = useCallback(async (usernames: Iterable<string | null | undefined>) => {
    ensureAuthLoaded()
    const ids = [...usernames].filter(Boolean) as string[]
    await prefetchIds(ids)
  }, [])

  const getContact = useCallback((username: string | undefined | null) => {
    if (!username) return undefined
    return cache.get(username.trim())?.contact
  }, [snapshot.version])

  const loggedInContact = snapshot.loggedInUser
    ? cache.get(snapshot.loggedInUser)?.contact
    : undefined

  return {
    loggedInUser: snapshot.loggedInUser,
    loggedInContact,
    loggedInDisplayName: loggedInContact
      ? contactDisplayName(loggedInContact)
      : null,
    ensureContact,
    prefetch,
    getContact,
    contactDisplayName,
  }
}
