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

import { describe, it, expect } from 'vitest';
import { substituteFormDocumentParams, continueLabelOf } from './inbox.js';

const doc = (blocks: Array<Record<string, unknown>>) => ({
  version: 2,
  sections: [{ id: 'sec1', role: 'content', rows: [{ id: 'r1', blocks }] }],
});

describe('substituteFormDocumentParams', () => {
  it('substitutes known tokens in text and header blocks, leaves unknown tokens verbatim', () => {
    const input = doc([
      { id: 'b1', type: 'text', content: 'Batch {{Batch}} for {{Missing}}' },
      { id: 'b2', type: 'header', content: '<strong>{{Batch}}</strong>' },
    ]);
    const out = substituteFormDocumentParams(input, { Batch: 'B-42' }) as typeof input;
    const blocks = out.sections[0].rows[0].blocks;
    expect(blocks[0].content).toBe('Batch B-42 for {{Missing}}');
    expect(blocks[1].content).toBe('<strong>B-42</strong>');
  });

  it('HTML-escapes substituted values — values are data, never markup', () => {
    const input = doc([{ id: 'b1', type: 'text', content: 'v: {{P}}' }]);
    const out = substituteFormDocumentParams(input, { P: `<b>&"'x` }) as typeof input;
    expect(out.sections[0].rows[0].blocks[0].content).toBe('v: &lt;b&gt;&amp;&quot;&#39;x');
  });

  it('a value containing {{OtherToken}} is NOT re-scanned (single pass, no recursion)', () => {
    const input = doc([{ id: 'b1', type: 'text', content: '{{A}}' }]);
    const out = substituteFormDocumentParams(input, { A: '{{B}}', B: 'nope' }) as typeof input;
    expect(out.sections[0].rows[0].blocks[0].content).toBe('{{B}}');
  });

  it('never touches non-text blocks, and does not mutate its input', () => {
    const input = doc([
      { id: 'b1', type: 'textInput', fieldName: 'f', label: '{{Batch}}' },
      { id: 'b2', type: 'text', content: '{{Batch}}' },
    ]);
    const out = substituteFormDocumentParams(input, { Batch: 'B-42' }) as typeof input;
    expect(out.sections[0].rows[0].blocks[0].label).toBe('{{Batch}}');
    expect(input.sections[0].rows[0].blocks[1].content).toBe('{{Batch}}'); // input untouched
  });

  it('degrades to identity on malformed shapes (null, non-object, missing/odd sections/rows/blocks)', () => {
    expect(substituteFormDocumentParams(null, { A: 'x' })).toBeNull();
    expect(substituteFormDocumentParams('s', { A: 'x' })).toBe('s');
    const noSections = { version: 2 };
    expect(substituteFormDocumentParams(noSections, { A: 'x' })).toBe(noSections);
    const odd = { sections: [{ rows: 'nope' }, null, { rows: [{ blocks: 'nope' }, null] }] };
    expect(substituteFormDocumentParams(odd, { A: 'x' })).toEqual(odd);
  });

  it('coerces non-string snapshot values instead of throwing (M3: a bad value must not 500 the whole inbox)', () => {
    const input = doc([{ id: 'b1', type: 'text', content: 'n: {{N}}' }]);
    const out = substituteFormDocumentParams(input, { N: 42 as unknown as string }) as typeof input;
    expect(out.sections[0].rows[0].blocks[0].content).toBe('n: 42');
  });
});

describe('substituteFormDocumentParams — lists sourced from an input parameter', () => {
  // What the engine snapshots for a structured value property (Description already left out).
  const structured = JSON.stringify([
    { name: 'Redder', value: 'Redder' },
    { name: 'Greener', value: 'Greener' },
    { name: 'Blueer', value: 'Blueer' },
  ]);
  const items = [
    { label: 'Redder', value: 'Redder' },
    { label: 'Greener', value: 'Greener' },
    { label: 'Blueer', value: 'Blueer' },
  ];

  it("fills a dropdown or combo box's list from the elements of a structured value property", () => {
    const input = doc([
      { id: 'd', type: 'textInput', inputMode: 'dropdown', listItems: [], listSource: { mode: 'input', value: 'DropdownList' } },
      { id: 'c', type: 'textInput', inputMode: 'combobox', listItems: [], listSource: { mode: 'input', value: 'DropdownList' } },
    ]);
    const out = substituteFormDocumentParams(input, { DropdownList: structured }) as typeof input;
    expect(out.sections[0].rows[0].blocks[0].listItems).toEqual(items);
    expect(out.sections[0].rows[0].blocks[1].listItems).toEqual(items);
    expect(input.sections[0].rows[0].blocks[0].listItems).toEqual([]); // input untouched
  });

  it('replaces checkbox and radio options with the bound list', () => {
    const input = doc([
      { id: 'k', type: 'checkbox', options: [{ label: 'Option 1', value: 'option_1' }], listSource: { mode: 'input', value: 'L' } },
      { id: 'r', type: 'radio', options: [], listSource: { mode: 'input', value: 'L' } },
    ]);
    const out = substituteFormDocumentParams(input, { L: structured }) as typeof input;
    expect(out.sections[0].rows[0].blocks[0].options).toEqual(items);
    expect(out.sections[0].rows[0].blocks[1].options).toEqual(items);
  });

  it('accepts a plain JSON array of strings', () => {
    const input = doc([{ id: 'd', type: 'textInput', listItems: [], listSource: { mode: 'input', value: 'L' } }]);
    const out = substituteFormDocumentParams(input, { L: '["A","B"]' }) as typeof input;
    expect(out.sections[0].rows[0].blocks[0].listItems).toEqual([
      { label: 'A', value: 'A' },
      { label: 'B', value: 'B' },
    ]);
  });

  it('leaves the block alone for a static source, a missing parameter, or a value that is not a list', () => {
    const blocks = [
      { id: 's', type: 'textInput', listItems: [{ label: 'X', value: 'X' }], listSource: { mode: 'static' } },
      { id: 'm', type: 'textInput', listItems: [{ label: 'X', value: 'X' }], listSource: { mode: 'input', value: 'Missing' } },
      { id: 'n', type: 'textInput', listItems: [{ label: 'X', value: 'X' }], listSource: { mode: 'input', value: 'Plain' } },
    ];
    const out = substituteFormDocumentParams(doc(blocks), { Plain: 'just text' }) as ReturnType<typeof doc>;
    for (const b of out.sections[0].rows[0].blocks) expect(b.listItems).toEqual([{ label: 'X', value: 'X' }]);
  });
});

describe('continueLabelOf', () => {
  const form = (label: string) => ({
    version: 2,
    sections: [{ id: 's', role: 'content', rows: [{ id: 'r', blocks: [
      { id: 'b', type: 'button', label, outputValue: 'continue' },
    ] }] }],
  });

  it("uses the step's Button UI parameter when it has one", () => {
    expect(continueLabelOf({
      ui_parameter_specifications: [{ type: 'Button', value: 'Done' }],
      form_document: form('Keep Going'),
    })).toBe('Done');
  });

  it("otherwise uses the label of the form's Continue button", () => {
    expect(continueLabelOf({ form_document: form('Keep Going') })).toBe('Keep Going');
  });

  it('null when neither is set', () => {
    expect(continueLabelOf({ form_document: { version: 2, sections: [] } })).toBeNull();
    expect(continueLabelOf(null)).toBeNull();
  });
});
