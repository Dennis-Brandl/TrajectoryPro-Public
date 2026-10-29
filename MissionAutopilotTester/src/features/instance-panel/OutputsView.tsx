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

import styles from './OutputsView.module.css'

export interface OutputsViewProps {
  outputs: Record<string, string>
}

export function OutputsView({ outputs }: OutputsViewProps) {
  const keys = Object.keys(outputs).sort()

  if (keys.length === 0) {
    return <p className={styles.empty}>No outputs yet.</p>
  }

  return (
    <dl className={styles.list}>
      {keys.map((key) => (
        <div className={styles.row} key={key}>
          <dt className={styles.key} data-testid="output-key">
            {key}
          </dt>
          <dd className={styles.value} data-testid={`output-value-${key}`}>
            {outputs[key]}
          </dd>
        </div>
      ))}
    </dl>
  )
}
