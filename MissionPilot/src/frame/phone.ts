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
import { useMediaQuery } from './useMediaQuery'

// Phone (spec §3): a narrow screen, or a short one that is still not a tablet in landscape.
export const PHONE_QUERY = '(max-width: 599.98px), (max-height: 499.98px) and (max-width: 1023.98px)'

export function usePhone(): boolean {
  return useMediaQuery(PHONE_QUERY)
}
