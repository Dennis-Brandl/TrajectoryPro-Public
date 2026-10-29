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

import { Outlet } from 'react-router'
import TopNav from './TopNav'
import ActivityBar from './ActivityBar'
import SidePanel from './SidePanel'
import StatusBar from './StatusBar'
import RightPane from './RightPane'
import { RightPaneProvider } from './RightPaneContext'

export default function Layout() {
  return (
    <RightPaneProvider>
      <div className="flex flex-col h-screen bg-background">
        <TopNav />
        <div className="flex flex-1 overflow-hidden">
          <ActivityBar />
          <SidePanel />
          <main className="flex-1 overflow-auto p-6">
            <Outlet />
          </main>
          <RightPane />
        </div>
        <StatusBar />
      </div>
    </RightPaneProvider>
  )
}
