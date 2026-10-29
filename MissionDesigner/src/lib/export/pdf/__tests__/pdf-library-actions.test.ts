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
import { describe, it, expect, vi } from 'vitest'
import type jsPDF from 'jspdf'
import { buildElementTable } from '../pdf-tables'
import { renderItemHeader } from '../pdf-export'
import { generateActionLibraryPDF, generateEnvironmentLibraryPDF } from '../pdf-library'
import { libraryPdfFilename } from '../../filename'
import type { Library, Specification } from '@/types/library'
import type { ValueSpec } from '@/types/nodes'

/**
 * Action and environment library PDFs (2026-10-12): parameters are ValueSpecs whose
 * description is the "Description" entry and whose other entries are the elements a
 * workflow references (`WorkCenter.Name`). The old cover tables read `p.description`
 * (always empty here) and a Type column that is always "literal".
 */

const param = (name: string, description: string, ...elements: string[]): ValueSpec => ({
  id: name,
  name,
  entries: [
    ...elements.map((e) => ({ id: `${name}.${e}`, name: e, value: '' })),
    { id: `${name}.d`, name: 'Description', value: description },
  ],
})

describe('buildElementTable', () => {
  it('returns null for no parameters', () => {
    expect(buildElementTable(undefined)).toBeNull()
    expect(buildElementTable([])).toBeNull()
  })

  it('has Name and Description columns only (no Type)', () => {
    const table = buildElementTable([param('WorkCenter', 'Where', 'Name')])!
    expect(table.head).toEqual([['Name', 'Description']])
    // Fixed Name width, so every action's tables line up down the page.
    expect(table.columnWidths).toEqual({ 0: 180 })
  })

  it('appends a single element to the parameter name', () => {
    expect(buildElementTable([param('WorkCenter', 'Where it runs', 'Name')])!.body).toEqual([
      ['WorkCenter.Name', 'Where it runs'],
    ])
  })

  it('gives each of several elements its own row, the description spanning them', () => {
    const body = buildElementTable([param('CompletionStatus', '0=No Error', 'Code', 'ErrorText')])!.body
    expect(body).toEqual([
      ['CompletionStatus.Code', { content: '0=No Error', rowSpan: 2 }],
      ['CompletionStatus.ErrorText'],
    ])
  })

  it('keeps the bare name when a parameter has no element besides Description', () => {
    expect(buildElementTable([param('Note', 'Free text')])!.body).toEqual([['Note', 'Free text']])
  })

  it('reads a legacy flat parameter (description field, no entries)', () => {
    const legacy = { id: 'x', name: 'Old', description: 'Legacy text' } as unknown as ValueSpec
    expect(buildElementTable([legacy])!.body).toEqual([['Old', 'Legacy text']])
  })
})

describe('libraryPdfFilename', () => {
  it('is the library name with its version', () => {
    expect(libraryPdfFilename({ name: 'Distributed Workflow Action Library', version: '1.0.0' })).toBe(
      'Distributed Workflow Action Library(1.0.0).pdf',
    )
  })

  it('omits a missing version', () => {
    expect(libraryPdfFilename({ name: 'Kitchen' })).toBe('Kitchen.pdf')
  })
})

describe('renderItemHeader', () => {
  function stubDoc() {
    const calls: Array<[string, unknown[]]> = []
    const rec =
      (k: string) =>
      (...a: unknown[]) => {
        calls.push([k, a])
      }
    const doc = {
      text: vi.fn(rec('text')),
      line: vi.fn(rec('line')),
      setLineWidth: vi.fn(rec('setLineWidth')),
      setFontSize: vi.fn(rec('setFontSize')),
      setDrawColor: vi.fn(),
      setTextColor: vi.fn(),
      setFont: vi.fn(),
      splitTextToSize: vi.fn((s: string) => [s]),
    }
    return { doc: doc as unknown as jsPDF, calls }
  }

  it('draws a thick rule, then the name below it without overlapping, then version and description', () => {
    const { doc, calls } = stubDoc()
    const end = renderItemHeader(
      doc,
      { name: 'Create Runtime Workflow', version: '1.0.0', description: 'Makes one.' },
      100,
    )

    const line = calls.find(([k]) => k === 'line')!
    const lineY = line[1][1] as number
    const width = calls.filter(([k]) => k === 'setLineWidth').map(([, a]) => a[0] as number)
    expect(Math.max(...width)).toBeGreaterThanOrEqual(2)

    const texts = calls.filter(([k]) => k === 'text').map(([, a]) => a)
    const name = texts.find((a) => a[0] === 'Create Runtime Workflow')!
    // The name's baseline sits at least a full font height below the rule, so its ascenders clear it.
    const sizes = calls.filter(([k]) => k === 'setFontSize').map(([, a]) => a[0] as number)
    const nameSize = Math.max(...sizes)
    expect(nameSize).toBeGreaterThan(12)
    expect((name[2] as number) - lineY).toBeGreaterThanOrEqual(nameSize)

    expect(texts.some((a) => a[0] === 'Version 1.0.0')).toBe(true)
    const desc = texts.find((a) => Array.isArray(a[0]) && (a[0] as string[])[0] === 'Makes one.')
    expect(desc).toBeDefined()
    expect(end).toBeGreaterThan(name[2] as number)
  })
})

