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

import { XMLBuilder, XMLParser } from 'fast-xml-parser'
import type {
  B2mmlMasterRecipe,
  B2mmlProcedureLogic,
  B2mmlRecipeElement,
  B2mmlBatchParameter,
  B2mmlBatchValue,
  B2mmlOtherInformation,
  B2mmlLink,
} from './batchml-types'

const B2MML_NS = 'http://www.mesa.org/xml/B2MML'

// B2MML elements that are repeatable (0..n) per the schema. fast-xml-parser
// collapses a lone occurrence into a scalar/object by default; force these to
// always parse as arrays so parser output matches the B2mml*/array-typed model.
const REPEATABLE_ELEMENTS = new Set([
  'Description',
  'Step',
  'Transition',
  'Link',
  'FromID',
  'ToID',
  'RecipeElement',
  'EquipmentRequirement',
  'Parameter',
  'Value',
  'OtherInformation',
  'ActualEquipmentID',
])

// ---- tree → PascalCase plain object the builder serializes ------------------

function batchValue(v: B2mmlBatchValue): Record<string, unknown> {
  return {
    ValueString: v.valueString,
    DataInterpretation: v.dataInterpretation ?? 'Nominal',
    DataType: v.dataType,
    UnitOfMeasure: v.unitOfMeasure,
  }
}

function otherInfo(o: B2mmlOtherInformation): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (o.id !== undefined) out.ID = o.id
  if (o.value) out.Value = o.value.map(batchValue)
  if (o.description) out.Description = o.description
  return out
}

function parameter(p: B2mmlBatchParameter): Record<string, unknown> {
  const out: Record<string, unknown> = { ID: p.id, ParameterType: p.parameterType }
  if (p.description !== undefined) out.Description = p.description
  if (p.value) out.Value = p.value.map(batchValue)
  return out
}

function link(l: B2mmlLink): Record<string, unknown> {
  return {
    ID: l.id,
    FromID: l.fromId.map((e) => ({ FromIDValue: e.value, FromType: e.type, IDScope: e.idScope })),
    ToID: l.toId.map((e) => ({ ToIDValue: e.value, ToType: e.type, IDScope: e.idScope })),
    LinkType: l.linkType,
    Depiction: l.depiction,
  }
}

function procedureLogic(pl: B2mmlProcedureLogic): Record<string, unknown> {
  return {
    Link: pl.link.map(link),
    Step: pl.step.map((s) => ({
      ID: s.id,
      RecipeElementID: s.recipeElementId,
      RecipeElementVersion: s.recipeElementVersion,
      ...(s.description ? { Description: s.description } : {}),
    })),
    Transition: pl.transition.map((t) => ({
      ID: t.id,
      Condition: t.condition,
      ...(t.conditionAnnotation !== undefined ? { ConditionAnnotation: t.conditionAnnotation } : {}),
      ...(t.description ? { Description: t.description } : {}),
    })),
  }
}

function recipeElement(re: B2mmlRecipeElement): Record<string, unknown> {
  const out: Record<string, unknown> = { ID: re.id, RecipeElementType: re.recipeElementType }
  if (re.version !== undefined) out.Version = re.version
  if (re.description) out.Description = re.description
  if (re.equipmentRequirement) {
    out.EquipmentRequirement = re.equipmentRequirement.map((e) => ({
      ID: e.id,
      ...(e.description !== undefined ? { Description: e.description } : {}),
    }))
  }
  if (re.actualEquipmentId) out.ActualEquipmentID = re.actualEquipmentId
  if (re.parameter) out.Parameter = re.parameter.map(parameter)
  if (re.procedureLogic) out.ProcedureLogic = procedureLogic(re.procedureLogic)
  if (re.recipeElement) out.RecipeElement = re.recipeElement.map(recipeElement)
  return out
}

function masterRecipe(mr: B2mmlMasterRecipe): Record<string, unknown> {
  const out: Record<string, unknown> = { '@_xmlns': B2MML_NS, ID: mr.id }
  if (mr.version !== undefined) out.Version = mr.version
  if (mr.versionDate !== undefined) out.VersionDate = mr.versionDate
  if (mr.description) out.Description = mr.description
  if (mr.header) {
    const h = mr.header
    out.Header = {
      ...(h.effectiveDate !== undefined ? { EffectiveDate: h.effectiveDate } : {}),
      ...(h.productId !== undefined ? { ProductID: h.productId } : {}),
      ...(h.productName !== undefined ? { ProductName: h.productName } : {}),
      ...(h.status !== undefined ? { Status: h.status } : {}),
    }
  }
  if (mr.equipmentRequirement) {
    out.EquipmentRequirement = mr.equipmentRequirement.map((e) => ({
      ID: e.id,
      ...(e.description !== undefined ? { Description: e.description } : {}),
    }))
  }
  if (mr.formula) out.Formula = { Parameter: mr.formula.parameter.map(parameter) }
  if (mr.procedureLogic) out.ProcedureLogic = procedureLogic(mr.procedureLogic)
  if (mr.recipeElement) out.RecipeElement = mr.recipeElement.map(recipeElement)
  if (mr.otherInformation) out.OtherInformation = mr.otherInformation.map(otherInfo)
  return out
}

export function serializeMasterRecipe(recipe: B2mmlMasterRecipe): string {
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    format: true,
    suppressEmptyNode: true,
  })
  const doc = { MasterRecipe: masterRecipe(recipe) }
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + builder.build(doc)
}

export function parseBatchmlXml(xmlText: string): Record<string, unknown> {
  const parser = new XMLParser({
    ignoreAttributes: false,
    trimValues: false,
    parseTagValue: false, // keep every text node as a string (ids, base64, "TRUE")
    isArray: (name: string) => REPEATABLE_ELEMENTS.has(name),
  })
  return parser.parse(xmlText) as Record<string, unknown>
}
