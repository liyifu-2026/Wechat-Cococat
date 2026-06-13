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

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (message, type = "info") => {
    const id = Math.random().toString(36).slice(2)
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 2500)
  },
  removeToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
