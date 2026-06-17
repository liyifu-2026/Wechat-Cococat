import { create } from "zustand"
import { revokeObjectUrlIfBlob } from "@/lib/blob-url"

export type LightboxItem = {
  id: string
  src: string
  alt?: string
  subtitle?: string
  filename?: string
  /** Inbox media lazy-load when src is empty at open time. */
  mediaRef?: { chatId: string; localId: number }
  onJumpToSource?: () => void | Promise<void>
}

type LightboxState = {
  active: boolean
  items: LightboxItem[]
  index: number
  open: (params: { items: LightboxItem[]; index?: number }) => void
  close: () => void
  setIndex: (index: number) => void
  next: () => void
  prev: () => void
}

function revokeItemSrc(item: LightboxItem): void {
  revokeObjectUrlIfBlob(item.src)
}

export const useLightboxStore = create<LightboxState>((set, get) => ({
  active: false,
  items: [],
  index: 0,

  open: ({ items, index = 0 }) => {
    if (items.length === 0) return
    const clamped = Math.min(Math.max(0, index), items.length - 1)
    set({ active: true, items, index: clamped })
  },

  close: () => {
    for (const item of get().items) {
      revokeItemSrc(item)
    }
    set({ active: false, items: [], index: 0 })
  },

  setIndex: (index) => {
    const { items } = get()
    if (items.length === 0) return
    const next = ((index % items.length) + items.length) % items.length
    set({ index: next })
  },

  next: () => {
    const { index, items } = get()
    if (items.length <= 1) return
    get().setIndex(index + 1)
  },

  prev: () => {
    const { index } = get()
    get().setIndex(index - 1)
  },
}))
