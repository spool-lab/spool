import { useMemo, useState } from 'react'
import { TemplateRender, DEFAULT_OPTS, type Conversation, type EditorOpts } from '@spool/share-kit'

type Props = {
  conversation: Conversation
  onBack: () => void
}

/**
 * Phase 0 share editor page — minimum viable surface that proves the
 * @spool/share-kit primitives render inside the Spool app.
 *
 * What's here: a back-button header and a live preview of the
 * conversation through TemplateRender at the template's natural
 * aspect ratio. What isn't (yet): turn selection + reorder, redaction
 * controls, template / paper / typeface picker, export buttons,
 * autosave to share_drafts. Those layer in over the next commits.
 */
export default function ShareEditorPage({ conversation, onBack }: Props) {
  // DEFAULT_OPTS is fine for now — once a style panel lands the user
  // can mutate this and we wire it through to the renderer.
  const [opts] = useState<EditorOpts>(DEFAULT_OPTS)

  const meta = useMemo(() => {
    const wordLabel = `${conversation.wordCount.toLocaleString()} ${conversation.wordCount === 1 ? 'word' : 'words'}`
    return [conversation.sourceLabel, conversation.createdAt, wordLabel, `~${conversation.readMin} min read`].join(' · ')
  }, [conversation])

  return (
    <div className="flex flex-col h-full" data-testid="share-editor-page">
      <header className="flex-none flex items-start gap-3 px-6 pt-3 pb-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          title="Back"
          className="flex-none flex items-center justify-center w-5 h-5 mt-0.5 rounded text-warm-muted dark:text-dark-muted hover:bg-warm-surface dark:hover:bg-dark-surface hover:text-warm-text dark:hover:text-dark-text transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 13 13" fill="none">
            <path d="M8 3L4 6.5L8 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-medium text-warm-text dark:text-dark-text truncate" title={conversation.title}>
            {conversation.title}
          </h1>
          <p className="mt-1 text-[11px] text-warm-faint dark:text-dark-muted truncate">
            {meta}
          </p>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto bg-warm-bg dark:bg-dark-bg">
        <div className="flex justify-center px-6 py-6">
          <div className="shadow-lg rounded-sm overflow-hidden">
            <TemplateRender template={opts.template} convo={conversation} opts={opts} />
          </div>
        </div>
      </div>
    </div>
  )
}
