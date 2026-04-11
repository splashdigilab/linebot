import {
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth'

export const useAuth = () => {
  const { $auth } = useNuxtApp()
  const user = useState<User | null>('auth:user', () => null)
  const loading = useState<boolean>('auth:loading', () => true)

  // Initialize listener once
  if (import.meta.client) {
    onAuthStateChanged($auth, (u) => {
      user.value = u
      loading.value = false
    })
  }

  async function loginWithGoogle() {
    const provider = new GoogleAuthProvider()
    await signInWithPopup($auth, provider)
  }

  async function logout() {
    await signOut($auth)
    await navigateTo('/login')
  }

  const isLoggedIn = computed(() => !!user.value)

  return { user, loading, isLoggedIn, loginWithGoogle, logout }
}
