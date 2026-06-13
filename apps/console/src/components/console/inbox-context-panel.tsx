import { useState } from "react"
import { ArrowRight, Plus, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { DriverChat } from "@/lib/driver-client"
import type { EscalationMuteEntry } from "@/lib/agent-config-client"
import type { useInboxSessionContext } from "@/hooks/use-inbox-session-context"
import { ChatStyleSection } from "@/components/console/chat-style-section"
import { chatDisplayName } from "@/lib/wechat-ui"
import { useConsoleStore } from "@/stores/console-store"

type SessionContext = ReturnType<typeof useInboxSessionContext>

interface InboxContextPanelProps {
  chat: DriverChat | null
  muteEntry: EscalationMuteEntry | null
  session: SessionContext
  muteBusy?: boolean
  onUnmute?: () => void
  onMarkDone?: () => void
  onEditRouting?: () => void
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
    return t("console.inbox.muteEscalateA")
  }
  if (entry.reason === "probe_b" || entry.reason === "probe_loop") {
    return t("console.inbox.muteProbeB")
  }
  return t("console.inbox.muteGeneric")
}

function formatContactLabel(value: string | null): string {
  if (!value) return "—"
  const d = Date.parse(value)
  if (!Number.isNaN(d)) {
    try {
      return new Date(d).toLocaleString()
    } catch {
      return value
    }
  }
  return value
}

export function InboxContextPanel({
  chat,
  muteEntry,
  session,
  muteBusy = false,
  onUnmute,
  onMarkDone,
  onEditRouting,
}: InboxContextPanelProps) {
  const { t } = useTranslation()
  const openMemoryWithSession = useConsoleStore((s) => s.openMemoryWithSession)
  const navigateBrain = useConsoleStore((s) => s.navigateBrain)
  const [tagDraft, setTagDraft] = useState("")
  const [showTagInput, setShowTagInput] = useState(false)

  if (!chat) {
    return (
      <aside className="flex w-[280px] shrink-0 flex-col border-l border-[var(--wx-border)] bg-card">
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
          {t("console.inbox.contextEmpty")}
        </div>
      </aside>
    )
  }

  const name = chatDisplayName(chat)

  async function submitTag() {
    const v = tagDraft.trim()
    if (!v) return
    await session.addTag(v)
    setTagDraft("")
    setShowTagInput(false)
  }

  return (
    <aside className="flex w-[280px] shrink-0 flex-col overflow-auto border-l border-[var(--wx-border)] bg-card">
      <div className="p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("console.inbox.sessionPanel")}
        </h3>
        <p className="mt-2 text-base font-semibold">{name}</p>
        <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
          {chat.id}
        </p>

        <div className="mt-3 space-y-1 text-xs text-muted-foreground">
          <div className="flex justify-between gap-2">
            <span>{t("console.inbox.firstContact")}</span>
            <span className="text-right text-foreground">
              {formatContactLabel(session.firstContact)}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span>{t("console.inbox.lastContact")}</span>
            <span className="text-right text-foreground">
              {formatContactLabel(session.lastContact)}
            </span>
          </div>
        </div>

        {muteEntry ? (
          <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            <p className="font-medium">{muteLabel(muteEntry, t)}</p>
            <p className="mt-1 text-muted-foreground">
              {t("console.inbox.muteRemaining", {
                hours: muteHoursLeft(muteEntry),
              })}
            </p>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            {t("console.inbox.statusNormal")}
          </p>
        )}

        <div className="mt-4">
          <p className="text-xs font-medium text-muted-foreground">
            {t("console.inbox.sectionTags")}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {session.autoTags.map((tag) => (
              <span
                key={`auto-${tag}`}
                className="rounded border border-border bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
            {session.manualTags.map((tag) => (
              <span
                key={`manual-${tag}`}
                className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-[11px]"
              >
                {tag}
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  disabled={session.tagSaving}
                  aria-label={t("console.inbox.removeTag", { tag })}
                  onClick={() => void session.removeTag(tag)}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {showTagInput ? (
              <div className="flex w-full items-center gap-1">
                <Input
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  className="h-7 text-xs"
                  placeholder={t("console.inbox.tagPlaceholder")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submitTag()
                    if (e.key === "Escape") {
                      setShowTagInput(false)
                      setTagDraft("")
                    }
                  }}
                  autoFocus
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2"
                  disabled={session.tagSaving}
                  onClick={() => void submitTag()}
                >
                  {t("console.inbox.addTag")}
                </Button>
              </div>
            ) : (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/50"
                disabled={session.tagSaving}
                onClick={() => setShowTagInput(true)}
              >
                <Plus className="h-3 w-3" />
                {t("console.inbox.addTag")}
              </button>
            )}
          </div>
        </div>

        <div className="mt-4">
          <p className="text-xs font-medium text-muted-foreground">
            {t("console.inbox.sectionTriage")}
          </p>
          <p className="mt-1 rounded-md border bg-muted/30 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground">
            {session.loading ? "…" : session.triageSummary}
          </p>
        </div>

        <div className="mt-4">
          <p className="text-xs font-medium text-muted-foreground">
            {t("console.inbox.sectionKbHits")}
          </p>
          {session.kbHits.length > 0 ? (
            <ul className="mt-1 space-y-1 text-xs">
              {session.kbHits.map((k) => (
                <li key={k}>
                  <button
                    type="button"
                    className="text-left text-foreground underline-offset-2 hover:underline"
                    onClick={() =>
                      navigateBrain("kb", { topic: k, openInEditMode: false })
                    }
                  >
                    {k}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("console.inbox.kbPlaceholder")}
            </p>
          )}
        </div>

        <div className="mt-4 rounded-md border border-primary/20 bg-primary/5 px-3 py-3">
          <p className="text-xs font-medium text-foreground">
            {t("console.inbox.sectionStyle")}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("console.inbox.styleHint")}
          </p>
          <ChatStyleSection chatId={chat.id} />
        </div>

        <div className="mt-4">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">
              {t("console.inbox.sectionMemory")}
            </p>
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-primary hover:underline"
              onClick={() => openMemoryWithSession(chat.id)}
            >
              {session.memoryState === "offline"
                ? t("console.inbox.memoryOpenModule")
                : t("console.inbox.memoryViewFullL3")}
              <ArrowRight className="h-3 w-3" aria-hidden />
            </button>
          </div>
          {session.memoryState === "ready" ? (
            <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-foreground">
              {session.memoryLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              {session.memoryState === "offline"
                ? t("console.inbox.memoryOffline")
                : t("console.inbox.memoryEmpty")}
            </p>
          )}
        </div>

        {muteEntry && (onUnmute || onMarkDone) && (
          <div className="mt-4 flex flex-col gap-2">
            {onUnmute && (
              <Button
                size="sm"
                className="w-full"
                disabled={muteBusy}
                onClick={onUnmute}
              >
                {t("console.inbox.unmute")}
              </Button>
            )}
            {onMarkDone && (
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                disabled={muteBusy}
                onClick={onMarkDone}
              >
                {t("console.inbox.markDone")}
              </Button>
            )}
            {onEditRouting && (
              <Button
                size="sm"
                variant="ghost"
                className="w-full text-xs"
                onClick={onEditRouting}
              >
                {t("console.inbox.editCustomerLine")}
              </Button>
            )}
          </div>
        )}

        <details className="mt-4 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none font-medium">
            {t("console.inbox.maintainerCommands")}
          </summary>
          <p className="mt-2 font-mono text-[11px]">
            <code>列表</code> · <code>已处理</code> · <code>解除</code>
          </p>
        </details>
      </div>
    </aside>
  )
}
