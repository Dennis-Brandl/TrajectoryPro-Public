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


def execute(inputs, outputs, props, action_props):
    if not str(inputs.get('from_location', '')).strip():
        print('WARN: MoveItem STARTING: from_location is empty')
    if not str(inputs.get('to_location', '')).strip():
        print('WARN: MoveItem STARTING: to_location is empty')
    if not str(inputs.get('item_sku', '')).strip():
        print('WARN: MoveItem STARTING: item_sku is empty')

    # {{sim_dice_roll: observable}}
