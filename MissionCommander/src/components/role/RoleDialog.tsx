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
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { roles } from '@/lib/api/roles';
import { apiErrorMessage } from '@/lib/api/client';
import type { Role, RoleView } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const schema = z.object({ name: z.string().min(1, 'Required'), description: z.string().optional() });
type FormValues = z.infer<typeof schema>;

export function RoleDialog({ open, onOpenChange, initial, onSaved }:
  { open: boolean; onOpenChange: (o: boolean) => void; initial: Role | null; onSaved: (v: RoleView) => void }) {
  const isEdit = initial !== null;
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { name: '', description: '' } });
  useEffect(() => {
    if (open) reset({ name: initial?.name ?? '', description: initial?.description ?? '' });
  }, [open, initial, reset]);

  const onSubmit = async (values: FormValues) => {
    const description = values.description ? values.description : null;
    try {
      const view = isEdit
        ? await roles.update(initial.id, { name: values.name, description })
        : await roles.create({ name: values.name, description });
      toast.success('Role saved');
      onSaved(view);
      onOpenChange(false);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to save role'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit role' : 'New role'}</DialogTitle>
          <DialogDescription>{isEdit ? 'Update this role.' : 'Add a role operators can be assigned to.'}</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="role-name">Name</Label>
            <Input id="role-name" {...register('name')} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="role-description">Description</Label>
            <Input id="role-description" {...register('description')} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isEdit ? 'Save' : 'Create'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
