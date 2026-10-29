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

import { Button } from '../../components/Button'
import type { ActionVisibility, Command } from '../../api/types'
import { isCommandValid } from '../../lib/state-machine'
import { useSendCommand } from '../../store/use-send-command'
import styles from './CommandBar.module.css'

export interface CommandBarProps {
  instanceId: string
  visibility: ActionVisibility
  currentState: string
  supportedCommands: readonly Command[]
}

export function CommandBar({
  instanceId,
  visibility,
  currentState,
  supportedCommands,
}: CommandBarProps) {
  const sendCmd = useSendCommand()

  const handleClick = (command: Command) => () => {
    sendCmd.mutate({ instanceId, command })
  }

  return (
    <div className={styles.bar}>
      <div className={styles.buttons}>
        {supportedCommands.map((command) => {
          const valid = isCommandValid(visibility, currentState, command)
          return (
            <Button
              key={command}
              type="button"
              variant={command === 'ABORT' || command === 'STOP' ? 'danger' : 'secondary'}
              disabled={!valid || sendCmd.isPending}
              onClick={handleClick(command)}
            >
              {command}
            </Button>
          )
        })}
      </div>
      {sendCmd.isError && (
        <p className={styles.error} role="alert">
          Command failed: {sendCmd.error?.message ?? 'unknown error'}
        </p>
      )}
    </div>
  )
}
