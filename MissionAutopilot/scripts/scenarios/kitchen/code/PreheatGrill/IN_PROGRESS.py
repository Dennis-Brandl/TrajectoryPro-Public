# Copyright 2026 Dennis L. Brandl
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import random
import time


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('grill_id', '')).strip():
        print('WARN: PreheatGrill IN_PROGRESS: grill_id is empty')

    # {{sim_dice_roll: opaque, msg='igniter failed'}}

    time.sleep(random.uniform(0.05, 0.15))
    outputs['status'] = '0'
