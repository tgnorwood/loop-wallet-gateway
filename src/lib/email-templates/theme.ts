// Email clients need inline, concrete colors rather than application CSS variables.
// These roles mirror the hub's ink and signal-orange palette on a white body.
export const emailTheme = {
  body: '#ffffff',
  ink: '#17202e',
  muted: '#55575d',
  subtle: '#737780',
  signal: '#f59b45',
  font: '"Space Grotesk", Arial, sans-serif',
} as const