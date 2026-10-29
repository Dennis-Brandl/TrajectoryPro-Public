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

import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  customType,
  unique,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core'

// Drizzle pg has no first-class bytea; image_blob.data is raw image bytes.
const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return 'bytea'
  },
})

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name'),
  email: text('email').unique().notNull(),
  emailVerified: boolean('emailVerified'),
  image: text('image'),
  isAdministrator: boolean('isAdministrator').default(false),
  createdAt: timestamp('createdAt', { mode: 'date', withTimezone: true }),
  updatedAt: timestamp('updatedAt', { mode: 'date', withTimezone: true }),
})

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').unique().notNull(),
  expiresAt: timestamp('expiresAt', { mode: 'date', withTimezone: true }).notNull(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  createdAt: timestamp('createdAt', { mode: 'date', withTimezone: true }),
  updatedAt: timestamp('updatedAt', { mode: 'date', withTimezone: true }),
})

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  accessTokenExpiresAt: timestamp('accessTokenExpiresAt', { mode: 'date', withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt', { mode: 'date', withTimezone: true }),
  scope: text('scope'),
  idToken: text('idToken'),
  password: text('password'),
  createdAt: timestamp('createdAt', { mode: 'date', withTimezone: true }),
  updatedAt: timestamp('updatedAt', { mode: 'date', withTimezone: true }),
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt', { mode: 'date', withTimezone: true }).notNull(),
  createdAt: timestamp('createdAt', { mode: 'date', withTimezone: true }),
  updatedAt: timestamp('updatedAt', { mode: 'date', withTimezone: true }),
})

export const team = pgTable('team', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  createdAt: bigint('createdAt', { mode: 'number' }).notNull(),
  updatedAt: bigint('updatedAt', { mode: 'number' }).notNull(),
})

export const userTeam = pgTable(
  'user_team',
  {
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.teamId] }), index('user_team_team_idx').on(t.teamId)],
)

export const role = pgTable('role', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  isSeeded: integer('isSeeded').default(0),
})

export const roleRight = pgTable(
  'role_right',
  {
    roleId: text('roleId')
      .notNull()
      .references(() => role.id, { onDelete: 'cascade' }),
    right: text('right').notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.right] })],
)

export const userTeamRole = pgTable(
  'user_team_role',
  {
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    roleId: text('roleId')
      .notNull()
      .references(() => role.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.teamId, t.roleId] }),
    index('utr_team_idx').on(t.teamId),
    index('utr_role_idx').on(t.roleId),
  ],
)

export const appSetting = pgTable('app_setting', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export const library = pgTable(
  'library',
  {
    id: text('id').primaryKey(),
    parentLibraryId: text('parentLibraryId'), // self-reference for nested libraries (action libraries only)
    name: text('name').notNull(),
    entityType: text('entityType').notNull(), // workflow | step | environment | action
    description: text('description'),
    author: text('author'),
    changeHistory: text('changeHistory'),
    version: text('version').default('1.0.0'),
    environmentLibraryIds: text('environmentLibraryIds'),
    createdAt: bigint('createdAt', { mode: 'number' }).notNull(),
    updatedAt: bigint('updatedAt', { mode: 'number' }).notNull(),
    lastEditedByUserId: text('lastEditedByUserId').references(() => user.id, { onDelete: 'set null' }),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id),
    createdByUserId: text('createdByUserId').references(() => user.id, { onDelete: 'set null' }),
  },
  (table) => [
    unique().on(table.teamId, table.name, table.entityType, table.parentLibraryId),
    index('library_parentLibraryId_idx').on(table.parentLibraryId),
    index('library_teamId_idx').on(table.teamId),
  ],
)

