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
import { Fragment, type CSSProperties } from 'react';
import type { RecordLogRow, RecordModel } from '@/components/history/record/record-model';
import type { Layout } from '~/lib/layout';

const HEAD = ['Time', 'Step', 'Run', 'Result', 'Performed by'];
const PAGE: CSSProperties = { background: '#ffffff', color: '#000000', fontFamily: 'Helvetica, Arial, sans-serif', fontSize: 12 };
const RULE: CSSProperties = { borderBottom: '1px solid #ddd' };
const RED = '#AA0000';
const GREEN = '#006644';
const PARAMS = '#333333';
// The PDF's column proportions (120/216/44/64/96 of 540 pt).
const COL_WIDTHS = ['22.2%', '40%', '8.1%', '11.9%', '17.8%'];

function Heading({ children }: { children: string }) {
  return <h3 style={{ fontSize: 13, fontWeight: 700, margin: '18px 0 6px', paddingBottom: 2, borderBottom: '1px solid #999' }}>{children}</h3>;
}

function Extras({ row }: { row: Extract<RecordLogRow, { kind: 'run' }> }) {
  return (
    <>
      {row.params !== null && <div style={{ color: PARAMS }}>{row.params}</div>}
      {row.signatures.map((s, i) => <div key={i} style={{ color: GREEN }}>{s}</div>)}
      {row.error !== null && <div style={{ color: RED }}>{row.error}</div>}
    </>
  );
}

const CELL: CSSProperties = { ...RULE, padding: '2px 4px', textAlign: 'left', verticalAlign: 'top' };

/** A params / signature / error line: its own full-width row, smaller, indented 10 + 10 x depth. */
function FullWidthRow({ text, depth, color }: { text: string; depth: number; color: string }) {
  return (
    <tr>
      <td colSpan={5} style={{ ...CELL, fontSize: '0.94em', color, paddingLeft: 4 + 10 + 10 * depth }}>{text}</td>
    </tr>
  );
}

function Table({ log }: { log: RecordLogRow[] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
      <colgroup>{COL_WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
      <thead>
        <tr style={{ background: '#ececec' }}>{HEAD.map((h) => <th key={h} style={{ ...CELL, fontWeight: 700 }}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {log.map((row, i) => row.kind === 'event' ? (
          <tr key={i}>
            <td style={CELL}>{row.time}</td>
            <td style={{ ...CELL, paddingLeft: 4 + 10 * row.depth }}>{row.step}</td>
            <td style={{ ...CELL, color: row.error ? RED : undefined }} colSpan={2}>{row.text}</td>
            <td style={CELL}>{row.performedBy}</td>
          </tr>
        ) : (
          <Fragment key={i}>
            <tr>
              <td style={CELL}>{row.time}</td>
              <td style={{ ...CELL, paddingLeft: 4 + 10 * row.depth }}>{row.step}</td>
              <td style={CELL}>{row.run}</td>
              <td style={CELL}>{row.result}</td>
              <td style={CELL}>{row.performedBy}</td>
            </tr>
            {row.params !== null && <FullWidthRow text={row.params} depth={row.depth} color={PARAMS} />}
            {row.signatures.map((s, k) => <FullWidthRow key={k} text={s} depth={row.depth} color={GREEN} />)}
            {row.error !== null && <FullWidthRow text={row.error} depth={row.depth} color={RED} />}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

function Cards({ log }: { log: RecordLogRow[] }) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {log.map((row, i) => (
        <li key={i} style={{ ...RULE, padding: '6px 0', paddingLeft: row.depth * 12, ...(row.kind === 'event' ? { fontStyle: 'italic', background: '#f6f6f6' } : {}) }}>
          {row.kind === 'event' ? (
            <>
              <div><span>{row.time}</span> · <span>{row.step}</span> · <span style={{ color: row.error ? RED : undefined }}>{row.text}</span></div>
              <div style={{ color: '#666' }}>{row.performedBy}</div>
            </>
          ) : (
            <>
              <div>
                <span>{row.time}</span> · <span>{row.step}</span>
                {row.run !== '1' && <span> · run {row.run}</span>} · <span>{row.result}</span>
              </div>
              <div style={{ color: '#666' }}>{row.performedBy}</div>
              <Extras row={row} />
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The record as the PDF lays it out, from the same RecordModel; a white page in both themes. */
export function RecordView({ model, layout }: { model: RecordModel; layout: Layout }) {
  const phone = layout === 'phone';
  return (
    <article aria-label="Record" style={{ ...PAGE, padding: phone ? 16 : '28px 34px' }}>
      <h2 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 10px' }}>{model.title}</h2>
      <dl style={{ display: 'grid', gridTemplateColumns: phone ? '1fr' : '80px 1fr 80px 1fr', gap: '3px 10px', margin: 0 }}>
        {model.header.map(([label, value]) => (
          <div key={label} style={{ display: 'contents' }}>
            <dt style={{ fontWeight: 700, color: '#555' }}>{label}</dt>
            <dd style={{ margin: 0 }}>{value}</dd>
          </div>
        ))}
      </dl>
      <p style={{ color: '#666', margin: '10px 0 0' }}>{model.zoneNote}</p>
      <Heading>Starting parameters</Heading>
      <p style={{ margin: 0 }}>{model.startingParams}</p>
      <Heading>Step log</Heading>
      {model.log.length === 0 ? <p style={{ margin: 0 }}>No step runs recorded.</p>
        : phone ? <Cards log={model.log} /> : <Table log={model.log} />}
      <Heading>Outputs</Heading>
      <p style={{ margin: 0 }}>{model.finalValues}</p>
    </article>
  );
}
