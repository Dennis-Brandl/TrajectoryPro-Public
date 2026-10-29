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

import { useState, useEffect, useRef } from 'react'
import { HexColorPicker, HexColorInput } from 'react-colorful'

interface ColorPickerFieldProps {
  color: string
  onChange: (color: string) => void
  label?: string
}

const PRESET_SWATCHES = ['#1e293b', '#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#6b7280', '#ffffff']

/**
 * Color picker field with preset swatches and a full HexColorPicker popover.
 * Renders a clickable swatch button that opens a popover with swatches + spectrum picker.
 * z-index 10000 ensures it renders above the Radix Dialog overlay.
 */
export function ColorPickerField({ color, onChange, label }: ColorPickerFieldProps) {
  const [open, setOpen] = useState(false)
  const [localColor, setLocalColor] = useState(color)
  const popoverRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Sync local state from prop when it changes externally
  useEffect(() => {
    setLocalColor(color)
  }, [color])

  // Click-outside handler to close the popover
  useEffect(() => {
    if (!open) return

    function handleMouseDown(event: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [open])

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      {label && (
        <span
          className="text-gray-500 dark:text-gray-400"
          style={{
            fontSize: 11,
            display: 'block',
            marginBottom: 2,
            userSelect: 'none',
          }}
        >
          {label}
        </span>
      )}

      {/* Clickable swatch showing current color */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="border border-slate-200 dark:border-slate-700"
        style={{
          width: 28,
          height: 28,
          background: localColor,
          borderRadius: 4,
          cursor: 'pointer',
          padding: 0,
          flexShrink: 0,
        }}
        title="Pick color"
        aria-label="Open color picker"
      />

      {/* Popover */}
      {open && (
        <div
          ref={popoverRef}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
          style={{
            position: 'absolute',
            zIndex: 10000,
            padding: 12,
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            top: 32,
            left: 0,
            minWidth: 200,
          }}
        >
          {/* Preset swatches row */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            {PRESET_SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                onClick={() => {
                  setLocalColor(swatch)
                  onChange(swatch)
                  setOpen(false)
                }}
                className={`border ${swatch === localColor ? 'border-blue-600 dark:border-blue-400' : 'border-gray-300 dark:border-gray-600'}`}
                style={{
                  width: 20,
                  height: 20,
                  background: swatch,
                  borderRadius: 3,
                  borderWidth: swatch === localColor ? 2 : 1,
                  cursor: 'pointer',
                  padding: 0,
                  flexShrink: 0,
                }}
                title={swatch}
                aria-label={`Select color ${swatch}`}
              />
            ))}
          </div>

          {/* Full spectrum picker */}
          <HexColorPicker
            color={localColor}
            onChange={(c) => {
              setLocalColor(c)
              onChange(c)
            }}
            style={{ width: '100%' }}
          />

          {/* Hex input */}
          <HexColorInput
            color={localColor}
            onChange={(c) => {
              setLocalColor(c)
              onChange(c)
            }}
            prefixed
            className="border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100"
            style={{
              marginTop: 8,
              width: '100%',
              fontSize: 12,
              padding: '4px 6px',
              borderRadius: 4,
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />
        </div>
      )}
    </div>
  )
}
