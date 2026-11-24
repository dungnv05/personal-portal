import type { DetailedHTMLProps, HTMLAttributes } from 'react'
import type { YunHeader } from './yun-header'

export type YunHeaderElementAttributes = DetailedHTMLProps<
  HTMLAttributes<YunHeader>,
  YunHeader
> & {
  app?: 'portal' | 'tinh-luong' | 'brse' | 'vang-vong' | 'ivf' | string
  'auth-base'?: string
  variant?: 'bar' | 'overlay'
  'profile-url'?: string
  'hide-account'?: boolean
  'skip-target'?: string
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'yun-header': YunHeaderElementAttributes
    }
  }
}
