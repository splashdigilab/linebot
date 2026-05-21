type ToastType = 'success' | 'error' | 'warning'

interface AdminToast {
  id: number
  msg: string
  type: ToastType
}

/** 全站共用 toast 佇列（須搭配 layout 內的 AdminToastHost） */
export function useAdminToast() {
  const toasts = useState<AdminToast[]>('admin-toasts', () => [])
  const toastId = useState('admin-toast-id', () => 0)

  const showToast = (msg: string, type: ToastType) => {
    const id = ++toastId.value
    toasts.value = [...toasts.value, { id, msg, type }]
    setTimeout(() => {
      toasts.value = toasts.value.filter((toast) => toast.id !== id)
    }, 3500)
  }

  return { toasts, showToast }
}