export const specification = pgTable(
  'specification',
  {
    id: text('id').primaryKey(),
    libraryId: text('libraryId')
      .notNull()
      .references(() => library.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    typeName: text('typeName'),
    version: text('version').notNull().default('1.0.0'),
    state: text('state').notNull().default('Draft'),
    data: text('data').notNull(), // JSON stringified
    environmentLibraryIds: text('environmentLibraryIds'), // JSON array of environment library IDs
    createdAt: bigint('createdAt', { mode: 'number' }).notNull(), // unix timestamp ms
    updatedAt: bigint('updatedAt', { mode: 'number' }).notNull(), // unix timestamp ms
    parentSpecificationId: text('parentSpecificationId'), // self-reference; FK added in raw SQL
    rootSpecificationId: text('rootSpecificationId'), // self-reference; FK added in raw SQL
    dataSchemaVersion: integer('dataSchemaVersion').notNull().default(3),
    lastEditedByUserId: text('lastEditedByUserId').references(() => user.id, { onDelete: 'set null' }),
    history: text('history').notNull().default('[]'), // JSON array of SpecificationHistoryEntry
    effectiveFrom: bigint('effectiveFrom', { mode: 'number' }),
  },
  (table) => [
    // Name uniqueness is sibling-scoped and cannot be expressed as a drizzle
    // unique() constraint (drizzle has no partial-index support). The real
    // rule lives as two partial unique indexes in src/server/lib/db.ts:
    //   - specification_root_name_unique      WHERE parentSpecificationId IS NULL
    //   - specification_sibling_name_unique   WHERE parentSpecificationId IS NOT NULL
    index('specification_libraryId_idx').on(table.libraryId),
    index('spec_root_idx').on(table.rootSpecificationId),
    index('spec_parent_idx').on(table.parentSpecificationId),
  ],
)

// Phase 35 §1: content-addressed image storage
export const imageBlob = pgTable('image_blob', {
  contentHash: text('contentHash').primaryKey(),
  data: bytea('data').notNull(),
  mimeType: text('mimeType').notNull(),
  byteSize: integer('byteSize').notNull(),
  createdAt: bigint('createdAt', { mode: 'number' }).notNull(),
  refCount: integer('refCount').notNull().default(0),
})

export const image = pgTable(
  'image',
  {
    id: text('id').primaryKey(),
    specificationId: text('specificationId')
      .notNull()
      .references(() => specification.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    mimeType: text('mimeType').notNull(),
    contentHash: text('contentHash')
      .notNull()
      .references(() => imageBlob.contentHash, { onDelete: 'restrict' }),
    createdAt: bigint('createdAt', { mode: 'number' }).notNull(),
  },
  (table) => [unique().on(table.specificationId, table.filename), index('image_contenthash_idx').on(table.contentHash)],
)

export const imageReference = pgTable(
  'image_reference',
  {
    specificationId: text('specificationId')
      .notNull()
      .references(() => specification.id, { onDelete: 'cascade' }),
    imageId: text('imageId')
      .notNull()
      .references(() => image.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.specificationId, table.imageId] }),
    index('image_ref_image_idx').on(table.imageId),
  ],
)

export const proxyReference = pgTable(
  'proxy_reference',
  {
    parentSpecificationId: text('parentSpecificationId')
      .notNull()
      .references(() => specification.id, { onDelete: 'cascade' }),
    nodeId: text('nodeId').notNull(),
    targetSpecificationId: text('targetSpecificationId')
      .notNull()
      .references(() => specification.id, { onDelete: 'restrict' }),
  },
  (table) => [
    primaryKey({ columns: [table.parentSpecificationId, table.nodeId] }),
    index('proxy_ref_target_idx').on(table.targetSpecificationId),
  ],
)

export const libraryEnvironment = pgTable(
  'library_environment',
  {
    libraryId: text('libraryId')
      .notNull()
      .references(() => library.id, { onDelete: 'cascade' }),
    environmentLibraryId: text('environmentLibraryId')
      .notNull()
      .references(() => library.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.libraryId, table.environmentLibraryId] }),
    index('libenv_env_idx').on(table.environmentLibraryId),
  ],
)

export const specificationEnvironment = pgTable(
  'specification_environment',
  {
    specificationId: text('specificationId')
      .notNull()
      .references(() => specification.id, { onDelete: 'cascade' }),
    environmentLibraryId: text('environmentLibraryId')
      .notNull()
      .references(() => library.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.specificationId, table.environmentLibraryId] }),
    index('specenv_env_idx').on(table.environmentLibraryId),
  ],
)
