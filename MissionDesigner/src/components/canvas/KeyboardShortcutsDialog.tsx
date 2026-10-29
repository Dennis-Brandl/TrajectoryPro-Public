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

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@mission/ui'

interface KeyboardShortcutsDialogProps {
  open: boolean
  onClose: () => void
}

/**
 * Dialog listing all keyboard shortcuts grouped by category.
 * Opened via the ? key.
 */
export function KeyboardShortcutsDialog({ open, onClose }: KeyboardShortcutsDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
    >
      <DialogContent className="max-w-md" onKeyDown={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>Quick reference for canvas operations</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-2 max-h-[60vh] overflow-y-auto pr-1">
          {/* Canvas section */}
          <ShortcutSection title="Canvas">
            <ShortcutRow keys={['Ctrl', 'Z']} description="Undo" />
            <ShortcutRow keys={['Ctrl', 'Shift', 'Z']} description="Redo" />
            <ShortcutRow keys={['Delete']} altKeys={['Backspace']} description="Delete selected" />
            <ShortcutRow keys={['Ctrl', 'A']} description="Select all" />
            <ShortcutRow keys={['Ctrl', 'C']} description="Copy" />
            <ShortcutRow keys={['Ctrl', 'V']} description="Paste" />
            <ShortcutRow keys={['Ctrl', 'F']} description="Search nodes" />
            <ShortcutRow keys={['?']} description="Show shortcuts" />
          </ShortcutSection>

          {/* Navigation section */}
          <ShortcutSection title="Navigation">
            <ShortcutRow keys={['Scroll']} description="Zoom in/out" />
            <ShortcutRow keys={['Click', 'Drag']} description="Pan canvas" />
            <ShortcutRow keys={['Shift', 'Drag']} description="Selection box" />
            <ShortcutRow keys={['Double-click node']} description="Edit node" />
            <ShortcutRow keys={['Double-click canvas']} description="Edit workflow" />
          </ShortcutSection>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ──────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────

function ShortcutSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function ShortcutRow({ keys, altKeys, description }: { keys: string[]; altKeys?: string[]; description: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-600">{description}</span>
      <div className="flex items-center gap-1">
        <KeyCombo keys={keys} />
        {altKeys && (
          <>
            <span className="text-slate-400 text-xs mx-0.5">/</span>
            <KeyCombo keys={altKeys} />
          </>
        )}
      </div>
    </div>
  )
}

function KeyCombo({ keys }: { keys: string[] }) {
  return (
    <span className="flex items-center gap-0.5">
      {keys.map((key, i) => (
        <span key={i}>
          {i > 0 && <span className="text-slate-300 mx-0.5">+</span>}
          <kbd className="bg-slate-100 rounded px-1.5 py-0.5 text-xs font-mono border border-slate-200 text-slate-600">
            {key}
          </kbd>
        </span>
      ))}
    </span>
  )
}
