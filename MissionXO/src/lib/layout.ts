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

export type Layout = 'desktop' | 'tablet' | 'phone';

const DESKTOP = '(min-width: 1280px)';
const TABLET = '(min-width: 768px)';

export function layoutFor(widthPx: number): Layout {
  return widthPx >= 1280 ? 'desktop' : widthPx >= 768 ? 'tablet' : 'phone';
}

function current(): Layout {
  if (window.matchMedia(DESKTOP).matches) return 'desktop';
  return window.matchMedia(TABLET).matches ? 'tablet' : 'phone';
}

export function useLayout(): Layout {
  const [layout, setLayout] = useState<Layout>(current);
  useEffect(() => {
    const queries = [window.matchMedia(DESKTOP), window.matchMedia(TABLET)];
    const update = () => setLayout(current());
    queries.forEach((q) => q.addEventListener('change', update));
    update();
    return () => queries.forEach((q) => q.removeEventListener('change', update));
  }, []);
  return layout;
}
