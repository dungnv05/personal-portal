export declare const PROD_HOSTS: readonly string[]
export declare const PROD_ORIGINS: readonly string[]
export declare const DEV_ORIGINS: readonly string[]

export declare function isAllowedHost(hostname: string): boolean
export declare function isAllowedOrigin(
  origin: string,
  options?: { allowDev?: boolean },
): boolean
