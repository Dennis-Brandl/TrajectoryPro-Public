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

import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { Command } from 'cmdk'
import { CheckIcon, ChevronDownIcon, SearchIcon } from 'lucide-react'

import { cn } from '../lib/utils'

// Filter-as-you-type pickers built on cmdk + Radix Popover. cmdk supplies the
// keyboard model (arrows, Enter, hover); the filtering is ours (case-insensitive
// substring, shouldFilter={false}) so "temp" finds "Room.Temp" and nothing fuzzy.

export interface ComboboxItem {
  value: string
  /** Shown text; defaults to `value`. */
  label?: React.ReactNode
  /** Text the filter matches against; defaults to `value`. */
  searchText?: string
  /** Indents the row (e.g. Property.Entry rows under their Property). */
  indent?: boolean
  className?: string
}

export interface ComboboxGroup {
  heading?: React.ReactNode
  items: ComboboxItem[]
  /** Pinned groups ignore the filter (e.g. "Add Value Property..." actions). */
  pinned?: boolean
}

/** Keep the items whose search text contains `query` (case-insensitive); drop emptied groups. */
export function filterComboboxGroups(groups: ComboboxGroup[], query: string): ComboboxGroup[] {
  const q = query.trim().toLowerCase()
  const out: ComboboxGroup[] = []
  for (const g of groups) {
    const items = g.pinned || !q ? g.items : g.items.filter((i) => (i.searchText ?? i.value).toLowerCase().includes(q))
    if (items.length > 0) out.push(items === g.items ? g : { ...g, items })
  }
  return out
}

/** cmdk needs a unique value per row; the same ref can appear in two groups. */
const rowKey = (gi: number, value: string) => `${gi}\u0001${value}`

/** Row to highlight: the current value when not searching, else the first unpinned match. */
function pickHighlight(visible: ComboboxGroup[], query: string, selectedValue: string | undefined): string {
  if (!query.trim() && selectedValue !== undefined) {
    for (let gi = 0; gi < visible.length; gi++) {
      if (visible[gi].items.some((i) => i.value === selectedValue)) return rowKey(gi, selectedValue)
    }
  }
  const gi = visible.findIndex((g) => !g.pinned)
  const first = gi >= 0 ? gi : 0
  const item = visible[first]?.items[0]
  return item ? rowKey(first, item.value) : ''
}

function ComboboxRows({
  groups,
  selectedValue,
  onSelect,
}: {
  groups: ComboboxGroup[]
  selectedValue?: string
  onSelect: (value: string) => void
}) {
  return (
    <>
      {groups.map((g, gi) => (
        <React.Fragment key={gi}>
          {gi > 0 && <Command.Separator className="bg-border -mx-1 my-1 h-px" />}
          <Command.Group
            heading={g.heading}
            className="[&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs"
          >
            {g.items.map((item) => (
              <Command.Item
                key={item.value}
                value={rowKey(gi, item.value)}
                onSelect={() => onSelect(item.value)}
                className={cn(
                  'data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none',
                  item.indent && 'pl-5',
                  item.className,
                )}
              >
                <span className="truncate">{item.label ?? item.value}</span>
                {selectedValue !== undefined && item.value === selectedValue && (
                  <CheckIcon className="absolute right-2 size-4" />
                )}
              </Command.Item>
            ))}
          </Command.Group>
        </React.Fragment>
      ))}
    </>
  )
}

/** cmdk claims Home/End for list navigation; in a text field they should move the caret. */
function keepCaretKeys(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key === 'Home' || e.key === 'End') e.stopPropagation()
}

const contentClass =
  'bg-popover text-popover-foreground z-50 w-72 min-w-(--radix-popover-trigger-width) max-w-(--radix-popover-content-available-width) rounded-md border p-0 shadow-md outline-none'
const listClass = 'max-h-80 overflow-x-hidden overflow-y-auto p-1'

/** Scroll the highlighted row into view once the list has rendered. */
function useScrollHighlightIntoView(open: boolean, listRef: React.RefObject<HTMLDivElement | null>) {
  React.useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => {
      listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(id)
  }, [open, listRef])
}

export interface SearchableSelectProps {
  groups: ComboboxGroup[]
  /** The current value (gets a check mark and the initial highlight). */
  value?: string
  onSelect: (value: string) => void
  /** Trigger contents; the placeholder shows when this is empty. */
  triggerText?: React.ReactNode
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  className?: string
}

