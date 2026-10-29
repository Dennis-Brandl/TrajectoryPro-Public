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

export interface B2mmlBatchValue {
  valueString: string
  dataType: string
  unitOfMeasure: string
  dataInterpretation?: string
}

export interface B2mmlOtherInformation {
  id?: string
  value?: B2mmlBatchValue[]
  description?: string[]
}

export type B2mmlParameterType = 'ProcessInput' | 'ProcessOutput' | 'ProcessParameter' | 'Other'

export interface B2mmlBatchParameter {
  id: string
  description?: string
  parameterType: B2mmlParameterType
  value?: B2mmlBatchValue[]
}

export interface B2mmlFormula {
  parameter: B2mmlBatchParameter[]
}

export interface B2mmlHeader {
  productId?: string
  productName?: string
  status?: string
  effectiveDate?: string
}

export interface B2mmlEquipmentRequirement {
  id: string
  description?: string
}

export interface B2mmlStep {
  id: string
  recipeElementId: string
  recipeElementVersion: string
  description?: string[]
}

export interface B2mmlTransition {
  id: string
  condition: string
  conditionAnnotation?: string
  description?: string[]
}

export type B2mmlLinkType =
  | 'ControlLink'
  | 'ParallelDivergent'
  | 'ParallelConvergent'
  | 'SerialDivergent'
  | 'SerialConvergent'
  | 'Other'

export interface B2mmlLinkEnd {
  value: string
  type: 'Step' | 'Transition' | 'Link'
  idScope: 'Internal' | 'External' | 'Other'
}

export interface B2mmlLink {
  id: string
  fromId: B2mmlLinkEnd[]
  toId: B2mmlLinkEnd[]
  linkType: B2mmlLinkType
  depiction: string
}

export interface B2mmlProcedureLogic {
  link: B2mmlLink[]
  step: B2mmlStep[]
  transition: B2mmlTransition[]
}

export type B2mmlRecipeElementType = 'Procedure' | 'UnitProcedure' | 'Operation' | 'Phase' | 'Begin' | 'End' | 'Other'

export interface B2mmlRecipeElement {
  id: string
  version?: string
  description?: string[]
  recipeElementType: B2mmlRecipeElementType
  equipmentRequirement?: B2mmlEquipmentRequirement[]
  actualEquipmentId?: string[]
  parameter?: B2mmlBatchParameter[]
  procedureLogic?: B2mmlProcedureLogic
  recipeElement?: B2mmlRecipeElement[]
}

export interface B2mmlMasterRecipe {
  id: string
  version?: string
  versionDate?: string
  description?: string[]
  header?: B2mmlHeader
  equipmentRequirement?: B2mmlEquipmentRequirement[]
  formula?: B2mmlFormula
  procedureLogic?: B2mmlProcedureLogic
  recipeElement?: B2mmlRecipeElement[]
  otherInformation?: B2mmlOtherInformation[]
}
