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

import type { PanelId } from './PanelContext'

export type RailId = 'dashboard' | 'environments' | 'instances' | 'log' | 'search'

function under(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(base + '/')
}

/** Which rail item is lit. Search follows its panel on any path; the rest follow the path. */
export function railActiveId(pathname: string, activePanel: PanelId | null): RailId | null {
  if (activePanel === 'search') return 'search'
  if (pathname === '/') return 'dashboard'
  if (under(pathname, '/environments') || under(pathname, '/actions')) return 'environments'
  if (under(pathname, '/instances')) return 'instances'
  if (under(pathname, '/log')) return 'log'
  return null
}

/** The side pane shows only when a panel is set and it belongs on this page. */
export function paneVisible(pathname: string, activePanel: PanelId | null): boolean {
  if (!activePanel) return false
  if (activePanel === 'search') return true
  if (activePanel === 'explorer')
    return under(pathname, '/environments') || under(pathname, '/actions')
  if (activePanel === 'instances') return under(pathname, '/instances')
  return false
}