/** A Select look-alike whose list has a search box: pick one item, filtered as you type. */
function SearchableSelect({
  groups,
  value,
  onSelect,
  triggerText,
  placeholder = 'Select...',
  searchPlaceholder = 'Type to filter...',
  emptyText = 'No matches',
  disabled = false,
  className,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [highlight, setHighlight] = React.useState('')
  const listRef = React.useRef<HTMLDivElement>(null)

  const visible = React.useMemo(() => filterComboboxGroups(groups, query), [groups, query])
  const hasMatches = visible.some((g) => !g.pinned)

  const setOpenAndReset = (next: boolean) => {
    if (next) {
      setQuery('')
      setHighlight(pickHighlight(filterComboboxGroups(groups, ''), '', value))
    }
    setOpen(next)
  }
  useScrollHighlightIntoView(open, listRef)

  const empty = triggerText === undefined || triggerText === null || triggerText === ''

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpenAndReset}>
      <PopoverPrimitive.Trigger
        type="button"
        role="combobox"
        aria-expanded={open}
        disabled={disabled}
        data-slot="searchable-select-trigger"
        className={cn(
          'border-input focus-visible:border-ring focus-visible:ring-ring dark:bg-input/30 dark:hover:bg-input/50 flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
      >
        <span className={cn('truncate', empty && 'text-muted-foreground')}>{empty ? placeholder : triggerText}</span>
        <ChevronDownIcon className="size-4 shrink-0 opacity-50" />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content align="start" sideOffset={4} collisionPadding={8} className={contentClass}>
          <Command shouldFilter={false} loop value={highlight} onValueChange={setHighlight}>
            <div className="flex items-center gap-2 border-b px-2">
              <SearchIcon className="text-muted-foreground size-4 shrink-0" />
              <Command.Input
                value={query}
                onValueChange={(q) => {
                  setQuery(q)
                  setHighlight(pickHighlight(filterComboboxGroups(groups, q), q, value))
                }}
                onKeyDown={keepCaretKeys}
                placeholder={searchPlaceholder}
                className="placeholder:text-muted-foreground h-8 w-full bg-transparent text-sm outline-none"
              />
            </div>
            <Command.List ref={listRef} className={listClass}>
              {!hasMatches && <div className="text-muted-foreground px-2 py-1.5 text-sm">{emptyText}</div>}
              <ComboboxRows
                groups={visible}
                selectedValue={value}
                onSelect={(v) => {
                  setOpen(false)
                  onSelect(v)
                }}
              />
            </Command.List>
          </Command>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

export interface AutocompleteInputProps {
  groups: ComboboxGroup[]
  /** Free text: the field accepts anything, the list only suggests. */
  value: string
  onChange: (value: string) => void
  placeholder?: string
  readOnly?: boolean
  className?: string
  inputClassName?: string
  /** Accessible name for the ▾ button that shows the full list. */
  toggleLabel?: string
}

/** A free-text field whose suggestion list filters on what is typed; ▾ shows the whole list. */
function AutocompleteInput({
  groups,
  value,
  onChange,
  placeholder,
  readOnly = false,
  className,
  inputClassName,
  toggleLabel = 'Show suggestions',
}: AutocompleteInputProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [highlight, setHighlight] = React.useState('')
  const anchorRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)

  const visible = React.useMemo(() => filterComboboxGroups(groups, query), [groups, query])
  const hasAny = groups.some((g) => g.items.length > 0)
  const showList = open && !readOnly && visible.length > 0
  useScrollHighlightIntoView(showList, listRef)

  const openWith = (q: string) => {
    setQuery(q)
    setHighlight(pickHighlight(filterComboboxGroups(groups, q), q, q ? undefined : value))
    setOpen(true)
  }

  return (
    <PopoverPrimitive.Root open={showList} onOpenChange={(next) => !next && setOpen(false)}>
      <Command
        shouldFilter={false}
        loop
        value={highlight}
        onValueChange={setHighlight}
        className={cn('flex', className)}
      >
        <PopoverPrimitive.Anchor asChild>
          <div ref={anchorRef} className="flex w-full">
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded={showList}
              aria-autocomplete="list"
              autoComplete="off"
              data-slot="input"
              value={value}
              placeholder={placeholder}
              readOnly={readOnly}
              onChange={(e) => {
                onChange(e.target.value)
                openWith(e.target.value)
              }}
              onKeyDown={(e) => {
                keepCaretKeys(e)
                if (readOnly) return
                if (!showList && e.key === 'ArrowDown') {
                  e.preventDefault()
                  openWith('')
                } else if (e.key === 'Tab') {
                  setOpen(false)
                }
              }}
              className={cn(
                'placeholder:text-muted-foreground dark:bg-input/30 border-input h-9 w-full min-w-0 flex-1 rounded-l-md border border-r-0 bg-transparent px-3 py-1 text-sm shadow-xs outline-none',
                'focus-visible:border-ring focus-visible:ring-ring focus-visible:ring-2',
                inputClassName,
              )}
            />
            <button
              type="button"
              aria-label={toggleLabel}
              aria-haspopup="listbox"
              aria-expanded={showList}
              disabled={readOnly || !hasAny}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (showList) setOpen(false)
                else openWith('')
                inputRef.current?.focus()
              }}
              className="border-input hover:bg-accent flex items-center rounded-r-md border bg-transparent px-1 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronDownIcon className="text-muted-foreground size-3" />
            </button>
          </div>
        </PopoverPrimitive.Anchor>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            align="start"
            sideOffset={4}
            collisionPadding={8}
            className={contentClass}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            onInteractOutside={(e) => {
              if (anchorRef.current?.contains(e.target as Node)) e.preventDefault()
            }}
          >
            <Command.List
              ref={listRef}
              className={listClass}
              // Keep focus in the text field on row clicks (but let the scrollbar work).
              onMouseDown={(e) => e.target !== e.currentTarget && e.preventDefault()}
            >
              <ComboboxRows
                groups={visible}
                selectedValue={value}
                onSelect={(v) => {
                  setOpen(false)
                  onChange(v)
                }}
              />
            </Command.List>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </Command>
    </PopoverPrimitive.Root>
  )
}

export { AutocompleteInput, SearchableSelect }
