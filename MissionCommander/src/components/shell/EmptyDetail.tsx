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
// The detail pane's empty state, laid out like Designer's "Welcome to Mission Designer" card.
export function EmptyDetail({ message }: { message: string }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-side-panel p-6">
      <div className="w-full max-w-3xl rounded-xl border border-border bg-card p-8 text-center shadow-lg">
        <img
          src="/MissionCommanderStartGraphic.png"
          alt="Master workflows and environments load into work centers. Runtime workflows, created from master workflows, use environments that identify actions, and send UI steps to Mission Pilot. Users are assigned to work centers and given UI roles."
          className="mx-auto mb-6 h-auto w-full rounded-lg bg-white"
        />
        <h1 className="text-2xl font-bold text-foreground">Welcome to Mission Commander</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create and manage Work Centers, Runtime Workflows, Users, Workflows, Environments, and Roles.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
