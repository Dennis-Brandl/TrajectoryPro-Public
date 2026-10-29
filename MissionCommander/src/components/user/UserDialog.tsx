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
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { users, type CreateUserInput } from '@/lib/api/users';
import { apiErrorMessage } from '@/lib/api/client';
import { ACCESS_LEVELS } from '@/lib/access-levels';
import type { UserView } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LOGIN_NAME_RE, LOGIN_NAME_HINT } from './UserDetail';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  displayName: z.string().min(1, 'Required'),
  loginName: z.string().transform((s) => s.trim().toLowerCase()).pipe(z.string().regex(LOGIN_NAME_RE, LOGIN_NAME_HINT)),
  password: z.string().min(8, 'Must be at least 8 characters'),
  accessLevel: z.enum(ACCESS_LEVELS),
});
type FormValues = z.infer<typeof schema>;
const DEFAULTS: z.input<typeof schema> = { email: '', displayName: '', loginName: '', password: '', accessLevel: 'viewer' };

export function UserDialog({ open, onOpenChange, onSaved }:
  { open: boolean; onOpenChange: (o: boolean) => void; onSaved: (v: UserView) => void }) {
  const { register, handleSubmit, control, reset, formState: { errors, isSubmitting } } =
    useForm<z.input<typeof schema>, unknown, FormValues>({ resolver: zodResolver(schema), defaultValues: DEFAULTS });
  useEffect(() => { if (open) reset(DEFAULTS); }, [open, reset]);

  const onSubmit = async (values: FormValues) => {
    try {
      const view = await users.create(values satisfies CreateUserInput);
      toast.success('User created');
      onSaved(view);
      onOpenChange(false);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Create failed'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New user</DialogTitle>
          <DialogDescription>Create a login. The user signs in with this email and initial password; the login name is what they type on e-signatures.</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="user-email">Email</Label>
            <Input id="user-email" {...register('email')} />
            {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="user-name">Display name</Label>
            <Input id="user-name" {...register('displayName')} />
            {errors.displayName && <p className="text-sm text-destructive">{errors.displayName.message}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="user-login">Login name</Label>
            <Input id="user-login" autoCapitalize="off" autoCorrect="off" spellCheck={false} {...register('loginName')} />
            {errors.loginName
              ? <p className="text-sm text-destructive">{errors.loginName.message}</p>
              : <p className="text-xs text-muted-foreground">{LOGIN_NAME_HINT}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="user-password">Initial password</Label>
            <Input id="user-password" type="password" {...register('password')} />
            {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="user-access">Access level</Label>
            <Controller control={control} name="accessLevel" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="user-access" className="w-full" aria-label="Access level"><SelectValue /></SelectTrigger>
                <SelectContent>{ACCESS_LEVELS.map((l) => (<SelectItem key={l} value={l}>{l}</SelectItem>))}</SelectContent>
              </Select>
            )} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>Create user</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
