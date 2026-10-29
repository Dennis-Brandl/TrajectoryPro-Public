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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { packages } from '@/lib/api/package';
import { apiErrorMessage } from '@/lib/api/client';
import type { PackagePreview, PackageScope } from '@/lib/api/types';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workCenterId: string;
  workCenterName: string;
};

export function SavePackageDialog({ open, onOpenChange, workCenterId, workCenterName }: Props) {
  const [scope, setScope] = useState<PackageScope>('all');
  const [preview, setPreview] = useState<PackagePreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPreview(null); setError(null);
    packages.preview(workCenterId, scope)
      .then((p) => { if (!cancelled) setPreview(p); })
      .catch((e) => { if (!cancelled) setError(apiErrorMessage(e, 'Could not read the package contents.')); });
    return () => { cancelled = true; };
  }, [open, workCenterId, scope]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Save “{workCenterName}” as a package</DialogTitle></DialogHeader>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Include</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="scope" checked={scope === 'all'}
              onChange={() => setScope('all')} aria-label="Every entry" />
            Every entry
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="scope" checked={scope === 'effective'}
              onChange={() => setScope('effective')} aria-label="Effective entries only" />
            Effective entries only
          </label>
        </fieldset>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {preview && (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              {preview.workCenters} work centers · {preview.workflows} workflows ·{' '}
              {preview.environments} environments · {preview.roles} roles · {preview.grants} role grants
            </p>
            {preview.warnings.length > 0 && (
              <ul className="space-y-1 text-destructive">
                {/* Keyed by index, not the warning text: two ambiguous grants in the SAME
                    workflow emit byte-identical warning strings, so a text key collides. */}
                {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {/* An anchor, not a fetch: navigation is what makes the browser honour the
              server's Content-Disposition filename instead of us re-deriving it. But an <a>
              is not a form control, so `disabled` on it never applies — Button's `asChild`
              would have passed `disabled` straight through onto a permanently-live,
              permanently-navigable link. Render the anchor ONLY once a preview exists (the
              ready state), and a genuinely disabled plain button otherwise (loading AND
              error) — never a live link to a scope that may 404 or point at stale contents. */}
          {preview ? (
            <Button asChild>
              <a href={packages.downloadUrl(workCenterId, scope)} download>Download</a>
            </Button>
          ) : (
            <Button type="button" disabled>Download</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
