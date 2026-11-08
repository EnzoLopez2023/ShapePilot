// "Open in Bambu Studio": hand a 3MF straight to the slicer.
//
// Studio opens a model from a link by downloading the URL itself, with no
// credentials -- the way MakerWorld's "Open in Bambu Studio" works. So the
// 3MF goes up to the server, which keeps it a few minutes behind an unguessable
// link (server/routes/printLinks.ts), and the browser then follows the
// Studio link. The slice and the Print button stay in Studio: a web app
// cannot start a print on the X2D, and the printer only takes sliced files.
//
// The link differs by platform (BambuStudio GUI_App.cpp): macOS registers
// `bambustudioopen://<url-encoded url>`, Windows takes
// `bambustudio://open?file=<url>`. Studio trusts only Bambu's own download
// hosts, so for ours it first asks "This file is not from a trusted site, do
// you want to open it anyway?" -- one click, and there is no way round it.
//
// Progress is reported to one <BambuStudioNotice> in the app shell through a
// window event, so every designer gets the same feedback from a single call.
import { accessToken, parseError } from '../services/http.ts'

export type StudioStatus =
  | { state: 'uploading'; name: string }
  | { state: 'opened'; name: string; link: string }
  | { state: 'failed'; name: string; message: string }

export const STUDIO_EVENT = 'shapepilot:bambu-studio'

const announce = (status: StudioStatus) =>
  window.dispatchEvent(new CustomEvent<StudioStatus>(STUDIO_EVENT, { detail: status }))

/** The link that makes Bambu Studio download and open `fileUrl`, for this platform. */
export function studioLink(fileUrl: string, platform = navigator.platform || navigator.userAgent): string {
  return /mac/i.test(platform)
    ? `bambustudioopen://${encodeURIComponent(fileUrl)}`
    : `bambustudio://open?file=${encodeURIComponent(fileUrl)}`
}

/** Upload `bytes` (a 3MF) and open it in Bambu Studio. Never throws: failures are announced. */
export async function openInBambuStudio(bytes: ArrayBuffer, name: string): Promise<void> {
  announce({ state: 'uploading', name })
  try {
    const token = await accessToken()
    const response = await fetch(`/api/print-links?${new URLSearchParams({ name })}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: bytes,
      credentials: 'same-origin',
    })
    if (!response.ok) throw await parseError(response)
    const { path } = await response.json() as { path: string }
    const link = studioLink(new URL(path, window.location.origin).toString())
    window.location.assign(link)
    announce({ state: 'opened', name, link })
  } catch (error) {
    announce({ state: 'failed', name, message: (error as Error).message })
  }
}
