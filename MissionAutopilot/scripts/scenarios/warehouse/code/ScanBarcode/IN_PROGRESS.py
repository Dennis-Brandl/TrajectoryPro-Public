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
    if not str(inputs.get('barcode', '')).strip():
        print('WARN: ScanBarcode IN_PROGRESS: barcode is empty')

    # {{sim_dice_roll: opaque, msg='scanner offline'}}

    # Clean path: simulate brief scan + resolve.
    time.sleep(random.uniform(0.5, 1.5))
    barcode = str(inputs.get('barcode', ''))
    # Deterministic mapping: SKU = "SKU-" + last 4 digits of barcode (or empty).
    outputs['sku'] = f'SKU-{barcode[-4:]}' if len(barcode) >= 4 else ''
    outputs['status'] = '0'
