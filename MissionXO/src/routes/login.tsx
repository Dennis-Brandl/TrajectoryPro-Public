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
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { signIn, useSession } from '~/lib/auth-client';
import { getSetupStatus } from '@/lib/auth/setupClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SignInFrame } from '@mission/ui';

export const Route = createFileRoute('/login')({ component: LoginPage });

const schema = z.object({ email: z.string().email('Invalid email'), password: z.string().min(8, 'Min 8 characters') });
type Data = z.infer<typeof schema>;

export function LoginPage() {
  const navigate = useNavigate();
  const { data: session, isPending } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [notSetUp, setNotSetUp] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Data>({ resolver: zodResolver(schema) });
  useEffect(() => { if (session && !isPending) navigate({ to: '/' }); }, [session, isPending, navigate]);
  useEffect(() => {
    let live = true;
    getSetupStatus().then((s) => { if (live && s && !s.setupComplete) setNotSetUp(true); }).catch(() => { /* unreachable: show the form */ });
    return () => { live = false; };
  }, []);
  const onSubmit = async (v: Data) => {
    setError(null);
    const res = await signIn.email({ email: v.email, password: v.password });
    if (res.error) setError(res.error.message ?? 'Sign-in failed'); else navigate({ to: '/' });
  };
  return (
    <SignInFrame
      splashSrc="/xo/MissionXOSplashScreen.png"
      splashAlt="Mission XO"
      version={__APP_VERSION__}
      description="Runs the day's workflows in a work center: start them, watch them, and look back at what finished."
    >
      {notSetUp ? (
        <p role="alert" className="w-80 rounded-[10px] border border-border p-6 text-sm">
          Mission Control is not set up yet. Finish setup in Mission Commander.
        </p>
      ) : (
        <form noValidate onSubmit={handleSubmit(onSubmit)} className="w-80 space-y-4 rounded-[10px] border border-border p-6">
          <h1 className="text-lg font-semibold">Sign in</h1>
          <div className="space-y-1"><Label htmlFor="email">Email</Label>
            <Input id="email" type="email" className="h-11 xl:h-9" {...register('email')} />
            {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}</div>
          <div className="space-y-1"><Label htmlFor="password">Password</Label>
            <Input id="password" type="password" className="h-11 xl:h-9" {...register('password')} />
            {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}</div>
          {error && <p role="alert" data-testid="login-error" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="h-11 w-full xl:h-9" disabled={isSubmitting}>{isSubmitting ? 'Signing in…' : 'Sign in'}</Button>
        </form>
      )}
    </SignInFrame>
  );
}
