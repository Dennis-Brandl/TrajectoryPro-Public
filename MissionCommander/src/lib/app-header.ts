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

/**
 * Mission XO sends this header, set to XO_APP, on every API call, so the server checks
 * XO's own sign-in (cookie `mission-xo.*`) instead of Commander's (`mission-commander.*`).
 * Both are sessions the same browser already holds, so the header only chooses between
 * them; it cannot make a request act as anyone the browser has not signed in as.
 */
export const APP_HEADER = 'X-Mission-App';
export const XO_APP = 'xo';
