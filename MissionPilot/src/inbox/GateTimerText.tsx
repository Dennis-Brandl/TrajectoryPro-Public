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

import type { GateTimer } from '../api/types'
import { useNow } from '../frame/useNow'
import { gateTimerText } from './gate-timer-text'

/** Re-renders itself once a second so the screen around it doesn't. */
export function GateTimerText({ timer }: { timer: GateTimer }) {
  const now = useNow(1000)
  return <>{gateTimerText(timer, now)}</>
}
