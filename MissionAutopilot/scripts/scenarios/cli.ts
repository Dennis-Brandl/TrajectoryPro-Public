#!/usr/bin/env node
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

import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildScenario } from './lib/build'
import { uploadScenarioBulk, uploadScenarioPerAction, uploadActionPackage } from './lib/upload'
import type { ScenarioDefinition } from './lib/types'

const __filename = fileURLToPath(import.meta.url)
const SCENARIOS_DIR = path.dirname(__filename)
const DEFAULT_SERVER = 'http://localhost:3002'

interface ParsedArgs {
  command: string
  positional: string[]
  options: Record<string, string>
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2)
  const command = args.shift() ?? ''
  const positional: string[] = []
  const options: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    const tok = args[i]!
    if (tok.startsWith('--')) {
      const key = tok.slice(2)
      const next = args[i + 1]
      if (next && !next.startsWith('--')) {
        options[key] = next
        i++
      } else {
        options[key] = 'true'
      }
    } else {
      positional.push(tok)
    }
  }
  return { command, positional, options }
}

async function loadScenario(name: string): Promise<ScenarioDefinition> {
  const definitionPath = path.join(SCENARIOS_DIR, name, 'definition.ts')
  // tsx imports .ts directly; use a file URL for cross-platform safety.
  const url = `file://${definitionPath.replaceAll('\\', '/')}`
  const mod = (await import(url)) as { scenario: ScenarioDefinition }
  if (!mod.scenario) {
    throw new Error(
      `${definitionPath} must export a const named 'scenario' of type ScenarioDefinition`
    )
  }
  return mod.scenario
}

async function listScenarios(): Promise<string[]> {
  const entries = await readdir(SCENARIOS_DIR, { withFileTypes: true })
  return entries
    .filter((e) => e.isDirectory() && e.name !== 'lib' && e.name !== 'dist')
    .map((e) => e.name)
}

async function main() {
  const { command, positional, options } = parseArgs(process.argv)
  const server = options['server'] ?? DEFAULT_SERVER

  if (command === 'list') {
    const names = await listScenarios()
    console.log(names.join('\n'))
    return
  }

  if (command === 'build') {
    const name = positional[0]
    if (!name) throw new Error('Usage: build <scenario>')
    const scenario = await loadScenario(name)
    const outDir = options['out'] ?? path.join(SCENARIOS_DIR, 'dist', name)
    const result = await buildScenario(scenario, outDir)
    console.log(`Built ${result.actions.length} actions`)
    console.log(`  env file:           ${result.envFilePath}`)
    console.log(`  code files:         ${result.codeFiles.length}`)
    console.log(`  .WFactionCodeX zips: ${result.actionPackages.length}`)
    return
  }

  if (command === 'upload') {
    const name = positional[0]
    if (!name) throw new Error('Usage: upload <scenario>')
    const scenario = await loadScenario(name)
    const outDir = options['out'] ?? path.join(SCENARIOS_DIR, 'dist', name)
    const build = await buildScenario(scenario, outDir)
    const result = await uploadScenarioBulk(build, server)
    console.log('Bulk upload result:', JSON.stringify(result, null, 2))
    if (result.codeFailed.length > 0) process.exit(1)
    return
  }

  if (command === 'upload-actions') {
    const name = positional[0]
    if (!name) throw new Error('Usage: upload-actions <scenario>')
    const scenario = await loadScenario(name)
    const outDir = options['out'] ?? path.join(SCENARIOS_DIR, 'dist', name)
    const build = await buildScenario(scenario, outDir)
    const result = await uploadScenarioPerAction(build, server)
    console.log('Per-action upload result:', JSON.stringify(result, null, 2))
    if (result.actionsFailed.length > 0) process.exit(1)
    return
  }

  if (command === 'upload-action') {
    const filePath = positional[0]
    if (!filePath) throw new Error('Usage: upload-action <path-to.WFactionCodeX>')
    const result = await uploadActionPackage(filePath, server)
    console.log(`status=${result.status} ok=${result.ok}`)
    console.log(result.body)
    if (!result.ok) process.exit(1)
    return
  }

  if (command === 'deploy') {
    const name = positional[0]
    if (!name) throw new Error('Usage: deploy <scenario>')
    const scenario = await loadScenario(name)
    const outDir = options['out'] ?? path.join(SCENARIOS_DIR, 'dist', name)
    const build = await buildScenario(scenario, outDir)
    const result = await uploadScenarioPerAction(build, server)
    console.log('Deploy result:', JSON.stringify(result, null, 2))
    if (result.actionsFailed.length > 0) process.exit(1)
    return
  }

  console.error(`Unknown command: ${command}`)
  console.error('Commands: list | build | upload | upload-actions | upload-action | deploy')
  process.exit(2)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
