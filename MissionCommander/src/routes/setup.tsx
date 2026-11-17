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
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { authClient, signUp } from '@/lib/auth/auth-client';
import { getSetupStatus, type SetupStatus } from '@/lib/auth/setupClient';
import { roles } from '@/lib/api/roles';
import { workCenters } from '@/lib/api/work-centers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NameListStep } from '@/components/setup/NameListStep';
import { SignInFrame } from '@mission/ui';

export const Route = createFileRoute('/setup')({
  beforeLoad: async () => {
    // Only null the status on a failed call; throw the redirect OUTSIDE the try so an
    // already-bootstrapped module always bounces to / instead of rendering setup again.
    let s: SetupStatus | null = null;
    try { s = await getSetupStatus(); } catch { /* server unreachable — render the page */ }
    if (s?.setupComplete) throw redirect({ to: '/' });
    // The administrator exists but setup is not finished (no role yet): the later screens
    // create things, so they need that administrator signed in. Sign in, then come back.
    if (s?.hasAdmin) {
      let signedIn = true;
      try { signedIn = !!(await authClient.getSession()).data; } catch { /* let the page try */ }
      if (!signedIn) throw redirect({ to: '/login' });
    }
  },
  component: SetupPage,
});

export const ROLE_EXAMPLES = ['Time Sheet Approver', 'Entry Clerk', 'Line 2 Operator', 'Warehouse Supervisor'] as const;

type Step = 'admin' | 'workCenters' | 'roles';
const STEP_NUMBER: Record<Step, number> = { admin: 1, workCenters: 2, roles: 3 };

export function SetupPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step | null>(null); // null = still finding where to resume
  const [wcNames, setWcNames] = useState<string[]>([]);
  const [roleNames, setRoleNames] = useState<string[]>([]);

  // A reload or sign-in part way through: the administrator exists, so resume at the work
  // centers screen and show what was created before. An unreadable list resumes with none.
  useEffect(() => {
    let active = true;
    (async () => {
      let s: SetupStatus | null = null;
      try { s = await getSetupStatus(); } catch { /* treat as a fresh install */ }
      if (!s?.hasAdmin) {
        if (active) setStep('admin');
        return;
      }
      const [wcs, rs] = await Promise.all([
        workCenters.list()
          .then((r) => r.nodes.filter((n) => n.parentWorkCenterId === null).map((n) => n.name))
          .catch((): string[] => []),
        roles.list().then((r) => r.roles.map((x) => x.name)).catch((): string[] => []),
      ]);
      if (!active) return;
      setWcNames(wcs);
      setRoleNames(rs);
      setStep('workCenters');
    })();
    return () => { active = false; };
  }, []);

  return (
    <SignInFrame
      splashSrc="/MissionCommanderSplashScreen.png"
      splashAlt="Mission Commander"
      version={__APP_VERSION__}
      description="Runs workflows in work centers. Load released workflow packages, assign people, and watch each run."
    >
      <div className="space-y-3">
        {step === null && <p className="text-sm text-muted-foreground">Loading…</p>}
        {step === 'admin' && <AdminStep onCreated={() => setStep('workCenters')} />}
        {step === 'workCenters' && (
          <NameListStep
            title="Starting work centers"
            description="Work centers hold the workflows people run. Add the ones to start with, or skip this and add them later."
            label="Work center names"
            placeholder="e.g. Line 1, Line 2, Warehouse"
            names={wcNames}
            create={(name) => workCenters.create({ name, parentWorkCenterId: null })}
            onCreated={(name) => setWcNames((prev) => [...prev, name])}
            required={false}
            nextLabel={wcNames.length === 0 ? 'Skip' : 'Continue'}
            onNext={() => setStep('roles')}
          />
        )}
        {step === 'roles' && (
          <NameListStep
            title="Starting roles"
            description="Roles say who may do each step of a workflow. Add at least one to finish setup."
            label="Role names"
            placeholder={`e.g. ${ROLE_EXAMPLES.join(', ')}`}
            examples={ROLE_EXAMPLES}
            names={roleNames}
            create={(name) => roles.create({ name })}
            onCreated={(name) => setRoleNames((prev) => [...prev, name])}
            required
            nextLabel="Finish"
            onNext={() => navigate({ to: '/' })}
          />
        )}
        {step !== null && (
          <p className="text-center text-xs text-muted-foreground">Step {STEP_NUMBER[step]} of 3</p>
        )}
      </div>
    </SignInFrame>
  );
}

const schema = z.object({ name: z.string().min(1, 'Required'), email: z.string().email('Invalid email'), password: z.string().min(8, 'Min 8 characters') });
type Data = z.infer<typeof schema>;

function AdminStep({ onCreated }: { onCreated: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Data>({ resolver: zodResolver(schema) });
  const onSubmit = async (v: Data) => {
    setError(null);
    const res = await signUp.email({ email: v.email, password: v.password, name: v.name });
    if (res.error) setError(res.error.message ?? 'Setup failed'); else onCreated();
  };
  return (
    <form noValidate onSubmit={handleSubmit(onSubmit)} className="w-80 space-y-4 rounded-[10px] border border-border p-6">
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
  );
}
