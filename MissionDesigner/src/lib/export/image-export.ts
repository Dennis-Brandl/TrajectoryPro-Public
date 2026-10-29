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

import { toPng, toSvg } from 'html-to-image'
import { getNodesBounds, getViewportForBounds } from '@xyflow/react'
import type { Node } from '@xyflow/react'

/**
 * Options for image export
 */
export interface ImageExportOptions {
  /** Output width in pixels. Default: 1920 */
  width?: number
  /** Output height in pixels. Default: 1080 */
  height?: number
  /** Background color. Default: '#ffffff' */
  backgroundColor?: string
}

/**
 * Default export options
 */
const DEFAULT_OPTIONS: Required<ImageExportOptions> = {
  width: 1920,
  height: 1080,
  backgroundColor: '#ffffff',
}

/**
 * CSS classes to exclude from export (UI controls, not diagram content)
 */
const EXCLUDED_CLASSES = ['react-flow__minimap', 'react-flow__controls', 'react-flow__panel']

/**
 * Filter function for html-to-image to exclude UI elements
 * @param node DOM element to check
 * @returns false to exclude, true to include
 */
function shouldIncludeInExport(node: Element): boolean {
  const classList = node.classList
  if (!classList) return true

  for (const excludedClass of EXCLUDED_CLASSES) {
    if (classList.contains(excludedClass)) {
      return false
    }
  }
  return true
}

/**
 * Get the viewport element from the React Flow canvas
 * @throws Error if viewport element not found
 */
function getViewportElement(): HTMLElement {
  const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
  if (!viewport) {
    throw new Error('React Flow viewport element not found. Ensure the canvas is rendered before exporting.')
  }
  return viewport
}

/**
 * Calculate viewport transform for given nodes and output dimensions
 * @param nodes Array of nodes to calculate bounds from
 * @param width Output width
 * @param height Output height
 * @returns Viewport transform object with x, y, and zoom
 */
function calculateViewport(nodes: Node[], width: number, height: number): { x: number; y: number; zoom: number } {
  const nodesBounds = getNodesBounds(nodes)
  const viewport = getViewportForBounds(
    nodesBounds,
    width,
    height,
    0.5, // minZoom
    2, // maxZoom
    0.1, // padding
  )
  return viewport
}

/**
 * Export the React Flow diagram as a PNG image
 *
 * @param nodes Array of nodes currently in the diagram
 * @param options Export options (width, height, backgroundColor)
 * @returns Promise resolving to a base64 data URL of the PNG image
 * @throws Error if nodes array is empty or viewport not found
 *
 * @example
 * ```ts
 * const nodes = useFlowStore((state) => state.nodes);
 * const dataUrl = await exportToPng(nodes, { width: 1920, height: 1080 });
 * // Use dataUrl for download or display
 * ```
 */
export async function exportToPng(nodes: Node[], options?: ImageExportOptions): Promise<string> {
  if (!nodes || nodes.length === 0) {
    throw new Error('Cannot export empty diagram. Add at least one node before exporting.')
  }

  const opts = { ...DEFAULT_OPTIONS, ...options }
  const viewport = getViewportElement()
  const transform = calculateViewport(nodes, opts.width, opts.height)

  const dataUrl = await toPng(viewport, {
    backgroundColor: opts.backgroundColor,
    width: opts.width,
    height: opts.height,
    style: {
      width: `${opts.width}px`,
      height: `${opts.height}px`,
      transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`,
    },
    filter: shouldIncludeInExport,
  })

  return dataUrl
}

/**
 * Export the React Flow diagram as an SVG image
 *
 * Note: SVG export may have font rendering issues compared to PNG.
 * PNG is generally more reliable for visual accuracy.
 *
 * @param nodes Array of nodes currently in the diagram
 * @param options Export options (width, height, backgroundColor)
 * @returns Promise resolving to an SVG data URL string
 * @throws Error if nodes array is empty or viewport not found
 *
 * @example
 * ```ts
 * const nodes = useFlowStore((state) => state.nodes);
 * const dataUrl = await exportToSvg(nodes, { width: 1920, height: 1080 });
 * // Use dataUrl for download or display
 * ```
 */
export async function exportToSvg(nodes: Node[], options?: ImageExportOptions): Promise<string> {
  if (!nodes || nodes.length === 0) {
    throw new Error('Cannot export empty diagram. Add at least one node before exporting.')
  }

  const opts = { ...DEFAULT_OPTIONS, ...options }
  const viewport = getViewportElement()
  const transform = calculateViewport(nodes, opts.width, opts.height)

  const dataUrl = await toSvg(viewport, {
    backgroundColor: opts.backgroundColor,
    width: opts.width,
    height: opts.height,
    style: {
      width: `${opts.width}px`,
      height: `${opts.height}px`,
      transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`,
    },
    filter: shouldIncludeInExport,
  })

  return dataUrl
}
