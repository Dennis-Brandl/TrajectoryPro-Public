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
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { signUp } from '@/lib/auth/auth-client';
import { getSetupStatus } from '@/lib/auth/setupClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export const Route = createFileRoute('/setup')({
  beforeLoad: async () => {
    // Only null the status on a failed call; throw the redirect OUTSIDE the try so an
    // already-bootstrapped module always bounces to / instead of rendering setup again.
    let s: { setupComplete: boolean } | null = null;
    try { s = await getSetupStatus(); } catch { /* server unreachable — render the page */ }
    if (s?.setupComplete) throw redirect({ to: '/' });
  },
  component: SetupPage,
});

const schema = z.object({ name: z.string().min(1, 'Required'), email: z.string().email('Invalid email'), password: z.string().min(8, 'Min 8 characters') });
type Data = z.infer<typeof schema>;

export function SetupPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Data>({ resolver: zodResolver(schema) });
  const onSubmit = async (v: Data) => {
    setError(null);
    const res = await signUp.email({ email: v.email, password: v.password, name: v.name });
    if (res.error) setError(res.error.message ?? 'Setup failed'); else navigate({ to: '/' });
  };
  return (
    <div className="flex min-h-screen items-center justify-center">
      <form noValidate onSubmit={handleSubmit(onSubmit)} className="w-80 space-y-4 rounded-lg border p-6">
        <h1 className="text-lg font-semibold">Create the first administrator</h1>
        <div className="space-y-1"><Label htmlFor="name">Name</Label><Input id="name" {...register('name')} />
          {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}</div>
        <div className="space-y-1"><Label htmlFor="email">Email</Label><Input id="email" type="email" {...register('email')} />
          {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}</div>
        <div className="space-y-1"><Label htmlFor="password">Password</Label><Input id="password" type="password" {...register('password')} />
          {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}</div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={isSubmitting}>{isSubmitting ? 'Creating…' : 'Create administrator'}</Button>
      </form>
    </div>
  );
}
