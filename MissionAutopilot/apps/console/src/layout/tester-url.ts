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
// localhost links to localhost.
//
// The port depends on how the apps run. The Docker image serves a production
// build, and the tester's compose service is published on :3004. A console
// run from source with `npm run dev` pairs with the tester's dev server on
// :5180 (RUN_LOCALLY-README.md step 5).
export const DOCKER_TESTER_PORT = 3004
export const DEV_TESTER_PORT = 5180

export function actionTesterUrl(
  loc: Pick<Location, 'protocol' | 'hostname'> = window.location,
  dev: boolean = import.meta.env.DEV
): string {
  const port = dev ? DEV_TESTER_PORT : DOCKER_TESTER_PORT
  return `${loc.protocol}//${loc.hostname}:${port}`
}
