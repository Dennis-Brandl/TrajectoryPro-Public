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

/** Error box listing why a form's buttons would leave an operator stuck (or why a conversion
 *  could not run). Renders nothing when there are no messages. Never blocks Save. */
export function FormButtonProblems({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null
  return (
    <div
      role="alert"
      className="border border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200"
      style={{ marginTop: 8, padding: '6px 8px', borderRadius: 4, fontSize: 12 }}
    >
      <ul style={{ margin: 0, paddingLeft: 16 }}>
        {messages.map((m, i) => (
          <li key={i}>{m}</li>
        ))}
      </ul>
    </div>
  )
}
