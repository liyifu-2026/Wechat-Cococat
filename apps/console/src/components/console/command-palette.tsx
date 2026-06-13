import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  BookOpen,
  Brain,
  Cat,
  Layers,
  MessageCircle,
  Palette,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { fetchDriverChats, type DriverChat } from "@/lib/driver-client"
import {
  resolveChatSearch,
  searchMessagesAcrossChats,
} from "@/lib/unified-inbox-search"
import { chatDisplayName } from "@/lib/wechat-ui"
import { stackCommand } from "@/lib/stack-client"
import { useToastStore } from "@/stores/toast-store"
import { useConsoleStore, type ConsoleModule } from "@/stores/console-store"
type CommandItem = {
  id: string
  label: string
  group: string
  keywords?: string
  icon?: typeof Cat
  run: () => void | Promise<void>
}

function matchesQuery(item: CommandItem, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const hay = `${item.label} ${item.keywords ?? ""} ${item.id} ${item.group}`.toLowerCase()
  return hay.includes(q)
}

export function CommandPalette() {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const setActiveModule = useConsoleStore((s) => s.setActiveModule)
  const navigateBrain = useConsoleStore((s) => s.navigateBrain)
  const navigateInbox = useConsoleStore((s) => s.navigateInbox)
  const navigateInboxChat = useConsoleStore((s) => s.navigateInboxChat)
  const navigateSystemWechat = useConsoleStore((s) => s.navigateSystemWechat)
  const navigateStack = useConsoleStore((s) => s.navigateStack)
  const navigateSettings = useConsoleStore((s) => s.navigateSettings)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState(0)
  const [chatCommands, setChatCommands] = useState<CommandItem[]>([])
  const [messageCommands, setMessageCommands] = useState<CommandItem[]>([])
  const [cachedChats, setCachedChats] = useState<DriverChat[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const runAndClose = useCallback((run: () => void | Promise<void>) => {
    return async () => {
      setOpen(false)
      setQuery("")
      setSelected(0)
      await run()
    }
  }, [])

  const runStack = useCallback(
    async (service: "all" | "driver", action: "start" | "stop") => {
      try {
        await stackCommand(service, action)
        addToast(
          t(
            action === "start"
              ? "console.palette.stackStarted"
              : "console.palette.stackStopped",
          ),
          "success",
        )
      } catch (err) {
        addToast(err instanceof Error ? err.message : String(err), "error")
      }
    },
    [addToast, t],
  )

  const staticCommands = useMemo((): CommandItem[] => {
    const module = (id: ConsoleModule, labelKey: string, icon: typeof Cat): CommandItem => ({
      id: `module-${id}`,
      label: t(labelKey),
      group: t("console.palette.groupModules"),
      keywords: id,
      icon,
      run: runAndClose(() => setActiveModule(id)),
    })

    return [
      module("overview", "console.modules.overview", Cat),
      module("inbox", "console.modules.inbox", MessageCircle),
      module("brain", "console.modules.brain", Brain),
      module("system", "console.modules.system", Layers),
      {
        id: "module-brain-kb",
        label: t("console.modules.wiki"),
        group: t("console.palette.groupModules"),
        keywords: "wiki knowledge kb brain",
        icon: BookOpen,
        run: runAndClose(() => navigateBrain("kb")),
      },
      {
        id: "stack-start-all",
        label: t("console.palette.startAll"),
        group: t("console.palette.groupStack"),
        keywords: "start stack driver memory agent",
        icon: Layers,
        run: runAndClose(() => runStack("all", "start")),
      },
      {
        id: "stack-stop-all",
        label: t("console.palette.stopAll"),
        group: t("console.palette.groupStack"),
        keywords: "stop stack",
        icon: Layers,
        run: runAndClose(() => runStack("all", "stop")),
      },
      {
        id: "stack-start-driver",
        label: t("console.palette.startDriver"),
        group: t("console.palette.groupStack"),
        keywords: "driver start",
        icon: Layers,
        run: runAndClose(() => runStack("driver", "start")),
      },
      {
        id: "wechat-connect",
        label: t("console.palette.wechatConnect"),
        group: t("console.palette.groupWechat"),
        keywords: "connect login qr",
        icon: MessageCircle,
        run: runAndClose(() => navigateSystemWechat()),
      },
      {
        id: "wechat-desktop",
        label: t("console.palette.wechatDesktop"),
        group: t("console.palette.groupWechat"),
        keywords: "desktop vnc",
        icon: MessageCircle,
        run: runAndClose(() => navigateSystemWechat(true)),
      },
      {
        id: "wechat-chats",
        label: t("console.palette.wechatChats"),
        group: t("console.palette.groupWechat"),
        keywords: "chats session",
        icon: MessageCircle,
        run: runAndClose(() => navigateInbox("chats")),
      },
      {
        id: "settings-interface",
        label: t("console.palette.settingsInterface"),
        group: t("console.palette.groupSettings"),
        keywords: "theme dark language interface",
        icon: Palette,
        run: runAndClose(() => navigateSettings("system", "interface")),
      },
      {
        id: "settings-cococat",
        label: t("console.palette.settingsCococat"),
        group: t("console.palette.groupSettings"),
        keywords: "token path config",
        icon: Cat,
        run: runAndClose(() => navigateSettings("cococat", "agent-llm")),
      },
      {
        id: "stack-services",
        label: t("console.palette.openStackServices"),
        group: t("console.palette.groupStack"),
        keywords: "stack service health",
        icon: Layers,
        run: runAndClose(() => navigateStack("service")),
      },
    ]
  }, [
    navigateSettings,
    navigateStack,
    navigateSystemWechat,
    navigateInbox,
    runAndClose,
    runStack,
    setActiveModule,
    navigateBrain,
    t,
  ])

  const allCommands = useMemo(
    () => [...staticCommands, ...chatCommands, ...messageCommands],
    [staticCommands, chatCommands, messageCommands],
  )

  const filtered = useMemo(
    () => allCommands.filter((c) => matchesQuery(c, query)),
    [allCommands, query],
  )

  useEffect(() => {
    setSelected((prev) => Math.min(prev, Math.max(0, filtered.length - 1)))
  }, [filtered.length])

  useEffect(() => {
    if (!open) return
    void fetchDriverChats(80)
      .then(setCachedChats)
      .catch(() => setCachedChats([]))
  }, [open])

  useEffect(() => {
    if (!open) {
      setChatCommands([])
      setMessageCommands([])
      return
    }
    let cancelled = false
    const run = async () => {
      const chats = await resolveChatSearch(query, cachedChats, 30)
      if (cancelled) return
      setChatCommands(
        chats.map((chat) => ({
          id: `chat-${chat.id}`,
          label: t("console.palette.openChat", {
            name: chatDisplayName(chat),
          }),
          group: t("console.palette.groupChats"),
          keywords: `${chat.id} ${chat.name ?? ""} ${chat.remark ?? ""} ${chat.username ?? ""}`,
          icon: MessageCircle,
          run: runAndClose(() => navigateInboxChat(chat.id)),
        })),
      )
      const q = query.trim()
      if (q.length < 2) {
        setMessageCommands([])
        return
      }
      const hits = await searchMessagesAcrossChats(q, cachedChats, {
        hitLimit: 6,
      })
      if (cancelled) return
      setMessageCommands(
        hits.map((hit) => ({
          id: `msg-${hit.chat.id}-${hit.message.localId ?? hit.snippet}`,
          label: t("console.palette.openMessage", {
            name: chatDisplayName(hit.chat),
            snippet: hit.snippet,
          }),
          group: t("console.palette.groupMessages"),
          keywords: hit.snippet,
          icon: MessageCircle,
          run: runAndClose(() => navigateInboxChat(hit.chat.id)),
        })),
      )
    }
    const id = window.setTimeout(() => void run(), query.trim() ? 150 : 0)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [cachedChats, navigateInboxChat, open, query, runAndClose, t])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((v) => !v)
        return
      }
      if (!open) return
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelected((i) => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelected((i) => Math.max(i - 1, 0))
      } else if (e.key === "Enter" && filtered[selected]) {
        e.preventDefault()
        void filtered[selected].run()
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [filtered, open, selected])

  useEffect(() => {
    if (open) {
      const id = window.setTimeout(() => inputRef.current?.focus(), 0)
      return () => window.clearTimeout(id)
    }
    setQuery("")
    setSelected(0)
  }, [open])

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-cmd-index="${selected}"]`)
    el?.scrollIntoView({ block: "nearest" })
  }, [selected])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="gap-0 overflow-hidden p-0 sm:max-w-lg"
      >
        <DialogTitle className="sr-only">{t("console.palette.title")}</DialogTitle>
        <div className="border-b px-3 py-2">
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelected(0)
            }}
            placeholder={t("console.palette.placeholder")}
            className="border-0 shadow-none focus-visible:ring-0"
          />
        </div>
        <div
          ref={listRef}
          className="max-h-[min(360px,50vh)] overflow-y-auto py-1"
          role="listbox"
        >
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              {t("console.palette.empty")}
            </p>
          ) : (
            filtered.map((item, index) => {
              const Icon = item.icon
              const active = index === selected
              return (
                <button
                  key={item.id}
                  type="button"
                  data-cmd-index={index}
                  role="option"
                  aria-selected={active}
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors ${
                    active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                  }`}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => void item.run()}
                >
                  {Icon ? (
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <span className="w-4 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {item.group}
                  </span>
                </button>
              )
            })
          )}
        </div>
        <div className="border-t px-4 py-2 text-xs text-muted-foreground">
          {t("console.palette.hint")}
        </div>
      </DialogContent>
    </Dialog>
  )
}
