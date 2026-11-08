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
import type { RuntimeParameterSpec } from '@/lib/api/types';

// Literal defaults prefill as entered values; property defaults resolve at start.
export function initialParamValues(params: RuntimeParameterSpec[]): Record<string, string> {
  return Object.fromEntries(
    params.filter((p) => p.valueType === 'literal').map((p) => [p.id, p.defaultValue]),
  );
}

// Send entered values only: property-param fields left empty are omitted so the
// server resolves them from their property default.
export function paramsForCreate(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ''));
}
