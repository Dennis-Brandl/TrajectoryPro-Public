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

export type DriftType = 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6'

export interface FindingBase {
  id: string
  driftType: DriftType
  libraryId: string
  libraryName: string
  userEmail: string
}

export interface D1Finding extends FindingBase {
  driftType: 'D1'
  orphanSpecId: string
  orphanSpecName: string
  dbParentId: string
  descendantCount: number
}

export interface D2Finding extends FindingBase {
  driftType: 'D2'
  childSpecId: string
  childSpecName: string
  diagramParentId: string
  dbParentId: string | null
}

export interface D3Finding extends FindingBase {
  driftType: 'D3'
  parentSpecId: string
  nodeId: string
  targetSpecId: string
}

export interface D4Finding extends FindingBase {
  driftType: 'D4'
  parentSpecId: string
  nodeId: string
  targetSpecId: string
}

export interface D5Finding extends FindingBase {
  driftType: 'D5'
  parentSpecId: string
  nodeId: string
  missingTargetId: string
}

export interface D6Finding extends FindingBase {
  driftType: 'D6'
  parentSpecId: string
  nodeId: string
  missingTargetId: string
}

export type Finding = D1Finding | D2Finding | D3Finding | D4Finding | D5Finding | D6Finding

export interface ScanReportSummary {
  byType: Record<DriftType, number>
  totalReportOnly: number
}

export interface ScanReport {
  scanId: string
  createdAt: number
  findings: Finding[]
  summary: ScanReportSummary
}

export type ScanEvent =
  | { type: 'start'; totalLibraries: number; totalSpecs: number }
  | {
      type: 'progress'
      librariesDone: number
      librariesTotal: number
      specsDone: number
      specsTotal: number
      currentLibraryName: string
      currentUserEmail: string
    }
  | { type: 'result'; scanId: string; findings: Finding[]; summary: ScanReportSummary }
  | { type: 'error'; message: string }

export interface SpecRow {
  id: string
  name: string
  data: string
  parentSpecificationId: string | null
  rootSpecificationId: string | null
}

export interface ProxyRefRow {
  parentSpecificationId: string
  nodeId: string
  targetSpecificationId: string
}

export interface DetectorInput {
  libraryId: string
  libraryName: string
  userEmail: string
  specs: SpecRow[]
  proxyRefs: ProxyRefRow[]
  specExists: Set<string>
  descendantCounts: Map<string, number>
}

export interface WorkflowProxyNode {
  nodeId: string
  ownerSpecId: string
  subWorkflowMode: 'embedded' | 'reference' | undefined
  embeddedWorkflowSpecId?: string
  referencedStepSpecId?: string
}

export type ApplyOutcome = 'applied' | 'skipped' | 'failed'

export interface ApplyResult {
  findingId: string
  result: ApplyOutcome
  message?: string
}
