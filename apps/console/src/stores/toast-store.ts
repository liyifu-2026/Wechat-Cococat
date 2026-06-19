import { create } from "zustand"

export interface Toast {
  id: string
  message: string
  type: "success" | "error" | "info"
}

interface ToastState {
  toasts: Toast[]
  addToast: (message: string, type?: Toast["type"]) => void
  removeToast: (id: string) => void
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>()
let toastSeq = 0

function nextToastId(): string {
  toastSeq = (toastSeq + 1) % Number.MAX_SAFE_INTEGER
  return `toast-${Date.now().toString(36)}-${toastSeq.toString(36)}`
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (message, type = "info") => {
    const id = nextToastId()
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }))
    const timeout = setTimeout(() => {
      toastTimeouts.delete(id)
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 2500)
    toastTimeouts.set(id, timeout)
  },
  removeToast: (id) => {
    const timeout = toastTimeouts.get(id)
    if (timeout) {
      clearTimeout(timeout)
      toastTimeouts.delete(id)
    }
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },
}))
