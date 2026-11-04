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

// The Action Tester (MissionAutopilotTester) is a separate application on
// its own port, not something this server's /server-info endpoint reports.
// There is still no client-config mechanism in this console for external tool
// URLs, so the link follows the host the console was opened on: a console
// opened at http://plant-pc:3003 links to http://plant-pc:3004, one opened on
// localhost links to localhost. The tester's compose service is published on
// :3004 (docs/superpowers/specs/2026-08-07-action-tester-port-design.md).
export function actionTesterUrl(
  loc: Pick<Location, 'protocol' | 'hostname'> = window.location
): string {
  return `${loc.protocol}//${loc.hostname}:3004`
}
