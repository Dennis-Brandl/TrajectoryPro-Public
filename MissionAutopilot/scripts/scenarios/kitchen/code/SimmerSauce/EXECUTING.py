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
    status = outputs.get('status', '0')
    if status == '1':
        raise RuntimeError('SimmerSauce: sauce broke / curdled')
    if status == '2':
        time.sleep(60)
        return
    # Long-running clean path: ~2 seconds (stays under 3s timeout, leaves room
    # for pause/resume demos from the tester UI).
    time.sleep(random.uniform(1.8, 2.4))
