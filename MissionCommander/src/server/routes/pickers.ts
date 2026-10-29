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
import { Hono } from 'hono';
import { db } from '../lib/db';
import { listWorkflowSummaries } from 'mission-control-db/src/dao/workflows';
import { listEnvironmentSpecSummaries } from 'mission-control-db/src/dao/environments';
import { listUsers } from 'mission-control-db/src/dao/users';
import { requireSession, requirePermission, type Vars } from '../middleware/auth';

export const pickerRoutes = new Hono<{ Variables: Vars }>();
pickerRoutes.use('/workflows', requireSession);
pickerRoutes.use('/environments', requireSession);
pickerRoutes.use('/users', requireSession);

pickerRoutes.get('/workflows', requirePermission('workflow:read'), async (c) => {
  return c.json({ workflows: await listWorkflowSummaries(db) });
});

pickerRoutes.get('/environments', requirePermission('environment:read'), async (c) => {
  return c.json({ environments: await listEnvironmentSpecSummaries(db) });
});

pickerRoutes.get('/users', requirePermission('user:read'), async (c) => {
  const users = (await listUsers(db)).slice().sort((a, b) => a.displayName.localeCompare(b.displayName));
  return c.json({ users });
});
