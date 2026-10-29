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

export interface ElideProps {
  head: string
  tail: string
  className?: string
}

// Middle elision in CSS (spec §4): the head shrinks behind an ellipsis, the tail never
// does. The whole value stays the element's text and title, so its accessible name, a
// text selection and a hover all get it in full.
export function Elide({ head, tail, className }: ElideProps) {
  return (
    <span className={className ? `elide ${className}` : 'elide'} title={head + tail}>
      <span className="elide-head">{head}</span>
      <span className="elide-tail">{tail}</span>
    </span>
  )
}
