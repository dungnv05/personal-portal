import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type MouseEvent, type ReactNode } from 'react'
import {
  WalletCards,
  Terminal,
  AppWindow,
  Cpu,
  Kanban,
  ShieldAlert,
  ExternalLink,
  X,
  Lock,
  UserPlus,
  Gamepad2,
  Activity,
} from 'lucide-react'
import {
  getSessionUser,
  signInWithEmail,
  signUpWithEmail,
  type SessionUser,
} from './utils/sharedAuth'
import type { YunHeader, YunHeaderAuthChangeDetail } from './yun-header'
import { getNextTargetLabel, hasNextParam } from './utils/nextParam'
import { resolveNextUrl } from './utils/nextUrl'
import { assignLocation, replaceLocation } from './utils/navigation'
import {
  clearNextRedirectGuard,
  decideNextAction,
  getInitialAuthModalOpen,
  readSessionStorageSafe,
  recordNextRedirect,
} from './utils/nextAutoRedirect'
import { Turnstile } from './components/Turnstile'
import { ProfilePage } from './components/ProfilePage'
import { hasTurnstileSiteKey } from './utils/turnstile'
import './App.css'

type AuthMessage = {
  type: 'success' | 'error'
  text: string
}

type AppStatus = 'Active' | 'Beta' | 'In Dev' | 'Planned'

const STATUS_ORDER: Record<AppStatus, number> = {
  Active: 0,
  Beta: 1,
  'In Dev': 2,
  Planned: 3,
}

const STATUS_BADGE: Record<AppStatus, { className: string; label: string }> = {
  Active: { className: 'status-active', label: 'Active' },
  Beta: { className: 'status-beta', label: 'Beta' },
  'In Dev': { className: 'status-dev', label: 'Đang phát triển' },
  Planned: { className: 'status-dev', label: 'Planned' },
}

type AppCard = {
  name: string
  desc: string
  icon: ReactNode
  url: string
  status: AppStatus
  color: string
  tags: string[]
}

type TechStackItem = {
  name: string
  icon: string
}

