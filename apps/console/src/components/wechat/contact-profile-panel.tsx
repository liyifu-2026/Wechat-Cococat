import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, ChevronRight } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { WeChatAvatar } from "@/components/console/wechat-avatar"
import { ContactTypePickerSheet } from "@/components/wechat/contact-type-picker-sheet"
import { ContactProfileWikiChips } from "@/components/wechat/contact-profile-wiki-chips"
import type { DriverChat, DriverContact } from "@/lib/driver-client"
import type { EscalationMuteEntry } from "@/lib/agent-config-client"
import type { useInboxSessionContext } from "@/hooks/use-inbox-session-context"
import { useInboxChatWiki } from "@/hooks/use-inbox-chat-wiki"
import { chatDisplayName } from "@/lib/wechat-ui"
import { isOfficialContact } from "@/lib/contact-category"
import {
  applyAllRegisteredWikiToChat,
  applyTypePresetWiki,
  ensureMaintainerCustomerType,
  findCustomerType,
  MAINTAINER_CUSTOMER_TYPE_ID,
  readCustomerTypesConfig,
  type CustomerTypesConfig,
} from "@/lib/customer-types"
import {
  contactTypeLabelKey,
  formatContactTimestamp,
} from "@/lib/contact-time"
import { useConsoleStore } from "@/stores/console-store"
import { useToastStore } from "@/stores/toast-store"

type SessionContext = ReturnType<typeof useInboxSessionContext>

type ContactProfilePanelProps = {
  contact: DriverContact
  chat: DriverChat
  muteEntry: EscalationMuteEntry | null
  session: SessionContext
  muteBusy?: boolean
  onUnmute?: () => void
  onMarkDone?: () => void
  onEditRouting?: () => void
  onSendMessage?: () => void
}

function muteHoursLeft(entry: EscalationMuteEntry): number {
  const leftMs = entry.muted_until - Date.now()
  return Math.max(0, Math.ceil(leftMs / (60 * 60 * 1000)))
}

function muteLabel(
  entry: EscalationMuteEntry,
  t: (key: string) => string,
): string {
  if (entry.reason === "escalate_a" || entry.reason === "escalate") {
    return t("wechat.inbox.muteEscalateA")
  }
  if (entry.reason === "probe_b" || entry.reason === "probe_loop") {
    return t("wechat.inbox.muteProbeB")
  }
  return t("wechat.inbox.muteGeneric")
}

function OfficialContactProfile({
  contact,
  chat,
}: {
  contact: DriverContact
  chat: DriverChat
}) {
  const { t } = useTranslation()
  const displayName = chatDisplayName(chat)

  return (
    <div className="custom-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-8">
      <div className="mx-auto flex w-full max-w-md flex-col items-center text-center">
        <WeChatAvatar
          size="list"
          className="!h-16 !w-16 !text-lg"
          smallHeadUrl={chat.smallHeadUrl ?? contact.smallHeadUrl}
          colorKey={chat.id}
          letter={displayName}
        />
        <h2 className="mt-4 text-xl font-medium text-[var(--wx-text)]">
          {displayName}
        </h2>
        <span className="mt-2 inline-flex rounded-full bg-[var(--wx-list-hover)] px-3 py-0.5 text-xs text-[var(--wx-muted)]">
          {t("wechat.contacts.contactTypeOfficial")}
        </span>
      </div>
    </div>
  )
}

export function ContactProfilePanel({
  contact,
  chat,
  muteEntry,
  session,
  muteBusy = false,
  onUnmute,
  onMarkDone,
  onEditRouting,
  onSendMessage,
}: ContactProfilePanelProps) {
  if (isOfficialContact(contact)) {
    return <OfficialContactProfile contact={contact} chat={chat} />
  }

  return (
    <PersonalContactProfile
      contact={contact}
      chat={chat}
      muteEntry={muteEntry}
      session={session}
      muteBusy={muteBusy}
      onUnmute={onUnmute}
      onMarkDone={onMarkDone}
      onEditRouting={onEditRouting}
      onSendMessage={onSendMessage}
    />
  )
}

