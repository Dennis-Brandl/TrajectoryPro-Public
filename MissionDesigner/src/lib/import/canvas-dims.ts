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
// The three device canvas dimensions the legacy v1→v2 import path fills in when a
// legacy package omits a device layout. Preserved from the retired v1 layout-autogen
// so form-layout-hydration stays self-contained after the v1 editor's removal.
export const CANVAS_DIMS = {
  phone: { w: 360, h: 800 },
  tablet: { w: 1280, h: 720 },
  desktop: { w: 1024, h: 768 },
} as const
