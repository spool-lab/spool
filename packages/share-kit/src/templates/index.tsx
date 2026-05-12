// TemplateRender — dispatches to the right template. Used by both the
// Editor preview pane and the export pipeline.

import type { Conversation, EditorOpts, Template } from '@/lib/types'
import { Atelier } from './atelier'
import { Letter } from './letter'
import { Transcript } from './transcript'
import { Interview } from './interview'
import { Chat } from './chat'

interface Props {
  template: Template
  convo: Conversation
  opts: EditorOpts
}

export function TemplateRender({ template, convo, opts }: Props) {
  switch (template) {
    case 'atelier':
      return <Atelier convo={convo} opts={opts} />
    case 'letter':
      return <Letter convo={convo} opts={opts} />
    case 'transcript':
      return <Transcript convo={convo} opts={opts} />
    case 'interview':
      return <Interview convo={convo} opts={opts} />
    case 'chat':
      return <Chat convo={convo} opts={opts} />
  }
}
