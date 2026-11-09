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

/** Hides anything shaped like an API token, so a `?token=mcx_...` never reaches the request log. */
export function maskApiTokens(text: string): string {
  return text.replace(/mcx_[A-Za-z0-9_-]+/g, 'mcx_***');
}

/** Hono logger print function: the default console output, with tokens masked. */
export function maskedLogPrint(str: string, ...rest: string[]): void {
  console.log(maskApiTokens(str), ...rest.map(maskApiTokens));
}
