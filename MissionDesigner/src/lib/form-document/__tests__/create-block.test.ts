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
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { validateFormDocument, type FormDocument } from '@mission/form-schema'
import { createDefaultBlock, cloneBlockWithFreshIdentity, type PaletteBlockType } from '../create-block'

const PALETTE_TYPES: PaletteBlockType[] = [
  'text',
  'header',
  'textInput',
  'textarea',
  'checkbox',
  'radio',
  'image',
  'video',
  'divider',
  'timer',
  'esignature',
]

function docWith(...blocks: ReturnType<typeof createDefaultBlock>[]): FormDocument {
  return {
    version: 2,
    sections: [{ id: 'sec', role: 'content', rows: blocks.map((b, i) => ({ id: `r${i}`, blocks: [b] })) }],
  }
}

describe('createDefaultBlock', () => {
  it('produces a schema-VALID document for every palette type (landmine guard)', () => {
    const blocks = PALETTE_TYPES.map((t) => createDefaultBlock(t))
    const result = validateFormDocument(docWith(...blocks))
    expect(result.ok).toBe(true)
  })

  it('image carries required layout.aspectRatio and a minted imageOid', () => {
    const img = createDefaultBlock('image')
    expect(img.type).toBe('image')
    expect(img.layout?.aspectRatio).toBe('16/9')
    expect((img as { imageOid?: string }).imageOid).toBeTruthy()
  })

  it('timer carries required label/fieldName/durationSeconds/direction', () => {
    const t = createDefaultBlock('timer') as {
      label: string
      fieldName: string
      durationSeconds: number
      direction: string
    }
    expect(t.label).toBeTruthy()
    expect(t.fieldName).toMatch(/^Timer_/)
    expect(t.durationSeconds).toBe(300)
    expect(t.direction).toBe('countdown')
  })

  it('field blocks get an auto fieldName with the type prefix', () => {
    expect((createDefaultBlock('textInput') as { fieldName: string }).fieldName).toMatch(/^Text_/)
    expect((createDefaultBlock('checkbox') as { fieldName: string }).fieldName).toMatch(/^Checkbox_/)
  })

  it('gives each created checkbox/radio block INDEPENDENT option objects', () => {
    const a = createDefaultBlock('checkbox') as { options: { label: string }[] }
    const b = createDefaultBlock('radio') as { options: { label: string }[] }
    expect(a.options[0]).not.toBe(b.options[0]) // not the same object reference
    a.options[0].label = 'CHANGED'
    expect(b.options[0].label).not.toBe('CHANGED') // mutating one must not affect the other
  })

  it('esignature defaults: Signature_ field name prefix, label, empty meaning, no role, flag off', () => {
    const b = createDefaultBlock('esignature')
    expect(b.type).toBe('esignature')
    if (b.type !== 'esignature') return
    expect(b.fieldName).toMatch(/^Signature_[0-9A-Za-z]{6}$/)
    expect(b.label).toBe('E-signature')
    expect(b.meaning).toBe('')
    expect(b.roleName).toBeUndefined()
    expect(b.requireDifferentUser).toBe(false)
  })
})

describe('cloneBlockWithFreshIdentity', () => {
  it('gives a new id, fresh imageOid, and fresh fieldName', () => {
    const src = createDefaultBlock('image') as { id: string; imageOid: string }
    const clone = cloneBlockWithFreshIdentity(src as never) as { id: string; imageOid: string }
    expect(clone.id).not.toBe(src.id)
    expect(clone.imageOid).not.toBe(src.imageOid)

    const field = createDefaultBlock('textInput') as { id: string; fieldName: string }
    const fclone = cloneBlockWithFreshIdentity(field as never) as { id: string; fieldName: string }
    expect(fclone.id).not.toBe(field.id)
    expect(fclone.fieldName).not.toBe(field.fieldName)
  })

  it('deep-clones so mutating the clone does not touch the source', () => {
    const src = createDefaultBlock('checkbox') as { options: { label: string }[] }
    const clone = cloneBlockWithFreshIdentity(src as never) as { options: { label: string }[] }
    clone.options[0].label = 'CHANGED'
    expect(src.options[0].label).not.toBe('CHANGED')
  })
})

describe('createDefaultBlock button', () => {
  it('defaults to a Continue job button', () => {
    const b = createDefaultBlock('button')
    expect(b).toMatchObject({
      type: 'button',
      label: '',
      job: 'continue',
      outputValue: 'continue',
      emphasis: 'primary',
    })
    expect(validateFormDocument(docWith(createDefaultBlock('button'))).ok).toBe(true)
  })
  it('defaults to a Yes job button on a Yes/No step', () => {
    const b = createDefaultBlock('button', { stepKind: 'yesno' })
    expect(b).toMatchObject({ type: 'button', label: '', job: 'yes', outputValue: 'true' })
    expect(validateFormDocument(docWith(createDefaultBlock('button', { stepKind: 'yesno' }))).ok).toBe(true)
  })
  it('on a Yes/No step that already has Yes, a new button is No (the job still missing)', () => {
    const yes = createDefaultBlock('button', { stepKind: 'yesno' })
    const b = createDefaultBlock('button', { stepKind: 'yesno', document: docWith(yes) })
    expect(b).toMatchObject({ job: 'no', outputValue: 'false', label: '' })
  })
  it('on a Yes/No step with only No, a new button is Yes; with both, Yes again', () => {
    const no = { ...createDefaultBlock('button', { stepKind: 'yesno' }), job: 'no' as const, outputValue: 'false' }
    expect(createDefaultBlock('button', { stepKind: 'yesno', document: docWith(no) })).toMatchObject({ job: 'yes' })
    const yes = createDefaultBlock('button', { stepKind: 'yesno' })
    const both: FormDocument = {
      version: 2,
      sections: [{ id: 's', role: 'content', rows: [{ id: 'r', blocks: [yes, no] }] }],
    }
    expect(createDefaultBlock('button', { stepKind: 'yesno', document: both })).toMatchObject({ job: 'yes' })
  })
  it('on a normal step a new button is always Continue', () => {
    const c = createDefaultBlock('button')
    expect(createDefaultBlock('button', { stepKind: 'continue', document: docWith(c) })).toMatchObject({
      job: 'continue',
    })
  })
})

describe('form-document schema copies', () => {
  it('Designer and FormKit schema files are byte-identical', () => {
    const a = readFileSync(resolve(__dirname, '../../schemas/form-document.json'), 'utf8')
    const b = readFileSync(
      resolve(__dirname, '../../../../../MissionFormKit/packages/form-schema/src/schema/form-document.json'),
      'utf8',
    )
    expect(a).toBe(b)
  })
})
