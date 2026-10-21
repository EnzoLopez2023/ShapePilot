// The shared menu bar is drawn by the app shell, so a page rendered on its own
// has none. Wrap a page in `WithMenuBar` to get the same bar, and drive it with
// `chooseMenu` / `menuItemDisabled` instead of looking for toolbar buttons.
import type { ReactNode } from 'react'
import { screen, waitFor } from '@testing-library/react'
import { expect } from 'vitest'
import type { UserEvent } from '@testing-library/user-event'
import { AppMenuBar, AppMenuProvider } from '../../src/components/menu/AppMenu.tsx'

export function WithMenuBar({ children }: { children: ReactNode }) {
  return (
    <AppMenuProvider>
      <AppMenuBar />
      {children}
    </AppMenuProvider>
  )
}

/** Opens a top-level menu and returns the item whose label starts with `name`. */
export async function openMenuItem(
  user: UserEvent, menu: 'File' | 'Edit' | 'View' | 'Tools', name: string | RegExp,
): Promise<HTMLElement> {
  const bar = await screen.findByRole('menubar')
  const button = await waitFor(() => {
    const found = [...bar.querySelectorAll('button')].find(b => b.textContent === menu)
    if (!found) throw new Error(`no ${menu} menu`)
    return found
  })
  await user.click(button)
  if (typeof name !== 'string') return screen.findByRole('menuitem', { name })
  // A plain string is the item's whole label, so 'Save' never picks 'Save As…'.
  return waitFor(() => {
    const found = screen.getAllByRole('menuitem').find(
      item => item.querySelector('.MuiListItemText-root')?.textContent === name)
    if (!found) throw new Error(`no menu item "${name}"`)
    return found
  })
}

/** Opens `menu` and clicks the item; the menu closes as it would for a person. */
export async function chooseMenu(
  user: UserEvent, menu: 'File' | 'Edit' | 'View' | 'Tools', name: string | RegExp,
): Promise<void> {
  await user.click(await openMenuItem(user, menu, name))
}

/** Whether an item is disabled, read off an open menu, then closes the menu. */
export async function menuItemDisabled(
  user: UserEvent, menu: 'File' | 'Edit' | 'View' | 'Tools', name: string | RegExp,
): Promise<boolean> {
  const item = await openMenuItem(user, menu, name)
  const disabled = item.getAttribute('aria-disabled') === 'true'
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  return disabled
}
