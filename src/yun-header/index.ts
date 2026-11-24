import {
  YunHeader,
  type YunHeaderApp,
  type YunHeaderAuthChangeDetail,
  type YunHeaderMenuToggleDetail,
  type YunHeaderState,
  type YunHeaderUser,
  type YunHeaderVariant,
} from './yun-header'

export {
  YunHeader,
  type YunHeaderApp,
  type YunHeaderAuthChangeDetail,
  type YunHeaderMenuToggleDetail,
  type YunHeaderState,
  type YunHeaderUser,
  type YunHeaderVariant,
}

export function defineYunHeader(tagName = 'yun-header'): void {
  if (typeof customElements !== 'undefined' && !customElements.get(tagName)) {
    customElements.define(tagName, YunHeader)
  }
}

defineYunHeader()
