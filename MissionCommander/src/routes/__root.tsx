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
import { createRootRoute, Outlet } from '@tanstack/react-router';
import { Toaster } from 'sonner';
import { useTheme } from '@/hooks/useTheme';

export const Route = createRootRoute({ component: RootLayout });

// The theme hook lives HERE, not in _authenticated.tsx: /login and /setup render outside
// the authenticated layout, and a login page that flashes white before a dark app is a
// visible defect. Exported for its test, matching how login.tsx exports LoginPage.
export function RootLayout() {
  const { theme } = useTheme();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Outlet />
      {/* sonner does not read the `dark` class — without this, toasts stay light-on-dark. */}
      <Toaster richColors position="bottom-right" theme={theme} />
    </div>
  );
}
