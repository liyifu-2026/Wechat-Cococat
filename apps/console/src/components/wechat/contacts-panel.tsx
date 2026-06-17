import { useCallback, useEffect, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import { WeChatAvatar } from "@/components/console/wechat-avatar"
import { ContactProfilePanel } from "@/components/wechat/contact-profile-panel"
import { useContactCache } from "@/hooks/use-contact-cache"
import { useInboxMutes } from "@/hooks/use-inbox-mutes"
import { useInboxSessionContext } from "@/hooks/use-inbox-session-context"
import {
  fetchDriverChatsFind,
  fetchDriverContact,
  fetchDriverContacts,
  findDriverContacts,
  type DriverChat,
  type DriverContact,
} from "@/lib/driver-client"
import { contactDisplayName, contactToChat } from "@/lib/driver-types"
import {
  groupContactsBySection,
  isOfficialContact,
} from "@/lib/contact-category"
import { useConsoleStore } from "@/stores/console-store"
import { WechatChatChrome } from "@/components/wechat/wechat-window-controls"

function ContactListSection({
  title,
  contacts,
  selectedUsername,
  onSelect,
}: {
  title: string
  contacts: DriverContact[]
  selectedUsername: string | null
  onSelect: (c: DriverContact) => void
}) {
  if (contacts.length === 0) return null
  return (
    <li>
      <p className="sticky top-0 z-[1] bg-[var(--wechat-dark-panel)] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--wx-muted)]">
        {title}
      </p>
      <ul>
        {contacts.map((c) => {
          const active = selectedUsername === c.username
          return (
            <li key={c.username}>
              <button
                type="button"
                onClick={() => onSelect(c)}
                className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-[var(--wx-list-hover)] ${
                  active ? "bg-[var(--wx-list-active)]" : ""
                }`}
              >
                <WeChatAvatar
                  size="list"
                  smallHeadUrl={c.smallHeadUrl}
                  colorKey={c.username}
                  letter={contactDisplayName(c)}
                />
                <span className="min-w-0 truncate text-sm">
                  {contactDisplayName(c)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </li>
  )
}

export function ContactsPanel() {
  const { t } = useTranslation()
  const navigateInboxChat = useConsoleStore((s) => s.navigateInboxChat)
  const navigateBrain = useConsoleStore((s) => s.navigateBrain)
  const consumePendingContactUsername = useConsoleStore(
    (s) => s.consumePendingContactUsername,
  )
  const { prefetch } = useContactCache()
  const { muteByChatId, busyChatId, unmuteChat, markChatDone } = useInboxMutes()
  const [contacts, setContacts] = useState<DriverContact[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<DriverContact | null>(null)
  const [resolvedChat, setResolvedChat] = useState<DriverChat | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadContacts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await fetchDriverContacts(120)
      setContacts(list)
      void prefetch(list.map((c) => c.username).filter(Boolean))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [prefetch])

  useEffect(() => {
    void loadContacts()
  }, [loadContacts])

  useEffect(() => {
    const username = consumePendingContactUsername()
    if (!username) return
    let cancelled = false
    const pick = (contact: DriverContact) => {
      if (cancelled) return
      setSelected(contact)
    }
    const existing = contacts.find((c) => c.username === username)
    if (existing) {
      pick(existing)
      return
    }
    void fetchDriverContact(username)
      .then((contact) => {
        if (contact) pick(contact)
      })
      .catch(() => {
        if (!cancelled) {
          pick({
            username,
            nickName: username,
            contactType: "unknown",
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [consumePendingContactUsername, contacts])

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      void loadContacts()
      return
    }
    const handle = window.setTimeout(() => {
      void findDriverContacts(q)
        .then(setContacts)
        .catch((err) =>
          setError(err instanceof Error ? err.message : String(err)),
        )
    }, 250)
    return () => window.clearTimeout(handle)
  }, [query, loadContacts])

  useEffect(() => {
    if (!selected) {
      setResolvedChat(null)
      return
    }
    let cancelled = false
    const fallback = contactToChat(selected)
    void fetchDriverChatsFind(contactDisplayName(selected))
      .then((hits) => {
        if (cancelled) return
        const exact =
          hits.find((c) => c.id === selected.username) ??
          hits.find((c) => c.username === selected.username) ??
          hits[0]
        setResolvedChat(exact ?? fallback)
      })
      .catch(() => {
        if (!cancelled) setResolvedChat(fallback)
      })
    return () => {
      cancelled = true
    }
  }, [selected])

  const { individual, official } = useMemo(
    () => groupContactsBySection(contacts),
    [contacts],
  )

  const displayChat = selected
    ? resolvedChat ?? contactToChat(selected)
    : null
  const muteEntry = displayChat
    ? muteByChatId.get(displayChat.id) ?? null
    : null
  const session = useInboxSessionContext(displayChat, muteEntry, [])

  const handleSendMessage = useCallback(() => {
    if (!selected || isOfficialContact(selected)) return
    navigateInboxChat(selected.username)
  }, [navigateInboxChat, selected])

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--wechat-dark-panel)] text-[var(--wx-text)]">
      <div className="flex min-h-0 flex-1 bg-[var(--wechat-dark-panel)]">
        <div className="flex w-[280px] shrink-0 flex-col border-r border-[var(--wx-border)]">
          <div className="border-b border-[var(--wx-border)] px-3 py-3">
            <h1 className="mb-2 text-sm font-semibold">
              {t("wechat.nav.contacts")}
            </h1>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--wx-muted)]" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("wechat.contacts.search")}
                className="h-8 border-[var(--wx-border)] bg-[var(--wx-search-input)] pl-8 text-xs text-[var(--wx-text)]"
              />
            </div>
          </div>
          <ul className="custom-scrollbar flex-1 overflow-y-auto">
            {loading && (
              <li className="px-3 py-4 text-xs text-[var(--wx-muted)]">
                {t("wechat.contacts.loading")}
              </li>
            )}
            {error && (
              <li className="px-3 py-4 text-xs text-destructive">{error}</li>
            )}
            {!loading && (
              <>
                <ContactListSection
                  title={t("wechat.contacts.sectionIndividual")}
                  contacts={individual}
                  selectedUsername={selected?.username ?? null}
                  onSelect={setSelected}
                />
                <ContactListSection
                  title={t("wechat.contacts.sectionOfficial")}
                  contacts={official}
                  selectedUsername={selected?.username ?? null}
                  onSelect={setSelected}
                />
              </>
            )}
          </ul>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--wx-chat-bg)]">
          <WechatChatChrome />
          {displayChat && selected ? (
            <ContactProfilePanel
              contact={selected}
              chat={displayChat}
              muteEntry={muteEntry}
              session={session}
              muteBusy={busyChatId === displayChat.id}
              onUnmute={
                muteEntry ? () => void unmuteChat(displayChat.id) : undefined
              }
              onMarkDone={
                muteEntry ? () => void markChatDone(displayChat.id) : undefined
              }
              onEditRouting={
                muteEntry &&
                (muteEntry.reason === "escalate_a" ||
                  muteEntry.reason === "escalate")
                  ? () => navigateBrain("routing")
                  : undefined
              }
              onSendMessage={
                isOfficialContact(selected) ? undefined : handleSendMessage
              }
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-8">
              <p className="text-sm text-[var(--wx-muted)]">
                {t("wechat.contacts.selectHint")}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
