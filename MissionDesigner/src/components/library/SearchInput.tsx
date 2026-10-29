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
import { Search, X } from 'lucide-react'
import { Input } from '@mission/ui'
import { Button } from '@mission/ui'
import { useLibraryStore } from '@/stores/libraryStore'

/**
 * Debounced search input for filtering libraries.
 * Updates the store's searchQuery with 300ms debounce.
 */
export function SearchInput() {
  const searchQuery = useLibraryStore((s) => s.searchQuery)
  const setSearchQuery = useLibraryStore((s) => s.setSearchQuery)
  const [localValue, setLocalValue] = useState(searchQuery)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync local value when store changes externally
  useEffect(() => {
    setLocalValue(searchQuery)
  }, [searchQuery])

  // Debounced update to store
  const handleChange = (value: string) => {
    setLocalValue(value)
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    timeoutRef.current = setTimeout(() => {
      setSearchQuery(value)
    }, 300)
  }

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const handleClear = () => {
    setLocalValue('')
    setSearchQuery('')
  }

  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="text"
        placeholder="Search libraries..."
        value={localValue}
        onChange={(e) => handleChange(e.target.value)}
        className="pl-9 pr-8 h-8"
      />
      {localValue && (
        <Button
          variant="ghost"
          size="sm"
          className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 p-0"
          onClick={handleClear}
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  )
}
