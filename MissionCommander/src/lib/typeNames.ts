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
// Predefined ISA 88 suggestions for the work center Type combo box. Suggestions only:
// any text up to MAX_TYPE_NAME_LENGTH characters is accepted. Commander keeps its own copy.
export const WORK_CENTER_TYPE_NAMES: readonly string[] = [
  'Enterprise', 'Site', 'Area', 'Plant Area', 'Work Unit', 'Device', 'Process Cell', 'Unit',
  'Production Line', 'Production Unit', 'Storage Zone', 'Storage Unit', 'Equipment',
];
export const MAX_TYPE_NAME_LENGTH = 50;
export const TYPE_NAME_TOO_LONG_MESSAGE = 'Type must be 50 characters or fewer.';
