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
import { expect, test } from 'vitest';
import { runtimeStatusLabel, RUNTIME_DELETABLE, RUNTIME_CAN, canSkipCleanup } from './runtime-status';

test('runtimeStatusLabel maps pending to Waiting', () => {
  expect(runtimeStatusLabel('pending')).toBe('Waiting');
});

test('runtimeStatusLabel maps queued to Starting', () => {
  expect(runtimeStatusLabel('queued')).toBe('Starting');
});

test('runtimeStatusLabel maps running to Started', () => {
  expect(runtimeStatusLabel('running')).toBe('Started');
});

test('runtimeStatusLabel maps paused to Paused', () => {
  expect(runtimeStatusLabel('paused')).toBe('Paused');
});

test('runtimeStatusLabel maps completed to Completed', () => {
  expect(runtimeStatusLabel('completed')).toBe('Completed');
});

test('runtimeStatusLabel maps aborted to Aborted', () => {
  expect(runtimeStatusLabel('aborted')).toBe('Aborted');
});

test('runtimeStatusLabel maps errored to Errored', () => {
  expect(runtimeStatusLabel('errored')).toBe('Errored');
});

test('runtimeStatusLabel maps stopped to Stopped', () => {
  expect(runtimeStatusLabel('stopped')).toBe('Stopped');
});

test('runtimeStatusLabel maps pausing to Pausing…', () => {
  expect(runtimeStatusLabel('pausing')).toBe('Pausing…');
});

test('runtimeStatusLabel maps resuming to Resuming…', () => {
  expect(runtimeStatusLabel('resuming')).toBe('Resuming…');
});

test('runtimeStatusLabel maps stopping to Stopping…', () => {
  expect(runtimeStatusLabel('stopping')).toBe('Stopping…');
});

test('runtimeStatusLabel maps aborting to Aborting…', () => {
  expect(runtimeStatusLabel('aborting')).toBe('Aborting…');
});

test('RUNTIME_DELETABLE contains exactly the five deletable statuses', () => {
  expect(RUNTIME_DELETABLE.size).toBe(5);
  expect(RUNTIME_DELETABLE.has('pending')).toBe(true);
  expect(RUNTIME_DELETABLE.has('completed')).toBe(true);
  expect(RUNTIME_DELETABLE.has('aborted')).toBe(true);
  expect(RUNTIME_DELETABLE.has('stopped')).toBe(true);
  expect(RUNTIME_DELETABLE.has('errored')).toBe(true);
  expect(RUNTIME_DELETABLE.has('queued')).toBe(false);
  expect(RUNTIME_DELETABLE.has('running')).toBe(false);
  expect(RUNTIME_DELETABLE.has('paused')).toBe(false);
});

test('RUNTIME_DELETABLE excludes all four transitional statuses — unchanged by this task', () => {
  expect(RUNTIME_DELETABLE.has('pausing')).toBe(false);
  expect(RUNTIME_DELETABLE.has('resuming')).toBe(false);
  expect(RUNTIME_DELETABLE.has('stopping')).toBe(false);
  expect(RUNTIME_DELETABLE.has('aborting')).toBe(false);
});

test('runtimeStatusLabel maps the cleanup statuses', () => {
  expect(runtimeStatusLabel('stopping_cleanup')).toBe('Stopping (running cleanup)');
  expect(runtimeStatusLabel('aborting_cleanup')).toBe('Aborting (running cleanup)');
});

test('Abort is allowed during stopping_cleanup; Request stop is not', () => {
  expect(RUNTIME_CAN.abort.has('stopping_cleanup')).toBe(true);
  expect(RUNTIME_CAN.stop.has('stopping_cleanup')).toBe(false);
});

test('canSkipCleanup truth table', () => {
  const none = { stop: false, abort: false };
  const stopOnly = { stop: true, abort: false };
  const abortOnly = { stop: false, abort: true };
  expect(canSkipCleanup('stopping_cleanup', 'stop', none)).toBe(true);
  expect(canSkipCleanup('stopping', 'stop', none)).toBe(false);
  expect(canSkipCleanup('stopping', 'stop', stopOnly)).toBe(true);
  expect(canSkipCleanup('stopping', 'stop', abortOnly)).toBe(false);
  expect(canSkipCleanup('aborting_cleanup', 'abort', none)).toBe(true);
  expect(canSkipCleanup('aborting', 'abort', none)).toBe(false);
  expect(canSkipCleanup('aborting', 'abort', abortOnly)).toBe(true);
  expect(canSkipCleanup('aborting', 'abort', stopOnly)).toBe(false);
  expect(canSkipCleanup('stopping_cleanup', 'abort', abortOnly)).toBe(false);
  expect(canSkipCleanup('running', 'stop', stopOnly)).toBe(false);
});
