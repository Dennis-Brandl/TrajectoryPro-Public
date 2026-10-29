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
import { useEffect, useRef } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { workCenters, type CreateWcInput } from '@/lib/api/work-centers';
import { apiErrorMessage } from '@/lib/api/client';
import type { WorkCenter, WorkCenterView } from '@/lib/api/types';
import { DISPATCH_POLICIES } from '@/lib/dispatch-policies';
import { validateRuntimeIdTemplate, renderRuntimeId } from '@/lib/runtime-id';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { WorkCenterSelect } from './WorkCenterSelect';
import { TypeNameCombo } from '@/components/shared/TypeNameCombo';
import { WORK_CENTER_TYPE_NAMES, MAX_TYPE_NAME_LENGTH, TYPE_NAME_TOO_LONG_MESSAGE } from '@/lib/typeNames';

// Radix Select items cannot carry an empty/null value, so "no parent" is encoded
// with a sentinel and mapped back to null on submit.
const ROOT_VALUE = '__root__';

// sortOrder keeps the plan's z.coerce.number().int().optional() verbatim: an empty
// input coerces to 0, which matches the server default (accepted, not a bug).
const schema = z.object({
  name: z.string().min(1, 'Required'),
  typeName: z.string().optional().refine((v) => (v ?? '').trim().length <= MAX_TYPE_NAME_LENGTH, TYPE_NAME_TOO_LONG_MESSAGE),
  description: z.string().optional(),
  dispatchPolicy: z.string(),
  autoClaim: z.boolean(),
  sortOrder: z.coerce.number().int().optional(),
  parentWorkCenterId: z.string(),
  runtimeIdTemplate: z.string().optional(),
}).superRefine((val, ctx) => {
  // Validate against the LIVE name field (falling back to the same 'WORK-CENTER' placeholder
  // the preview below uses when the name is still blank), not a fixed literal — otherwise this
  // check and the preview can disagree about whether a given template is valid (e.g. rule 5's
  // rendered-length check depends on the actual work center name).
  const workCenterName = val.name || 'WORK-CENTER';
  const check = validateRuntimeIdTemplate(val.runtimeIdTemplate ?? '', { workCenterName });
  if (!check.ok) {
    ctx.addIssue({
      code: 'custom',
      path: ['runtimeIdTemplate'],
      message: (check as { reason?: string }).reason ?? 'Invalid format',
    });
  }
});
type FormValues = z.infer<typeof schema>;

function defaultValuesFor(initial: WorkCenter | null): FormValues {
  return {
    name: initial?.name ?? '',
    typeName: initial?.typeName ?? '',
    description: initial?.description ?? '',
    dispatchPolicy: initial?.dispatchPolicy ?? DISPATCH_POLICIES[0],
    autoClaim: initial?.autoClaim ?? false,
    sortOrder: initial?.sortOrder ?? 0,
    parentWorkCenterId: initial?.parentWorkCenterId ?? ROOT_VALUE,
    runtimeIdTemplate: initial?.runtimeIdTemplate ?? '',
  };
}

type WorkCenterDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // null → create mode (parent taken from parentWorkCenterId); a WorkCenter → edit
  // mode (fields preloaded, parent selector shown).
  initial: WorkCenter | null;
  parentWorkCenterId: string | null;
  onSaved: (view: WorkCenterView) => void;
};

