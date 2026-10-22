// iCUE Page Personalization values forwarded by the EDGE widget wrapper. Only colors and a
// percentage are accepted, so a message can never inject anything but styling values.
export interface DisplayPersonalization {
  textColor: string
  accentColor: string
  backgroundColor: string
  transparency: number
}

export const PERSONALIZATION_MESSAGE = 'icue:personalization'
const HEX_COLOR = /^#[0-9a-f]{6}$/i

export function parsePersonalization(data: unknown): DisplayPersonalization | null {
  if (typeof data !== 'object' || data === null) return null
  const message = data as Record<string, unknown>
  if (message.type !== PERSONALIZATION_MESSAGE) return null
  const { textColor, accentColor, backgroundColor, transparency } = message
  if (typeof textColor !== 'string' || !HEX_COLOR.test(textColor)
    || typeof accentColor !== 'string' || !HEX_COLOR.test(accentColor)
    || typeof backgroundColor !== 'string' || !HEX_COLOR.test(backgroundColor)
    || typeof transparency !== 'number' || !Number.isFinite(transparency)) return null
  return { textColor, accentColor, backgroundColor, transparency: Math.min(100, Math.max(0, transparency)) }
}

export function personalizationStyle(value: DisplayPersonalization): Record<string, string> {
  const channels = [1, 3, 5].map(index => parseInt(value.backgroundColor.slice(index, index + 2), 16))
  return {
    '--edge-text': value.textColor,
    '--edge-accent': value.accentColor,
    '--edge-bg': value.backgroundColor,
    '--edge-surface': `rgba(${channels.join(',')}, ${(100 - value.transparency) / 100})`,
  }
}