function App() {
  const currentSearch = typeof window !== 'undefined' ? window.location.search : ''
  const searchParams = new URLSearchParams(currentSearch)
  const authParam = searchParams.get('auth')
  const isProfileView = searchParams.get('view') === 'profile'
  const nextHintHost = getNextTargetLabel(currentSearch)
  const captchaEnabled = hasTurnstileSiteKey()

  const headerRef = useRef<YunHeader | null>(null)
  const hasAutoRedirectedRef = useRef(false)
  const hasOpenedNextModalRef = useRef(false)
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null)
  const [authResolved, setAuthResolved] = useState(false)
  const [blockedNextUrl, setBlockedNextUrl] = useState<string | null>(null)
  const [showAuthModal, setShowAuthModal] = useState(
    () => getInitialAuthModalOpen(currentSearch),
  )
  const [isSignUp, setIsSignUp] = useState(() => authParam === 'signup')

  // Auth Form State
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [authMessage, setAuthMessage] = useState<AuthMessage | null>(null)
  const [signInCaptchaToken, setSignInCaptchaToken] = useState<string | null>(null)
  const [signUpCaptchaToken, setSignUpCaptchaToken] = useState<string | null>(null)
  const [turnstileResetKey, setTurnstileResetKey] = useState(0)

  const activeCaptchaToken = isSignUp ? signUpCaptchaToken : signInCaptchaToken
  const isSubmitDisabled = authLoading || (captchaEnabled && !activeCaptchaToken)

  const openSignInModal = () => {
    setIsSignUp(false)
    setAuthMessage(null)
    setSignInCaptchaToken(null)
    setSignUpCaptchaToken(null)
    setShowAuthModal(true)
  }

  const openSignUpModal = () => {
    setIsSignUp(true)
    setAuthMessage(null)
    setSignInCaptchaToken(null)
    setSignUpCaptchaToken(null)
    setShowAuthModal(true)
  }

  const closeAuthModal = () => {
    setShowAuthModal(false)
    setSignInCaptchaToken(null)
    setSignUpCaptchaToken(null)
  }

  const switchAuthMode = (nextIsSignUp: boolean) => {
    setIsSignUp(nextIsSignUp)
    setAuthMessage(null)
    setSignInCaptchaToken(null)
    setSignUpCaptchaToken(null)
  }

  useEffect(() => {
    let active = true

    const refreshSession = () => {
      void getSessionUser().then((user) => {
        if (active) {
          setCurrentUser(user)
          setAuthResolved(true)
        }
      })
    }

    refreshSession()

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refreshSession()
      }
    }

    window.addEventListener('focus', refreshSession)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      active = false
      window.removeEventListener('focus', refreshSession)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined' && !hasNextParam(window.location.search)) {
      clearNextRedirectGuard(readSessionStorageSafe())
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || hasAutoRedirectedRef.current) {
      return
    }
    const action = decideNextAction({
      search: window.location.search,
      authResolved,
      signedIn: currentUser !== null,
      currentOrigin: window.location.origin,
      storage: readSessionStorageSafe(),
      now: Date.now(),
    })

    if (action.kind === 'wait' || action.kind === 'none') {
      setBlockedNextUrl(null)
      return
    }

    if (action.kind === 'open-signin') {
      setBlockedNextUrl(null)
      if (!hasOpenedNextModalRef.current) {
        hasOpenedNextModalRef.current = true
        setShowAuthModal(true)
      }
      return
    }

    if (action.kind === 'blocked') {
      setBlockedNextUrl(action.url)
      return
    }

    const storage = readSessionStorageSafe()
    if (!recordNextRedirect(storage, action.url, Date.now())) {
      setBlockedNextUrl(action.url)
      return
    }
    hasAutoRedirectedRef.current = true
    setBlockedNextUrl(null)
    replaceLocation(action.url)
  }, [authResolved, currentUser])

  useEffect(() => {
    const headerEl = headerRef.current
    if (!headerEl) {
      return
    }

    const onSignInClick = (event: Event) => {
      event.preventDefault()
      openSignInModal()
    }

    const onSignUpClick = (event: Event) => {
      event.preventDefault()
      openSignUpModal()
    }

    const onLogout = () => {
      setCurrentUser(null)
    }

    const onAuthChange = (event: Event) => {
      const detail = (event as CustomEvent<YunHeaderAuthChangeDetail>).detail
      setAuthResolved(true)
      if (detail?.user) {
        setCurrentUser({
          id: detail.user.id,
          email: detail.user.email,
          display_name: detail.user.rawDisplayName ?? null,
          avatar_url: detail.user.avatarUrl,
        })
      } else {
        setCurrentUser(null)
      }
    }

    headerEl.addEventListener('yh-signin-click', onSignInClick)
    headerEl.addEventListener('yh-signup-click', onSignUpClick)
    headerEl.addEventListener('yh-logout', onLogout)
    headerEl.addEventListener('yh-auth-change', onAuthChange)

    return () => {
      headerEl.removeEventListener('yh-signin-click', onSignInClick)
      headerEl.removeEventListener('yh-signup-click', onSignUpClick)
      headerEl.removeEventListener('yh-logout', onLogout)
      headerEl.removeEventListener('yh-auth-change', onAuthChange)
    }
  }, [])

  const handleAuthSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (captchaEnabled && !activeCaptchaToken) {
      setAuthMessage({ type: 'error', text: 'Vui lòng hoàn tất xác minh CAPTCHA.' })
      return
    }

    setAuthLoading(true)
    setAuthMessage(null)

    try {
      if (isSignUp) {
        const { error } = await signUpWithEmail(
          authEmail,
          authPassword,
          signUpCaptchaToken ?? undefined,
        )
        if (error) throw error
        const nextTarget = resolveNextUrl(window.location.search)
        if (nextTarget !== null) {
          clearNextRedirectGuard(readSessionStorageSafe())
          assignLocation(nextTarget)
        } else {
          setAuthMessage({ type: 'success', text: 'Đăng ký thành công! Vui lòng kiểm tra email để xác nhận (nếu có).' })
          void headerRef.current?.refresh()
        }
      } else {
        const { data, error } = await signInWithEmail(
          authEmail,
          authPassword,
          signInCaptchaToken ?? undefined,
        )
        if (error) throw error
        const nextTarget = resolveNextUrl(window.location.search)
        if (nextTarget !== null) {
          clearNextRedirectGuard(readSessionStorageSafe())
          assignLocation(nextTarget)
        } else {
          setCurrentUser(data.user)
          closeAuthModal()
          void headerRef.current?.refresh()
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Thao tác thất bại. Vui lòng thử lại.'
      setAuthMessage({ type: 'error', text: message })
    } finally {
      if (isSignUp) {
        setSignUpCaptchaToken(null)
      } else {
        setSignInCaptchaToken(null)
      }
      if (captchaEnabled) {
        setTurnstileResetKey((prev) => prev + 1)
      }
      setAuthLoading(false)
    }
  }

  const handleEmailChange = (e: ChangeEvent<HTMLInputElement>) => {
    setAuthEmail(e.target.value)
  }

  const handlePasswordChange = (e: ChangeEvent<HTMLInputElement>) => {
    setAuthPassword(e.target.value)
  }

  const apps: AppCard[] = [
    {
      name: 'SalaryFlow',
      desc: 'Công cụ tính lương Gross sang Net và ngược lại, cập nhật đầy đủ và chuẩn xác các chính sách bảo hiểm & thuế thu nhập cá nhân mới nhất năm 2026.',
      icon: <WalletCards />,
      url: 'https://tinh-luong.yundev.space',
      status: 'Active',
      color: '#06b6d4',
      tags: ['HTML5', 'Vanilla CSS', 'JavaScript', 'Chart.js'],
    },
    {
      name: 'Vang Vọng Sử Việt',
      desc: 'Web Game 3D Idle Gacha thẻ bài đề tài lịch sử Việt Nam. Chiêu mộ danh nhân lịch sử, dàn trận 6v6, kích hoạt Hợp Kích, Thần Khí và Linh Vật thần thoại.',
      icon: <Gamepad2 />,
      url: 'https://vang-vong-su-viet.yundev.space',
      status: 'In Dev',
      color: '#f59e0b',
      tags: ['React', 'Three.js', 'R3F', 'Zustand', 'TypeScript'],
    },
    {
      name: 'SecretVault',
      desc: 'Hệ thống ghi chú bảo mật, mã hóa dữ liệu end-to-end (E2EE) trực tiếp tại trình duyệt sử dụng Web Crypto API.',
      icon: <ShieldAlert />,
      url: 'https://vault.yundev.space',
      status: 'In Dev',
      color: '#ec4899',
      tags: ['React', 'Tailwind', 'Web Crypto API'],
    },
    {
      name: 'IVF Journey',
      desc: 'Nền tảng hỗ trợ và đồng hành cùng hành trình IVF. Theo dõi lịch trình, lưu trữ kết quả và kiến thức sinh sản.',
      icon: <Activity />,
      url: 'https://ivf-journey.yundev.space',
      status: 'Active',
      color: '#10b981',
      tags: ['React', 'Tailwind', 'Supabase'],
    },
    {
      name: 'PM / BrSE Track',
      desc: 'Lộ trình PM/BrSE thị trường Nhật bằng tiếng Việt: khóa học, glossary và career path.',
      icon: <Kanban />,
      url: 'https://brse.yundev.space',
      status: 'Beta',
      color: '#8b5cf6',
      tags: ['Learning', 'PM/BrSE', 'Career Path', 'Glossary'],
    },
  ]

  const sortedApps = [...apps].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
  )

  const techStack: TechStackItem[] = [
    { name: 'React 19', icon: '⚛️' },
    { name: 'Vite', icon: '⚡' },
    { name: 'JavaScript (ES6+)', icon: '💛' },
    { name: 'Vanilla CSS & Grid', icon: '🎨' },
    { name: 'Supabase Auth & DB', icon: '⚡' },
    { name: 'Git & GitHub', icon: '🐙' },
  ]

  const blockedNextHost = blockedNextUrl ? new URL(blockedNextUrl).host : null

  return (
    <>
      <div className="portal-wrapper">
        {/* Navigation / Header */}
        <yun-header
          ref={headerRef}
          app="portal"
          auth-base={typeof window !== 'undefined' ? window.location.origin : 'https://www.yundev.space'}
          profile-url="/?view=profile"
        >
          <div slot="brand" className="brand">
            <div className="brand-icon">
              <Terminal />
            </div>
            <span className="brand-name">YunDev.space</span>
          </div>

          <div slot="actions" className="social-links">
            <a
              href="https://github.com/dungnv05"
              target="_blank"
              rel="noopener noreferrer"
              className="social-btn"
              aria-label="GitHub"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
              </svg>
            </a>
          </div>
        </yun-header>

        <main id="main" className="portal-main">
          {blockedNextUrl && blockedNextHost && (
            <div className="auth-next-loop-notice" role="status">
              <span>{`Bạn đã đăng nhập. Mở lại ${blockedNextHost}?`}</span>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => assignLocation(blockedNextUrl)}
              >
                {`Tiếp tục tới ${blockedNextHost}`}
              </button>
            </div>
          )}
          {isProfileView && (
            <ProfilePage
              user={currentUser}
              authResolved={authResolved}
              onOpenSignIn={openSignInModal}
              onUserUpdated={setCurrentUser}
            />
          )}
          {/* Hero Section */}
          <section className="hero-section">
            <div className="hero-glow" aria-hidden="true"></div>
            <span className="cyber-tag">An toàn · Đồng bộ · Cá nhân</span>
            <h1 className="hero-title">
              Chào mừng đến với <span className="gradient-text-purple">YunDev</span> Ecosystem
            </h1>
            <p className="hero-subtitle">
              Cổng thông tin và thư viện ứng dụng cá nhân độc lập. Tự động đồng bộ tài khoản và phiên đăng nhập trên toàn bộ tên miền phụ <code>*.yundev.space</code>.
            </p>
          </section>

          {/* Apps Grid */}
          <section className="apps-section">
            <div className="section-header">
              <h2 className="section-title">
                <AppWindow className="section-title-icon" /> Kho Ứng Dụng Subdomain
              </h2>
              <p className="section-subtitle">Mỗi ứng dụng chạy độc lập tại từng Subdomain tương ứng</p>
            </div>

            <div className="apps-grid">
              {sortedApps.map((app) => {
                const isLaunchable = app.status === 'Active' || app.status === 'Beta'
                const badge = STATUS_BADGE[app.status]
                return (
                  <div
                    key={app.name}
                    className={`cyber-card app-card${isLaunchable ? '' : ' app-card-disabled'}`}
                  >
                    <div>
                      <div className="app-card-top">
                        {/* App Icon */}
                        <div className="app-icon">
                          {app.icon}
                        </div>

                        {/* Status Tag */}
                        <span className={`app-status ${badge.className}`}>
                          {badge.label}
                        </span>
                      </div>

                      {/* App Details */}
                      <div className="app-meta">
                        <h3 className="app-name">{app.name}</h3>
                        <p className="app-desc">{app.desc}</p>
                      </div>
                    </div>

                    {/* Footer of card */}
                    <div className="app-card-footer">
                      <div className="app-tags">
                        {app.tags.map((tag, tIdx) => (
                          <span key={tIdx} className="tag-badge">{tag}</span>
                        ))}
                      </div>
                      {isLaunchable ? (
                        <a
                          href={app.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-secondary btn-launch"
                        >
                          <span>{`Truy cập ${app.url.replace('https://', '')}`}</span>
                          <ExternalLink size={15} />
                        </a>
                      ) : (
                        <span
                          className="btn btn-secondary btn-launch btn-launch-disabled"
                          aria-disabled="true"
                        >
                          Đang phát triển
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {/* Tech Stack Pills */}
          <section className="tech-section">
            <div className="section-header">
              <h2 className="section-title">
                <Cpu className="section-title-icon section-title-icon-mint" /> Kiến Trúc & Công Nghệ
              </h2>
            </div>
            <div className="tech-grid">
              {techStack.map((tech, index) => (
                <div key={index} className="tech-pill">
                  <span>{tech.icon}</span>
                  <span>{tech.name}</span>
                </div>
              ))}
            </div>
          </section>
        </main>

        {/* Footer */}
        <footer className="portal-footer">
          <p>© 2026 YunDev.space. Tích hợp Supabase Authentication & Multi-Subdomain SSO.</p>
        </footer>
      </div>

      {/* Auth Modal */}
      {showAuthModal && (
        <div className="auth-modal-overlay" onClick={closeAuthModal}>
          <div className="cyber-card auth-modal-card" onClick={(e: MouseEvent<HTMLDivElement>) => e.stopPropagation()}>
            <div className="auth-modal-header">
              <h3>{isSignUp ? <UserPlus size={20} /> : <Lock size={20} />} {isSignUp ? 'Tạo Tài Khoản YunDev' : 'Đăng Nhập YunDev'}</h3>
              <button type="button" className="btn-close" onClick={closeAuthModal} aria-label="Đóng">
                <X size={18} />
              </button>
            </div>

            {authMessage && (
              <div className={`auth-alert ${authMessage.type === 'error' ? 'auth-alert-error' : 'auth-alert-success'}`}>
                {authMessage.text}
              </div>
            )}

            {!isSignUp && nextHintHost && (
              <p className="auth-next-hint" role="status">
                {`Sign in to continue to ${nextHintHost}`}
              </p>
            )}

            <form onSubmit={handleAuthSubmit} className="auth-form">
              <div className="auth-input-group">
                <label htmlFor="auth-email">Địa chỉ Email</label>
                <input
                  id="auth-email"
                  type="email"
                  required
                  placeholder="name@yundev.space"
                  value={authEmail}
                  onChange={handleEmailChange}
                />
              </div>

              <div className="auth-input-group">
                <label htmlFor="auth-password">Mật khẩu</label>
                <input
                  id="auth-password"
                  type="password"
                  required
                  placeholder="••••••••"
                  value={authPassword}
                  onChange={handlePasswordChange}
                />
              </div>

              <div id="turnstile-slot" className="turnstile-slot">
                {isSignUp ? (
                  <Turnstile
                    key={`signup-${turnstileResetKey}`}
                    theme="dark"
                    onToken={setSignUpCaptchaToken}
                  />
                ) : (
                  <Turnstile
                    key={`signin-${turnstileResetKey}`}
                    theme="dark"
                    onToken={setSignInCaptchaToken}
                  />
                )}
              </div>

              <button type="submit" className="btn btn-primary btn-launch btn-auth-submit" disabled={isSubmitDisabled}>
                {authLoading ? 'Đang xử lý...' : (isSignUp ? 'Đăng ký ngay' : 'Đăng nhập')}
              </button>
            </form>

            <div className="auth-modal-footer">
              {isSignUp ? (
                <span>Đã có tài khoản? <button type="button" className="auth-switch-link" onClick={() => switchAuthMode(false)}>Đăng nhập ngay</button></span>
              ) : (
                <span>Chưa có tài khoản? <button type="button" className="auth-switch-link" onClick={() => switchAuthMode(true)}>Đăng ký tài khoản</button></span>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default App
