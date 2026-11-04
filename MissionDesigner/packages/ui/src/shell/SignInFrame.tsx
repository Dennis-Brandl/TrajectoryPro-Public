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

import type { ReactNode } from 'react'

export function SignInFrame({
  splashSrc,
  splashAlt,
  description,
  children,
}: {
  splashSrc: string
  splashAlt: string
  description: string
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 p-6">
      <img src={splashSrc} alt={splashAlt} className="w-80 rounded-lg" />
      <p className="text-xs text-muted-foreground">Copyright 2026 Dennis L. Brandl · Apache License 2.0</p>
      <p className="max-w-sm text-center text-sm text-muted-foreground">{description}</p>
      {children}
    </div>
  )
}
