export const PROD_HOSTS = Object.freeze([
  'yundev.space',
  'www.yundev.space',
  'tinh-luong.yundev.space',
  'brse.yundev.space',
  'vang-vong-su-viet.yundev.space',
  'ivf-journey.yundev.space',
]);

export const PROD_ORIGINS = Object.freeze(
  PROD_HOSTS.map((host) => `https://${host}`),
);

export const DEV_ORIGINS = Object.freeze([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

export function isAllowedHost(hostname) {
  if (typeof hostname !== 'string' || hostname.length === 0) {
    return false;
  }
  return PROD_HOSTS.includes(hostname.toLowerCase());
}

export function isAllowedOrigin(origin, { allowDev = false } = {}) {
  if (typeof origin !== 'string' || origin.length === 0) {
    return false;
  }
  const normalized = origin.toLowerCase();
  if (PROD_ORIGINS.includes(normalized)) {
    return true;
  }
  if (allowDev && DEV_ORIGINS.includes(normalized)) {
    return true;
  }
  return false;
}
