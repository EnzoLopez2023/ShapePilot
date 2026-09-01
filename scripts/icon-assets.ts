export const ICON_MASTER = {
  fileName: 'shapepilot-icon-1024.png',
  size: 1024,
  sha256: '974b1eeb5ce0d0049233d112f3ddf2b52a7b637c52376a30dfb02c81d9283534',
} as const

export const PNG_ICON_ASSETS = [
  {
    fileName: 'apple-touch-icon.png',
    size: 180,
    sha256: '58d25a5e989bbf93d6cc0a683301f10f260bdddf56871da4e507161c0f0572c5',
  },
  {
    fileName: 'pwa-192x192.png',
    size: 192,
    sha256: '438b4991083eb061591804fad687092dcf10a5f5554a0a77c3bec40b6645f1f8',
  },
  {
    fileName: 'pwa-512x512.png',
    size: 512,
    sha256: 'dd1218ed421fe4a9991a0514c7c115584b5c2b5814927845ef1811394e964a06',
  },
] as const

export const FAVICON_ASSET = {
  fileName: 'favicon.ico',
  sizes: [16, 32, 48],
  sha256: '91d429dd7bd9c15736da47b95b4802bdae56673f5cb020ddd0d53b27e483b04c',
} as const

export const MASKABLE_ICON_ASSET = {
  fileName: 'pwa-maskable-512x512.png',
  size: 512,
  sourceRatio: 0.56,
  sha256: 'e7117ca984afce595765ff85d124deb11d75fd39ed382410976643a34f809f96',
} as const

export const PWA_INCLUDE_ASSETS = [
  FAVICON_ASSET.fileName,
  PNG_ICON_ASSETS[0].fileName,
] as const

export const PWA_ICONS = [
  {
    src: `/${PNG_ICON_ASSETS[1].fileName}`,
    sizes: '192x192',
    type: 'image/png',
    purpose: 'any',
  },
  {
    src: `/${PNG_ICON_ASSETS[2].fileName}`,
    sizes: '512x512',
    type: 'image/png',
    purpose: 'any',
  },
  {
    src: `/${MASKABLE_ICON_ASSET.fileName}`,
    sizes: '512x512',
    type: 'image/png',
    purpose: 'maskable',
  },
] as const
