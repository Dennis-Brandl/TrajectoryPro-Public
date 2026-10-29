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
    if not str(inputs.get('ingredient', '')).strip():
        print('WARN: PrepStation IN_PROGRESS: ingredient is empty')
    if not str(inputs.get('quantity_grams', '')).strip():
        print('WARN: PrepStation IN_PROGRESS: quantity_grams is empty')

    # {{sim_dice_roll: opaque, msg='ingredient spoilage detected'}}

    # Clean path: portion the ingredient.
    time.sleep(random.uniform(0.05, 0.15))
    ingredient = str(inputs.get('ingredient', ''))
    cut_style = str(inputs.get('cut_style', ''))
    quantity_str = str(inputs.get('quantity_grams', '0'))
    try:
        portions = max(1, int(quantity_str) // 30)
    except ValueError:
        portions = 1
    outputs['portions_ready'] = str(portions)
    outputs['prep_notes'] = f'{cut_style} on {ingredient}' if cut_style else ingredient
    outputs['status'] = '0'
