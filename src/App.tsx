import { useEffect, useState, type CSSProperties, type ChangeEvent, type FormEvent, type MouseEvent, type ReactNode } from 'react'
import {
  WalletCards,
  Terminal,
  AppWindow,
  ChevronRight,
  Cpu,
  Kanban,
  ShieldAlert,
  ExternalLink,
  UserCheck,
  LogOut,
  LogIn,
  X,
  Lock,
  UserPlus,
  Gamepad2,
  Activity,
} from 'lucide-react'
import {
  getSessionUser,
  logout,
  signInWithEmail,
  signUpWithEmail,
  type SessionUser,
} from './utils/sharedAuth'
import {
  getNextTargetLabel,
  hasNextParam,
  resolveNextTarget,
} from './utils/nextParam'
import { Turnstile } from './components/Turnstile'
import { hasTurnstileSiteKey } from './utils/turnstile'
import './App.css'

type AuthMessage = {
  type: 'success' | 'error'
  text: string
}

type AppStatus = 'Active' | 'In Dev' | 'Planned'

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
  const nextHintHost = getNextTargetLabel(currentSearch)
  const captchaEnabled = hasTurnstileSiteKey()

  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null)
  const [showAuthModal, setShowAuthModal] = useState(() => nextHintHost !== null)
  const [isSignUp, setIsSignUp] = useState(false)

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
        setAuthMessage({ type: 'success', text: 'Đăng ký thành công! Vui lòng kiểm tra email để xác nhận (nếu có).' })
      } else {
        const { data, error } = await signInWithEmail(
          authEmail,
          authPassword,
          signInCaptchaToken ?? undefined,
        )
        if (error) throw error
        setCurrentUser(data.user)
        closeAuthModal()
        if (hasNextParam(window.location.search)) {
          window.location.assign(resolveNextTarget(window.location.search))
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

  const handleLogout = async () => {
    await logout()
    setCurrentUser(null)
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
      status: 'Active',
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
      status: 'Planned',
      color: '#8b5cf6',
      tags: ['Learning', 'PM/BrSE', 'Career Path', 'Glossary'],
    },
  ]

  const techStack: TechStackItem[] = [
    { name: 'React 19', icon: '⚛️' },
    { name: 'Vite', icon: '⚡' },
    { name: 'JavaScript (ES6+)', icon: '💛' },
    { name: 'Vanilla CSS & Grid', icon: '🎨' },
    { name: 'Supabase Auth & DB', icon: '⚡' },
    { name: 'Git & GitHub', icon: '🐙' },
  ]

  return (
    <>
      {/* Background Gradients & Grid */}
      <div className="cyber-grid"></div>
      <div className="ambient-glows">
        <div className="glow-purple"></div>
        <div className="glow-cyan"></div>
      </div>

      <div className="portal-wrapper">
        {/* Navigation / Header */}
        <header className="portal-header">
          <div className="brand">
            <div className="brand-icon">
              <Terminal />
            </div>
            <span className="brand-name">YunDev.space</span>
          </div>

          <div className="social-links" style={{ alignItems: 'center', gap: '0.75rem' }}>
            {currentUser ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="tag-badge" style={{ borderColor: 'var(--neon-green)', color: 'var(--neon-green)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <UserCheck size={14} /> {currentUser.email}
                </span>
                <button type="button" className="social-btn" onClick={handleLogout} title="Đăng xuất">
                  <LogOut size={16} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn-launch"
                style={{ marginTop: 0, padding: '0.45rem 0.9rem' }}
                onClick={openSignInModal}
              >
                <LogIn size={15} /> Đăng nhập
              </button>
            )}

            <a href="https://github.com/dungnv05" target="_blank" rel="noopener noreferrer" className="social-btn" aria-label="GitHub">
              <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
              </svg>
            </a>
          </div>
        </header>

        {/* Hero Section */}
        <section className="hero-section">
          <span className="cyber-tag">Supabase Auth Integrated // yundev.space</span>
          <h1 className="hero-title">
            Chào mừng đến với <br />
            <span className="gradient-text-purple">YunDev Ecosystem</span>
          </h1>
          <p className="hero-subtitle">
            Cổng thông tin và thư viện ứng dụng cá nhân độc lập. Tự động đồng bộ tài khoản và phiên đăng nhập trên toàn bộ tên miền phụ <code>*.yundev.space</code>.
          </p>
        </section>

        {/* Apps Grid */}
        <section className="apps-section">
          <div className="section-header">
            <h2 className="section-title">
              <AppWindow style={{ color: 'var(--neon-purple)' }} /> Kho Ứng Dụng Subdomain
            </h2>
            <p className="section-subtitle">Mỗi ứng dụng chạy độc lập tại từng Subdomain tương ứng</p>
          </div>

          <div className="apps-grid">
            {apps.map((app, index) => (
              <div
                key={index}
                className="cyber-card app-card"
                style={{ '--accent-color': app.color } as CSSProperties}
              >
                <div>
                  <div className="card-overlay"></div>

                  {/* Status Tag */}
                  <span className={`app-status ${app.status === 'Active' ? 'status-active' : 'status-dev'}`}>
                    {app.status}
                  </span>

                  {/* App Icon */}
                  <div className="app-icon">
                    {app.icon}
                  </div>

                  {/* App Details */}
                  <div className="app-meta">
                    <h3 className="app-name">{app.name}</h3>
                    <p className="app-desc">{app.desc}</p>
                  </div>
                </div>

                {/* Footer of card */}
                <div>
                  <div className="app-tags">
                    {app.tags.map((tag, tIdx) => (
                      <span key={tIdx} className="tag-badge">{tag}</span>
                    ))}
                  </div>
                  <a
                    href={app.url}
                    target={app.status === 'Active' ? '_blank' : '_self'}
                    rel="noopener noreferrer"
                    className="btn-launch"
                    style={{ marginTop: '1.25rem' }}
                  >
                    {app.status === 'Active' ? `Truy cập ${app.url.replace('https://', '')}` : 'Đang phát triển'}
                    {app.status === 'Active' ? <ExternalLink size={14} /> : <ChevronRight size={14} />}
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Tech Stack Pills */}
        <section className="tech-section">
          <div className="section-header" style={{ marginBottom: '1.5rem' }}>
            <h2 className="section-title">
              <Cpu style={{ color: 'var(--neon-cyan)' }} /> Kiến Trúc & Công Nghệ
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
              <button type="button" className="btn-close" onClick={closeAuthModal}>
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
                <label>Địa chỉ Email</label>
                <input
                  type="email"
                  required
                  placeholder="name@yundev.space"
                  value={authEmail}
                  onChange={handleEmailChange}
                />
              </div>

              <div className="auth-input-group">
                <label>Mật khẩu</label>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={authPassword}
                  onChange={handlePasswordChange}
                />
              </div>

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

              <button type="submit" className="btn-launch btn-auth-submit" disabled={isSubmitDisabled}>
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
