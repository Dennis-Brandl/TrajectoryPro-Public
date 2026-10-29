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

import type { Page, Locator } from '@playwright/test'

/**
 * Drag a palette item onto the ReactFlow canvas, dispatching synthetic events
 * with the custom `application/reactflow` MIME type that FlowCanvas reads.
 *
 * Coordinates are relative to the canvas container element. The canvas drag
 * handler triggers SubWorkflowCreationDialog automatically for 'workflowProxy'.
 */
export async function dragStepFromPalette(
  page: Page,
  paletteItem: Locator,
  nodeType: string,
  targetOffset: { x: number; y: number } = { x: 200, y: 200 },
): Promise<void> {
  await paletteItem.scrollIntoViewIfNeeded()
  const paletteBox = await paletteItem.boundingBox()
  if (!paletteBox) throw new Error('palette item has no bounding box')

  // Locate the ReactFlow canvas root. FlowCanvas wraps it in a div with onDrop handler.
  const canvas = page.locator('.react-flow').first()
  await canvas.waitFor({ state: 'visible' })
  const canvasBox = await canvas.boundingBox()
  if (!canvasBox) throw new Error('canvas has no bounding box')

  const dropX = canvasBox.x + targetOffset.x
  const dropY = canvasBox.y + targetOffset.y

  // Step 1: dragstart on the palette item. The palette's draggable onDragStart handler
  // will set the MIME type on the real DataTransfer.
  await paletteItem.dispatchEvent('dragstart', {
    dataTransfer: await page.evaluateHandle(() => new DataTransfer()),
  })

  // Step 2: dragover on the canvas so dropEffect gets set.
  await canvas.dispatchEvent('dragover', {
    clientX: dropX,
    clientY: dropY,
  })

  // Step 3: drop on the canvas. We pass a DataTransfer pre-populated with the
  // reactflow MIME type so the handler reads the correct node type.
  await page.evaluate(
    ({ nodeType, clientX, clientY }) => {
      const dt = new DataTransfer()
      dt.setData('application/reactflow', nodeType)
      const canvasEl = document.querySelector('.react-flow') as HTMLElement | null
      if (!canvasEl) throw new Error('no .react-flow in DOM at drop time')
      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
        dataTransfer: dt,
      })
      canvasEl.dispatchEvent(dropEvent)
    },
    { nodeType, clientX: dropX, clientY: dropY },
  )
}
