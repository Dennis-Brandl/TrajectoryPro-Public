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
import { useEffect, useState } from 'react';
import { useLayout } from '~/lib/layout';

const LANDSCAPE = '(min-width: 1024px)';

/** True when the list and the detail sit side by side: desktop, or tablet at 1024 px and wider. */
export function useSplitView(): boolean {
  const layout = useLayout();
  const [wide, setWide] = useState(() => window.matchMedia(LANDSCAPE).matches);
  useEffect(() => {
    const q = window.matchMedia(LANDSCAPE);
    const update = () => setWide(window.matchMedia(LANDSCAPE).matches);
    q.addEventListener('change', update);
    update();
    return () => q.removeEventListener('change', update);
  }, []);
  return layout === 'desktop' || (layout === 'tablet' && wide);
}
