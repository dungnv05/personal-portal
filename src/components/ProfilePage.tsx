import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { updateDisplayName, type SessionUser } from '../utils/sharedAuth'
import type { YunHeader } from '../yun-header'

export type ProfilePageProps = {
  user: SessionUser | null
  onOpenSignIn: () => void
  onUserUpdated?: (user: SessionUser) => void
}

type SaveStatus = {
  type: 'success' | 'error'
  text: string
}

function resolveDisplayName(user: SessionUser): string {
  const explicit = typeof user.display_name === 'string' ? user.display_name.trim() : ''
  if (explicit.length > 0) {
    return explicit
  }
  const emailLocal = user.email?.split('@')[0]?.trim() ?? ''
  return emailLocal.length > 0 ? emailLocal : 'User'
}

function computeInitials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean).slice(0, 2)
  if (words.length === 0) {
    return 'U'
  }
  return words
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toUpperCase()
}

export function ProfilePage({ user, onOpenSignIn, onUserUpdated }: ProfilePageProps) {
  const [displayNameInput, setDisplayNameInput] = useState(() =>
    user ? (user.display_name?.trim() ?? '') : '',
  )
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<SaveStatus | null>(null)

  const userId = user?.id ?? null
  const syncedDisplayName = user?.display_name?.trim() ?? ''

  useEffect(() => {
    setDisplayNameInput(userId ? syncedDisplayName : '')
  }, [userId, syncedDisplayName])

  if (!user) {
    return (
      <section className="cyber-card profile-card" aria-labelledby="profile-heading">
        <h2 id="profile-heading" className="section-title">Hồ sơ</h2>
        <div className="profile-signed-out">
          <p className="profile-note">Vui lòng đăng nhập để xem hồ sơ của bạn.</p>
          <button type="button" className="btn btn-primary" onClick={onOpenSignIn}>
            Đăng nhập
          </button>
        </div>
      </section>
    )
  }

  const resolvedName = resolveDisplayName(user)
  const initials = computeInitials(resolvedName)

  const handleNameChange = (event: ChangeEvent<HTMLInputElement>) => {
    setDisplayNameInput(event.target.value)
    if (status) {
      setStatus(null)
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = displayNameInput.trim()
    if (trimmed.length === 0 || trimmed.length > 50) {
      setStatus({ type: 'error', text: 'Không lưu được, thử lại.' })
      return
    }

    setSaving(true)
    setStatus(null)

    try {
      const { user: updatedUser, error } = await updateDisplayName(trimmed)
      if (error || !updatedUser) {
        setStatus({ type: 'error', text: 'Không lưu được, thử lại.' })
        return
      }

      setStatus({ type: 'success', text: 'Đã lưu.' })
      onUserUpdated?.(updatedUser)
      const headerEl = document.querySelector<YunHeader>('yun-header')
      if (headerEl && typeof headerEl.refresh === 'function') {
        void headerEl.refresh()
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="cyber-card profile-card" aria-labelledby="profile-heading">
      <h2 id="profile-heading" className="section-title">Hồ sơ</h2>

      <div className="profile-identity">
        <div className="profile-avatar" aria-hidden="true">
          {initials}
        </div>
        <div className="profile-meta">
          <p className="profile-name">{resolvedName}</p>
          {user.email && <p className="profile-email">{user.email}</p>}
        </div>
      </div>

      <form className="profile-form" onSubmit={handleSubmit}>
        <div className="auth-input-group profile-field">
          <label htmlFor="profile-display-name">Tên hiển thị</label>
          <input
            id="profile-display-name"
            type="text"
            value={displayNameInput}
            onChange={handleNameChange}
            maxLength={50}
            required
            disabled={saving}
            placeholder="Nhập tên hiển thị"
          />
        </div>

        <div className="profile-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            Lưu
          </button>
          {status?.type === 'success' && (
            <p className="profile-feedback profile-feedback-success" role="status">
              {status.text}
            </p>
          )}
          {status?.type === 'error' && (
            <p className="profile-feedback profile-feedback-error" role="alert">
              {status.text}
            </p>
          )}
        </div>
      </form>
    </section>
  )
}