describe('action and environment library PDFs', () => {
  const lib = (entityType: 'action' | 'environment', name: string): Library => ({
    id: `${entityType}-lib`,
    name,
    entityType,
    version: '1.0.0',
    createdAt: 0,
    updatedAt: 0,
  })
  const action: Specification = {
    id: 'a1',
    libraryId: 'action-lib',
    name: 'Create Runtime Workflow',
    description: 'Create a Runtime Workflow on a Work Center.',
    version: '2.1.0',
    state: 'Draft',
    data: {
      inputs: [param('WorkCenter', 'Name of the work center', 'Name')],
      outputs: [param('CompletionStatus', '0=No Error', 'Code', 'ErrorText')],
    },
    createdAt: 0,
    updatedAt: 0,
  } as unknown as Specification

  // jsPDF writes text uncompressed by default, so the drawn strings are in the output.
  const pdfText = (doc: jsPDF) => doc.output()

  it('action library: element rows, descriptions, action description and version, no Type column', () => {
    const out = pdfText(generateActionLibraryPDF(lib('action', 'Distributed'), [action])!)
    for (const s of [
      'WorkCenter.Name',
      'Name of the work center',
      'CompletionStatus.Code',
      'CompletionStatus.ErrorText',
      '0=No Error',
      'Create a Runtime Workflow on a Work Center.',
      'Version 2.1.0',
    ]) {
      expect(out).toContain(`(${s})`)
    }
    expect(out).not.toContain('(Type)')
    expect(out).not.toContain('(literal)')
  })

  it('environment library: each included action shows its version, description and element rows', () => {
    const env: Specification = {
      id: 'e1',
      libraryId: 'environment-lib',
      name: 'Plant Floor',
      description: 'The floor.',
      version: '1.2.0',
      state: 'Draft',
      data: { included_actions: [{ action_name: 'Create Runtime Workflow', action_library: 'Distributed' }] },
      createdAt: 0,
      updatedAt: 0,
    } as unknown as Specification
    const actionLib = lib('action', 'Distributed')
    const out = pdfText(
      generateEnvironmentLibraryPDF(
        lib('environment', 'Envs'),
        [env],
        [actionLib],
        new Map([[actionLib.id, [action]]]),
      )!,
    )
    for (const s of [
      'Version 1.2.0',
      'The floor.',
      'Version 2.1.0',
      'WorkCenter.Name',
      'Name of the work center',
      'CompletionStatus.ErrorText',
    ]) {
      expect(out).toContain(`(${s})`)
    }
    expect(out).not.toContain('(literal)')
  })

  it('environment library: a team action library beats the GLOBAL one of the same name', () => {
    const env = {
      id: 'e1',
      libraryId: 'environment-lib',
      name: 'Plant Floor',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      data: { included_actions: [{ action_name: 'Create Runtime Workflow', action_library: 'Distributed' }] },
      createdAt: 0,
      updatedAt: 0,
    } as unknown as Specification
    const globalLib = { ...lib('action', 'Distributed'), id: 'g', teamId: 'team-global' }
    const teamLib = { ...lib('action', 'Distributed'), id: 't', teamId: 'team-main' }
    const globalAction = { ...action, id: 'ga', description: 'FROM GLOBAL' } as Specification
    const teamAction = { ...action, id: 'ta', description: 'FROM TEAM' } as Specification
    const envLib = { ...lib('environment', 'Envs'), teamId: 'team-main' }
    const out = pdfText(
      generateEnvironmentLibraryPDF(
        envLib,
        [env],
        [globalLib, teamLib],
        new Map([
          ['g', [globalAction]],
          ['t', [teamAction]],
        ]),
      )!,
    )
    expect(out).toContain('(FROM TEAM)')
    expect(out).not.toContain('(FROM GLOBAL)')
  })
})
