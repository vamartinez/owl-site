/** Shared theme tokens — kept small and flat for RN StyleSheet usage. */
export const colors = {
  primary: '#4f46e5',
  primaryDark: '#4338ca',
  bg: '#f9fafb',
  card: '#ffffff',
  border: '#e5e7eb',
  text: '#111827',
  textMuted: '#6b7280',
  green: '#16a34a',
  greenBg: '#f0fdf4',
  greenBorder: '#bbf7d0',
  yellow: '#ca8a04',
  yellowBg: '#fefce8',
  yellowBorder: '#fef08a',
  red: '#dc2626',
  redBg: '#fef2f2',
  redBorder: '#fecaca',
  white: '#ffffff',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  full: 999,
} as const;
