import {
  isAllowedAuthOrigin,
  YunHeader,
  type YunHeaderApp,
  type YunHeaderAuthChangeDetail,
  type YunHeaderMenuToggleDetail,
  type YunHeaderState,
  type YunHeaderUser,
  type YunHeaderVariant,
} from './yun-header'
import {
  initTheme,
  resolveTheme,
  setTheme,
  THEME_COOKIE,
  THEME_EVENT,
  THEME_STORAGE_KEY,
  type YunTheme,
  type YunThemeChangeDetail,
  type YunThemeSource,
} from './theme'

export {
  initTheme,
  isAllowedAuthOrigin,
  resolveTheme,
  setTheme,
  THEME_COOKIE,
  THEME_EVENT,
  THEME_STORAGE_KEY,
  YunHeader,
  type YunHeaderApp,
  type YunHeaderAuthChangeDetail,
  type YunHeaderMenuToggleDetail,
  type YunHeaderState,
  type YunHeaderUser,
  type YunHeaderVariant,
  type YunTheme,
  type YunThemeChangeDetail,
  type YunThemeSource,
}

export function defineYunHeader(tagName = 'yun-header'): void {
  if (typeof customElements !== 'undefined' && !customElements.get(tagName)) {
    customElements.define(tagName, YunHeader)
  }
}

initTheme()
defineYunHeader()
