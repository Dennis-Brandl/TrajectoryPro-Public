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

// Re-exports every table so drizzle-kit and clients see the full schema.
export * from './identity.js';
export * from './work-centers.js';
export * from './workflows.js';
export * from './environments.js';
export * from './execution.js';
export * from './scheduling.js';
export * from './auth.js';
export * from './system-settings.js';
export * from './branding.js';
export * from './work-center-runtime.js';
export * from './control-grants.js';
export * from './distributed.js';
