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

// Package file types the console imports. Used by the upload dialog and the
// explorer's import button so the two cannot drift apart.
export const PACKAGE_EXTENSIONS = ['.WFenvir', '.WFenvirX', '.WFenvirBundleX', '.WFaction'] as const

export const PACKAGE_EXTENSIONS_TEXT = '.WFenvir, .WFenvirX, .WFenvirBundleX, or .WFaction'