function PersonalContactProfile({
  contact,
  chat,
  muteEntry,
  session,
  muteBusy = false,
  onUnmute,
  onMarkDone,
  onEditRouting,
  onSendMessage,
}: ContactProfilePanelProps) {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const openSettingsModal = useConsoleStore((s) => s.openSettingsModal)
  const chatId = chat.id
  const wiki = useInboxChatWiki(chatId)
  const [typesConfig, setTypesConfig] = useState<CustomerTypesConfig | null>(
    null,
  )
  const [presetWarning, setPresetWarning] = useState<string | null>(null)
  const [typePickerOpen, setTypePickerOpen] = useState(false)
  const savingRef = useRef(false)

  const displayName = chatDisplayName(chat)
  const isGroup = Boolean(chat.isGroup)

  useEffect(() => {
    void ensureMaintainerCustomerType()
      .then(() => readCustomerTypesConfig())
      .then(setTypesConfig)
      .catch(() => setTypesConfig({ types: [] }))
  }, [])

  const typeOptions = useMemo(() => {
    const rows = [
      { value: "", label: t("wechat.contacts.userTypeUnset") },
      ...(typesConfig?.types ?? []).map((entry) => ({
        value: entry.id,
        label: entry.label,
      })),
    ]
    if (
      session.userType &&
      !typesConfig?.types.some((e) => e.id === session.userType)
    ) {
      rows.push({
        value: session.userType,
        label: t("wechat.contacts.userTypeUnknown", { id: session.userType }),
      })
    }
    return rows
  }, [session.userType, t, typesConfig?.types])

  const canAutoBindWiki =
    wiki.resolved.length === 0 && wiki.aliases.length === 0

  const handleUserTypeChange = useCallback(
    async (nextId: string | null) => {
      if (savingRef.current) return
      const value = nextId?.trim() || null
      if (value === (session.userType?.trim() || null)) return

      const entry = value
        ? findCustomerType(typesConfig ?? { types: [] }, value)
        : undefined

      savingRef.current = true
      try {
        await session.setUserType(value)
        setPresetWarning(null)

        if (value === MAINTAINER_CUSTOMER_TYPE_ID) {
          const result = await applyAllRegisteredWikiToChat(chatId)
          await wiki.reload()
          const label = entry?.label ?? t("wechat.contacts.maintainerTypeLabel")
          if (!result.ok) {
            setPresetWarning(t("wechat.contacts.presetWikiInvalid"))
            addToast(t("wechat.contacts.presetWikiInvalid"), "error")
            return
          }
          const boundLabel = result.boundAliases.join(", ")
          if (result.partial) {
            addToast(
              t("wechat.contacts.userTypeBoundPartial", {
                label,
                wikis: boundLabel,
              }),
              "info",
            )
          } else {
            addToast(
              t("wechat.contacts.userTypeBound", {
                label,
                wikis: boundLabel || t("wechat.contacts.allWikiBound"),
              }),
              "success",
            )
          }
          return
        }

        if (!value || !canAutoBindWiki) {
          if (value && entry?.label) {
            addToast(
              t("wechat.contacts.userTypeSavedOnly", { label: entry.label }),
              "success",
            )
          }
          return
        }

        if (!entry) return

        if (entry.wikiProjects.length === 0) {
          addToast(
            t("wechat.contacts.userTypeSavedOnly", { label: entry.label }),
            "success",
          )
          return
        }

        const result = await applyTypePresetWiki(chatId, entry.wikiProjects)
        if (!result.ok) {
          setPresetWarning(t("wechat.contacts.presetWikiInvalid"))
          addToast(t("wechat.contacts.presetWikiInvalid"), "error")
          return
        }

        await wiki.reload()
        const boundLabel = result.boundAliases.join(", ")
        if (result.partial) {
          addToast(
            t("wechat.contacts.userTypeBoundPartial", {
              label: entry.label,
              wikis: boundLabel,
            }),
            "info",
          )
        } else {
          addToast(
            t("wechat.contacts.userTypeBound", {
              label: entry.label,
              wikis: boundLabel,
            }),
            "success",
          )
        }
      } catch (err) {
        addToast(
          err instanceof Error ? err.message : String(err),
          "error",
        )
      } finally {
        savingRef.current = false
      }
    },
    [addToast, canAutoBindWiki, chatId, session, t, typesConfig, wiki],
  )

  const allTags = useMemo(
    () => [...session.autoTags, ...session.agentTags],
    [session.agentTags, session.autoTags],
  )

  const wheelValue = session.userType ?? ""
  const currentTypeLabel =
    typeOptions.find((o) => o.value === wheelValue)?.label ??
    t("wechat.contacts.userTypeUnset")

  return (
    <div className="custom-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-6">
      <div className="mx-auto w-full max-w-lg">
        <div className="flex items-start gap-4">
          <WeChatAvatar
            size="md"
            smallHeadUrl={chat.smallHeadUrl ?? contact.smallHeadUrl}
            colorKey={chat.id}
            letter={displayName}
          />
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 className="truncate text-lg font-medium text-[var(--wx-text)]">
              {displayName}
            </h2>
            <p className="mt-0.5 truncate text-xs text-[var(--wx-muted)]">
              {contact.username}
            </p>
            <p className="mt-1 text-[11px] text-[var(--wx-muted)]">
              {t(contactTypeLabelKey(contact.contactType))}
            </p>
          </div>
        </div>

        {onSendMessage && !isGroup && (
          <button
            type="button"
            className="mt-5 w-full rounded-lg bg-[var(--wechat-brand)] py-2.5 text-sm font-medium text-white transition hover:bg-[var(--wechat-brand-hover)]"
            onClick={onSendMessage}
          >
            {t("wechat.contacts.sendMessage")}
          </button>
        )}

        <div className="mt-6 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-[var(--wx-list-hover)] px-3 py-2.5">
            <span className="text-[var(--wx-muted)]">
              {t("wechat.contacts.firstContact")}
            </span>
            <p className="mt-0.5 font-medium text-[var(--wx-text)]">
              {formatContactTimestamp(session.firstContact)}
            </p>
          </div>
          <div className="rounded-lg bg-[var(--wx-list-hover)] px-3 py-2.5">
            <span className="text-[var(--wx-muted)]">
              {t("wechat.contacts.lastContact")}
            </span>
            <p className="mt-0.5 font-medium text-[var(--wx-text)]">
              {formatContactTimestamp(session.lastContact)}
            </p>
          </div>
        </div>

        {!isGroup && (
          <div className="mt-6 space-y-4">
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--wx-muted)]">
                {t("wechat.contacts.userTypeLabel")}
              </p>
              <button
                type="button"
                disabled={session.profileSaving}
                onClick={() => setTypePickerOpen(true)}
                className="flex w-full items-center justify-between gap-2 rounded-xl border border-[var(--wx-border)] bg-[var(--wx-search-input)] px-3 py-2.5 text-left text-sm text-[var(--wx-text)] transition-colors hover:bg-[var(--wx-list-hover)] disabled:opacity-50"
              >
                <span className="min-w-0 truncate">{currentTypeLabel}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--wx-muted)]" />
              </button>
              <ContactTypePickerSheet
                open={typePickerOpen}
                options={typeOptions}
                value={wheelValue}
                disabled={session.profileSaving}
                onClose={() => setTypePickerOpen(false)}
                onSelect={(next) => void handleUserTypeChange(next || null)}
              />
            </div>

            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--wx-muted)]">
                {t("wechat.contacts.wikiBindingLabel")}
              </p>
              <ContactProfileWikiChips
                chatId={chatId}
                selectedAliases={wiki.aliases}
                onChanged={() => void wiki.reload()}
              />
            </div>
          </div>
        )}

        {!isGroup && wiki.status === "unbound" && session.userType && (
          <p className="mt-2 text-[11px] text-[var(--wx-muted)]">
            {t("wechat.contacts.userTypeBindHint")}
          </p>
        )}
        {presetWarning && (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {presetWarning}
          </p>
        )}

        {muteEntry ? (
          <div className="mt-6 rounded-xl border border-[var(--wx-warn-border)] bg-[var(--wx-warn-bg)] px-4 py-3 text-xs text-[var(--wx-warn-text)]">
            <p className="font-medium">{muteLabel(muteEntry, t)}</p>
            <p className="mt-1 text-[var(--wx-muted)]">
              {t("wechat.inbox.muteRemaining", {
                hours: muteHoursLeft(muteEntry),
              })}
            </p>
            {(onUnmute || onMarkDone) && (
              <div className="mt-3 flex gap-2">
                {onUnmute && (
                  <Button
                    size="sm"
                    className="h-7 flex-1 text-xs"
                    disabled={muteBusy}
                    onClick={onUnmute}
                  >
                    {t("wechat.inbox.unmute")}
                  </Button>
                )}
                {onMarkDone && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 flex-1 border-[var(--wx-border)] text-xs"
                    disabled={muteBusy}
                    onClick={onMarkDone}
                  >
                    {t("wechat.inbox.markDone")}
                  </Button>
                )}
              </div>
            )}
            {onEditRouting && (
              <button
                type="button"
                className="mt-2 text-[11px] underline-offset-2 hover:underline"
                onClick={onEditRouting}
              >
                {t("wechat.inbox.editCustomerLine")}
              </button>
            )}
          </div>
        ) : null}

        <div className="mt-6 rounded-xl border border-[var(--wx-border)] bg-[var(--wx-header-bg)] px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--wx-muted)]">
            {t("wechat.contacts.sectionAgentInsight")}
          </p>
          <p className="mt-1 text-[11px] text-[var(--wx-muted)]">
            {t("wechat.contacts.agentTagsHint")}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {allTags.length === 0 ? (
              <span className="text-xs text-[var(--wx-muted)]">—</span>
            ) : (
              allTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-dashed border-[var(--wx-border)] bg-[var(--wx-list-hover)] px-2 py-0.5 text-[11px] text-[var(--wx-muted)]"
                >
                  {tag}
                </span>
              ))
            )}
          </div>

          {session.kbHits.length > 0 && (
            <div className="mt-4 border-t border-[var(--wx-border)]/60 pt-3">
              <p className="text-[11px] text-[var(--wx-muted)]">
                {t("wechat.contacts.kbHits")}
              </p>
              <ul className="mt-1.5 space-y-1 text-xs text-[var(--wx-text)]">
                {session.kbHits.slice(0, 6).map((hit) => (
                  <li
                    key={hit}
                    className="truncate rounded-md bg-[var(--wx-list-hover)] px-2 py-1"
                  >
                    {hit}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {session.memoryState === "ready" && session.memoryLines.length > 0 && (
            <div className="mt-4 border-t border-[var(--wx-border)]/60 pt-3">
              <p className="text-[11px] text-[var(--wx-muted)]">
                {t("wechat.inbox.sectionMemory")}
              </p>
              <ul className="mt-1.5 space-y-1.5 text-xs leading-relaxed text-[var(--wx-text)]">
                {session.memoryLines.slice(0, 6).map((line) => (
                  <li
                    key={line}
                    className="rounded-md bg-[var(--wx-list-hover)] px-2.5 py-1.5"
                  >
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {session.memoryState === "offline" && (
            <p className="mt-4 text-xs italic text-[var(--wx-muted)]">
              {t("wechat.inbox.memoryOffline")}
            </p>
          )}
        </div>

        {(typesConfig?.types.length ?? 0) === 0 && (
          <button
            type="button"
            className="mt-6 text-xs text-[var(--wx-accent)] hover:underline"
            onClick={() =>
              openSettingsModal({ group: "wechat-ops", tab: "customer-types" })
            }
          >
            {t("wechat.contacts.configureCustomerTypes")}
          </button>
        )}
      </div>
    </div>
  )
}
