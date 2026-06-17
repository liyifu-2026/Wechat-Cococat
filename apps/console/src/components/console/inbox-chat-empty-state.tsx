import logoImg from "@/assets/logo.jpg"

export function InboxChatEmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6">
      <img
        src={logoImg}
        alt="CocoCat"
        className="h-16 w-16 rounded-[22%] shadow-sm ring-1 ring-black/5 dark:ring-white/10"
        draggable={false}
      />
      <p className="text-lg font-semibold tracking-tight text-[var(--wx-text)]">
        CocoCat
      </p>
    </div>
  )
}
