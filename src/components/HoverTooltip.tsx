import { cloneElement, isValidElement, useRef, useState } from 'react'
import type { ReactElement, MouseEvent as ReactMouseEvent } from 'react'
import { Tooltip } from '@mui/material'
import type { TooltipProps } from '@mui/material'

interface SelectLikeProps {
  onMouseDown?: (e: ReactMouseEvent) => void
  SelectProps?: { onOpen?: (e: unknown) => void; onClose?: (e: unknown) => void }
}

/**
 * A Tooltip that won't sit on top of its own field's opened Select menu.
 *
 * Plain Tooltip stays open through a click -- hover never technically ends --
 * so it renders on top of the menu the click just opened. Closing on
 * mousedown isn't enough on its own either: opening the menu mutates the DOM
 * right under the cursor, and the browser answers with a fresh
 * mouseover/mouseenter on the field itself well after the click (observed
 * anywhere from ~40ms to ~450ms later), which Tooltip reads as "hovering
 * again" and reopens right back on top of the menu. Tracking the menu's own
 * open/close (via SelectProps) and suppressing for that whole span, rather
 * than guessing at a timeout, is what actually closes the race.
 */
export default function HoverTooltip(
  { title, children }: { title: TooltipProps['title']; children: ReactElement },
) {
  const [open, setOpen] = useState(false)
  const menuOpen = useRef(false)

  const child = isValidElement(children)
    ? cloneElement(children, {
        onMouseDown: (e: ReactMouseEvent) => {
          setOpen(false)
          ;(children.props as SelectLikeProps).onMouseDown?.(e)
        },
        SelectProps: {
          ...(children.props as SelectLikeProps).SelectProps,
          onOpen: (e: unknown) => {
            menuOpen.current = true
            setOpen(false)
            ;(children.props as SelectLikeProps).SelectProps?.onOpen?.(e)
          },
          onClose: (e: unknown) => {
            menuOpen.current = false
            ;(children.props as SelectLikeProps).SelectProps?.onClose?.(e)
          },
        },
      } as Partial<unknown>)
    : children

  return (
    <Tooltip
      title={title}
      open={open}
      onOpen={() => { if (!menuOpen.current) setOpen(true) }}
      onClose={() => setOpen(false)}
    >
      {child}
    </Tooltip>
  )
}
