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

import iconImg from '../../assets/ic_launcher_round.png'
import styles from './BrandingRow.module.css'

export function BrandingRow() {
  return (
    <div className={styles.row}>
      <img src={iconImg} alt="" className={styles.icon} />
      <span className={styles.title}>Mission Autopilot Tester</span>
      <span className={styles.version}>v{__APP_VERSION__}</span>
      <a
        href="help.html"
        target="_blank"
        rel="noopener noreferrer"
        style={{ marginLeft: 'auto', fontSize: '0.85em' }}
        title="Open the help guide"
      >
        Help
      </a>
    </div>
  )
}
