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

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { signUp } from '@/lib/auth-client'
import { Button, Input, Label } from '@mission/ui'
import { AddAccountDialog } from '@/components/admin/accounts/AddAccountDialog'

const schema = z
  .object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    email: z.string().email('Invalid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, { message: "Passwords don't match", path: ['confirmPassword'] })

type FormData = z.infer<typeof schema>

/** The first-admin step uses public sign-up; the better-auth create.after hook
 * auto-promotes the first account to administrator. After creation, the operator
 * can optionally add more administrators via AddAccountDialog (createUser) before
 * continuing. */
export function CreateAdminStep({ onCreated }: { onCreated: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [created, setCreated] = useState(false)
  const [showAddAnother, setShowAddAnother] = useState(false)
  const [addedExtra, setAddedExtra] = useState<string[]>([])
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  const onSubmit = async (data: FormData) => {
    setError(null)
    setLoading(true)
    try {
      const result = await signUp.email({ email: data.email, password: data.password, name: data.name })
      if (result.error) {
        setError(result.error.message || 'Could not create the administrator account')
        return
      }
      setCreated(true)
    } catch {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  if (created) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Administrator created</h2>
        <p className="text-sm text-muted-foreground">
          The administrator account is ready. You can add more administrators now, or continue.
        </p>
        {addedExtra.length > 0 && (
          <ul className="ml-4 list-disc text-sm text-muted-foreground">
            {addedExtra.map((e) => (
              <li key={e}>Added {e}</li>
            ))}
          </ul>
        )}
        <div className="flex justify-between">
          <Button type="button" variant="ghost" onClick={() => setShowAddAnother(true)}>
            + Add another administrator
          </Button>
          <Button type="button" onClick={onCreated}>
            Continue
          </Button>
        </div>
        <AddAccountDialog
          open={showAddAnother}
          onOpenChange={setShowAddAnother}
          lockAdministrator
          hideTeamsAndRoles
          onCreated={(u) => setAddedExtra((prev) => [...prev, u.email])}
        />
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Create the administrator account</h2>
      <p className="text-sm text-muted-foreground">This account is created as an administrator.</p>
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" type="text" {...register('name')} />
        {errors.name && <p className="text-sm text-red-500">{errors.name.message}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" {...register('email')} />
        {errors.email && <p className="text-sm text-red-500">{errors.email.message}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" {...register('password')} />
        {errors.password && <p className="text-sm text-red-500">{errors.password.message}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Confirm password</Label>
        <Input id="confirmPassword" type="password" {...register('confirmPassword')} />
        {errors.confirmPassword && <p className="text-sm text-red-500">{errors.confirmPassword.message}</p>}
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={loading}>
          {loading ? 'Creating…' : 'Create administrator & continue'}
        </Button>
      </div>
    </form>
  )
}
