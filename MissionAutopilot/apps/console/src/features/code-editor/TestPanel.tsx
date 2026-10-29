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

import { useState } from 'react'
import { Button } from '@mission/ui'
import { Input } from '@mission/ui'
import { Label } from '@mission/ui'
import { Badge } from '@mission/ui'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useTestCode } from './hooks'
import { formatDuration } from '@/lib/utils'
import type { InputParameterSpec, OutputParameterSpec } from '@/lib/types'

interface TestPanelProps {
  actionOid: string
  state: string
  code: string
  inputParameters: InputParameterSpec[]
  outputParameters: OutputParameterSpec[]
}

export default function TestPanel({
  actionOid,
  state,
  code,
  inputParameters,
  outputParameters,
}: TestPanelProps) {
  const [testInputs, setTestInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(inputParameters.map((p) => [p.id, p.default_value ?? '']))
  )

  const testMutation = useTestCode()

  function handleInputChange(name: string, value: string) {
    setTestInputs((prev) => ({ ...prev, [name]: value }))
  }

  function handleRunTest() {
    testMutation.mutate({ actionOid, state, code, inputs: testInputs })
  }

  const result = testMutation.data

  // Build a lookup for output parameter metadata
  const outputParamMap = new Map(outputParameters.map((p) => [p.id, p]))

  return (
    <Card className="border-t-0 rounded-t-none border-primary/30">
      <CardHeader className="pb-2 pt-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Test Execution</CardTitle>
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={handleRunTest}
            disabled={testMutation.isPending}
          >
            {testMutation.isPending ? 'Running...' : 'Run Test'}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Input fields */}
        {inputParameters.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {inputParameters.map((param) => (
              <div key={param.id} className="space-y-1">
                <Label htmlFor={`test-input-${param.id}`} className="text-xs font-medium">
                  {param.id}
                  {param.value_type && (
                    <span className="ml-1 text-muted-foreground font-normal">
                      ({param.value_type})
                    </span>
                  )}
                </Label>
                <Input
                  id={`test-input-${param.id}`}
                  className="h-7 text-xs font-mono"
                  value={testInputs[param.id] ?? ''}
                  onChange={(e) => handleInputChange(param.id, e.target.value)}
                  placeholder={param.default_value ?? ''}
                />
                {param.description && (
                  <p className="text-[10px] text-muted-foreground leading-tight">
                    {param.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No input parameters</p>
        )}

        {/* Error from mutation */}
        {testMutation.isError && (
          <div className="rounded border border-destructive/40 bg-destructive/5 p-2">
            <p className="text-xs text-destructive font-medium">Test request failed</p>
            <p className="text-xs text-destructive mt-0.5">
              {testMutation.error instanceof Error ? testMutation.error.message : 'Unknown error'}
            </p>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-2.5 border-t pt-3">
            <div className="flex items-center gap-3 flex-wrap">
              <Badge variant={result.success ? 'default' : 'destructive'} className="text-xs">
                {result.success ? 'Success' : 'Failed'}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {formatDuration(result.execution_time_ms)}
              </span>
              {result.return_value !== null && result.return_value !== undefined && (
                <span className="text-xs text-muted-foreground">
                  return:{' '}
                  <span className="font-mono text-foreground">{String(result.return_value)}</span>
                </span>
              )}
            </div>

            {/* Failure — error type and message (may be multi-line) */}
            {!result.success && result.error && (
              <div className="rounded border border-destructive/40 bg-destructive/5 p-2">
                {result.error_type && (
                  <p className="text-xs text-destructive font-medium mb-1">{result.error_type}</p>
                )}
                <pre className="text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-48 text-destructive">
                  {result.error}
                </pre>
              </div>
            )}

            {/* Outputs — labeled table */}
            {result.outputs && Object.keys(result.outputs).length > 0 && (
              <div>
                <p className="text-xs font-medium mb-1">Outputs</p>
                <div className="rounded border text-xs">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-left px-2 py-1 font-medium">Parameter</th>
                        <th className="text-left px-2 py-1 font-medium">Value</th>
                        <th className="text-left px-2 py-1 font-medium text-muted-foreground">
                          Type
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(result.outputs).map(([key, value]) => {
                        const spec = outputParamMap.get(key)
                        return (
                          <tr key={key} className="border-b last:border-b-0">
                            <td className="px-2 py-1 font-mono">{key}</td>
                            <td className="px-2 py-1 font-mono">{String(value)}</td>
                            <td className="px-2 py-1 text-muted-foreground">
                              {spec?.value_type ?? ''}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Stdout */}
            {result.stdout && (
              <div>
                <p className="text-xs font-medium mb-1">stdout</p>
                <pre className="text-xs font-mono bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-32">
                  {result.stdout}
                </pre>
              </div>
            )}

            {/* Stderr */}
            {result.stderr && (
              <div>
                <p className="text-xs font-medium mb-1 text-orange-600">stderr</p>
                <pre className="text-xs font-mono bg-orange-50 border border-orange-200 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-32 text-orange-800">
                  {result.stderr}
                </pre>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
