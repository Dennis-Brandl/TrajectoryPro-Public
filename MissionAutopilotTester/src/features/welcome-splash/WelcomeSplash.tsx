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

import splashImage from '../../assets/MissionAutopilotTesterSplashScreen.png'
import styles from './WelcomeSplash.module.css'

interface WelcomeSplashProps {
  onContinue: () => void
}

export function WelcomeSplash({ onContinue }: WelcomeSplashProps) {
  return (
    <div className={styles.backdrop}>
      <div className={styles.card}>
        <img
          src={splashImage}
          alt="Mission Autopilot Tester"
          className={styles.splash}
        />
        <p className={styles.copyright}>Copyright 2026 Dennis L. Brandl · Apache License 2.0</p>
        <p className={styles.body}>Test Environment Actions</p>
        <button type="button" className={styles.continue} onClick={onContinue}>
          Continue
        </button>
      </div>
    </div>
  )
}
