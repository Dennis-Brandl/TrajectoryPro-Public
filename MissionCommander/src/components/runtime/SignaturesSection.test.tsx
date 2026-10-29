// @vitest-environment jsdom
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
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignaturesSection } from './SignaturesSection';
import type { StepSignatureView } from '@/lib/api/types';

const signed: StepSignatureView = {
  id: 'sig1', stepOid: 's-1', stepName: 'Approve batch', signerLoginName: 'jane', signerDisplayName: 'Jane Lee',
  roleName: 'QA Lead', meaning: null, decision: 'yes', outcome: 'signed', failureCode: null, signedAt: '2026-09-07T10:00:00.000Z',
};
const failed: StepSignatureView = {
  ...signed, id: 'sig2', signerLoginName: 'bob', signerDisplayName: null, roleName: null, decision: null,
  outcome: 'failed', failureCode: 'SIGNATURE_INVALID_CREDENTIALS',
};

describe('SignaturesSection', () => {
  it('renders nothing when there are no signatures', () => {
    const { container } = render(<SignaturesSection signatures={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('starts collapsed with the count, toggles the rows, and mutes failed attempts', async () => {
    render(<SignaturesSection signatures={[signed, failed]} />);
    expect(screen.queryByText(/Jane Lee/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show signatures (2)' }));
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Approve batch · Jane Lee (jane) · QA Lead · yes · ');
    expect(rows[0]).toHaveTextContent(new Date(signed.signedAt).toLocaleString());
    expect(rows[0]).not.toHaveClass('opacity-60');
    expect(rows[1]).toHaveTextContent('Approve batch · bob (bob) · any member · ');
    expect(rows[1]).toHaveTextContent('failed: SIGNATURE_INVALID_CREDENTIALS');
    expect(rows[1]).toHaveClass('opacity-60');
    await userEvent.click(screen.getByRole('button', { name: 'Hide signatures' }));
    expect(screen.queryByText(/Jane Lee/)).not.toBeInTheDocument();
  });
});
