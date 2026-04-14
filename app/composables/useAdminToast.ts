type ToastType = 'success' | 'error'

interface AdminToast {
  id: number
  msg: string
  type: ToastType
}

export function useAdminToast() {
  const toasts = ref<AdminToast[]>([])
  let toastId = 0

  const showToast = (msg: string, type: ToastType) => {
    const id = ++toastId
    toasts.value.push({ id, msg, type })
    setTimeout(() => {
      toasts.value = toasts.value.filter((toast) => toast.id !== id)
    }, 3500)
  }

  return { toasts, showToast }
}
