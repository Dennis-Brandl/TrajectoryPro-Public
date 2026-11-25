// Copyright 2026 Dennis L. Brandl
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
import { useEffect, useRef, useState, type RefObject } from 'react'

// Spec 2026-11-24 §5.3, after Mission Solo's run/CollapsingHeader.kt (`enterAlways`): the phone task
// header slides out by the distance the form scrolls up and back by the distance it scrolls down.

/** The layout and visual viewports differ by more than this while the on-screen keyboard is up. */
const KEYBOARD_PX = 150

/**
 * The header's next offset (px out of view, 0 = fully shown). `delta` is the new scrollTop minus the
 * previous one: positive = the content moved up = the header goes out. At the top it is always shown.
 */
export function nextOffset(offset: number, delta: number, height: number, scrollTop: number): number {
  if (scrollTop <= 0) return 0
  return Math.min(Math.max(offset + delta, 0), height)
}

/** Whether the on-screen keyboard is up: the visual viewport is well below the layout viewport. */
export function keyboardUp(layoutHeight: number, visualHeight: number): boolean {
  return layoutHeight - visualHeight > KEYBOARD_PX
}

export interface CollapsingHeaderOptions {
  /** The header; its scroller is the nearest `.work-panes` above it. */
  header: RefObject<HTMLElement | null>
  /** Off: no listeners, always shown. */
  enabled: boolean
  /** Something the operator must see (an alert, offline, focus in the header): shown, keyboard or not. */
  pinned: boolean
  /** A change shows the header again (a new task, an arrival). */
  resetKey: unknown
}

/**
 * The header's offset in px (0 = fully shown). Per scroll frame it reads only the scroller's
 * scrollTop; the header's height is cached by a ResizeObserver.
 */
export function useCollapsingHeader({ header, enabled, pinned, resetKey }: CollapsingHeaderOptions): number {
  const [offset, setOffset] = useState(0)
  const [height, setHeight] = useState(0)
  const [keyboard, setKeyboard] = useState(false)
  const heightRef = useRef(0)

  // Render-phase adjustment (React's "adjusting state when a prop changes"): a new key, a pin or
  // switching off shows the header at once, so it does not slide back out where it was left.
  const [seenKey, setSeenKey] = useState(resetKey)
  if (!Object.is(seenKey, resetKey)) {
    setSeenKey(resetKey)
    setOffset(0)
  } else if ((pinned || !enabled) && offset !== 0) {
    setOffset(0)
  }

  const pinnedRef = useRef(pinned)
  useEffect(() => {
    pinnedRef.current = pinned
  }, [pinned])

  useEffect(() => {
    const el = header.current
    if (!enabled || !el) return
    const measure = () => {
      heightRef.current = el.offsetHeight
      setHeight(heightRef.current)
    }
    measure()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(el)

    const scroller = el.closest('.work-panes')
    let last = scroller?.scrollTop ?? 0
    // `pending` is set before asking for the frame, so a callback that runs at once still clears it.
    let pending = false
    let frame = 0
    const onFrame = () => {
      pending = false
      const top = scroller!.scrollTop
      const delta = top - last
      last = top
      if (pinnedRef.current) return
      setOffset((o) => nextOffset(o, delta, heightRef.current, top))
    }
    const onScroll = () => {
      if (pending) return
      pending = true
      frame = requestAnimationFrame(onFrame)
    }
    scroller?.addEventListener('scroll', onScroll, { passive: true })

    const vv = window.visualViewport
    let wasUp = false
    const onResize = () => {
      const up = vv ? keyboardUp(window.innerHeight, vv.height) : false
      // The keyboard closing brings the header back fully.
      if (wasUp && !up) setOffset(0)
      wasUp = up
      setKeyboard(up)
    }
    onResize()
    vv?.addEventListener('resize', onResize)

    return () => {
      ro?.disconnect()
      scroller?.removeEventListener('scroll', onScroll)
      vv?.removeEventListener('resize', onResize)
      if (pending) cancelAnimationFrame(frame)
      setKeyboard(false)
    }
  }, [enabled, header])

  if (!enabled || pinned) return 0
  if (keyboard) return height
  return Math.min(offset, height)
}