export function WorkCenterDialog({ open, onOpenChange, initial, parentWorkCenterId, onSaved }: WorkCenterDialogProps) {
  const isEdit = initial !== null;
  const { register, handleSubmit, control, reset, watch, setValue, formState: { errors, isSubmitting } } =
    useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaultValuesFor(initial) });

  // Re-seed the form each time the dialog opens so a reused instance never shows a
  // stale previous work center's values (defaultValues alone only apply on mount).
  useEffect(() => {
    if (open) reset(defaultValuesFor(initial));
  }, [open, initial, reset]);

  const TOKEN_CHIPS = [
    { label: 'Year', token: '{YYYY}' }, { label: 'Month', token: '{MM}' },
    { label: 'Day', token: '{DD}' }, { label: 'Hour', token: '{HH}' },
    { label: 'Minute', token: '{mm}' }, { label: 'Work center', token: '{WC}' },
    { label: 'Sequence', token: '{SEQ}' },
  ] as const;

  // react-hook-form owns the ref, so keep its callback and also stash the element for
  // cursor-position inserts.
  const formatRef = useRef<HTMLInputElement | null>(null);
  const { ref: rhfFormatRef, ...formatRest } = register('runtimeIdTemplate');
  const registerFormat = {
    ...formatRest,
    ref: (el: HTMLInputElement | null) => { rhfFormatRef(el); formatRef.current = el; },
  };

  const template = watch('runtimeIdTemplate') ?? '';
  const name = watch('name') || 'WORK-CENTER';

  const insertToken = (token: string) => {
    const el = formatRef.current;
    const at = el?.selectionStart ?? template.length;
    const next = `${template.slice(0, at)}${token}${template.slice(el?.selectionEnd ?? at)}`;
    setValue('runtimeIdTemplate', next, { shouldValidate: true, shouldDirty: true });
    requestAnimationFrame(() => {
      el?.focus();
      const pos = at + token.length;
      el?.setSelectionRange(pos, pos);
    });
  };

  // A blank template is VALID (it means "use the built-in default"), so this can't be
  // collapsed to "preview.length ? … : fallback" — that made the fallback text dead (a
  // blank template always produces a 3-label preview, same as any other valid template).
  // Blank and non-blank-valid both get a preview; only the WORDING differs, so both
  // facts (which mode, and what it renders) reach the user.
  const isBlankTemplate = template.trim() === '';
  const preview = validateRuntimeIdTemplate(template, { workCenterName: name }).ok
    ? [1, 2, 3].map((seq) =>
        renderRuntimeId(template, {
          now: new Date(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          workCenterName: name, seq,
        }))
    : [];

  const onSubmit = async (values: FormValues) => {
    const shared = {
      name: values.name,
      typeName: values.typeName?.trim() ? values.typeName.trim() : null,
      description: values.description ? values.description : null,
      dispatchPolicy: values.dispatchPolicy,
      autoClaim: values.autoClaim,
      sortOrder: values.sortOrder,
      runtimeIdTemplate: values.runtimeIdTemplate?.trim() ? values.runtimeIdTemplate.trim() : null,
    } satisfies Partial<CreateWcInput>;
    try {
      const view = initial
        ? await workCenters.update(initial.id, {
            ...shared,
            parentWorkCenterId: values.parentWorkCenterId === ROOT_VALUE ? null : values.parentWorkCenterId,
          })
        : await workCenters.create({ ...shared, parentWorkCenterId });
      toast.success('Work center saved');
      onSaved(view);
      onOpenChange(false);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to save'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit work center' : 'New work center'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Update this work center’s details.' : 'Add a work center to the hierarchy.'}
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="wc-name">Name</Label>
            <Input id="wc-name" {...register('name')} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="wc-type">Type</Label>
            <TypeNameCombo id="wc-type" options={WORK_CENTER_TYPE_NAMES} {...register('typeName')} />
            {errors.typeName && <p className="text-sm text-destructive">{errors.typeName.message}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="wc-description">Description</Label>
            <Input id="wc-description" {...register('description')} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wc-dispatch">Dispatch policy</Label>
            <Controller
              control={control}
              name="dispatchPolicy"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="wc-dispatch" className="w-full" aria-label="Dispatch policy">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DISPATCH_POLICIES.map((policy) => (
                      <SelectItem key={policy} value={policy}>{policy}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wc-runtime-id">Runtime ID format</Label>
            <Input id="wc-runtime-id" {...registerFormat} />
            <div className="flex flex-wrap gap-1 pt-1">
              {TOKEN_CHIPS.map(({ label, token }) => (
                <button
                  key={token}
                  type="button"
                  aria-label={`Insert ${label}`}
                  onClick={() => insertToken(token)}
                  className="rounded border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground" data-testid="runtime-id-preview">
              {preview.length
                ? (isBlankTemplate ? `Using the built-in default — ${preview.join(', ')}` : `Preview: ${preview.join('   ')}`)
                : ''}
            </p>
            {errors.runtimeIdTemplate && (
              <p className="text-sm text-destructive">{errors.runtimeIdTemplate.message}</p>
            )}
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <input id="wc-auto-claim" type="checkbox" {...register('autoClaim')} />
              <Label htmlFor="wc-auto-claim">Auto-claim follow-on steps</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              After an operator claims a step, later steps in the same workflow (parent or child) are claimed for them automatically.
            </p>
          </div>
          {isEdit && (
            <Controller
              control={control}
              name="parentWorkCenterId"
              render={({ field }) => (
                <WorkCenterSelect
                  id="wc-parent"
                  label="Parent"
                  ariaLabel="Parent work center"
                  value={field.value === ROOT_VALUE ? null : field.value}
                  onChange={(v) => field.onChange(v ?? ROOT_VALUE)}
                  allowRoot
                  excludeId={initial?.id}
                />
              )}
            />
          )}
          <div className="space-y-1">
            <Label htmlFor="wc-sort">Sort order</Label>
            <Input id="wc-sort" type="number" {...register('sortOrder')} />
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
