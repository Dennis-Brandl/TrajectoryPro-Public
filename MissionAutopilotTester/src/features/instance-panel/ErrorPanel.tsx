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

import styles from './ErrorPanel.module.css'

export interface ErrorPanelProps {
  terminalError: string | null
  latestError: string | undefined
  latestTraceback: string | undefined
}

export function ErrorPanel({ terminalError, latestError, latestTraceback }: ErrorPanelProps) {
  if (!terminalError && !latestError && !latestTraceback) {
    return null
  }

  return (
    <section className={styles.panel} aria-label="Errors">
      {terminalError && (
        <div className={styles.block}>
          <h3 className={styles.heading}>Terminal error</h3>
          <pre className={styles.body}>{terminalError}</pre>
        </div>
      )}
      {latestError && (
        <div className={styles.block}>
          <h3 className={styles.heading}>Latest error</h3>
          <pre className={styles.body}>{latestError}</pre>
        </div>
      )}
      {latestTraceback && (
        <div className={styles.block}>
          <h3 className={styles.heading}>Traceback</h3>
          <pre className={styles.body}>{latestTraceback}</pre>
        </div>
      )}
    </section>
  )
}
