import { Children, isValidElement, memo, useMemo, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { findHighlightPlugin, type Range } from '../markdown/findHighlightPlugin.js'
import CodeBlock from './CodeBlock.js'

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'mark'],
  attributes: {
    ...(defaultSchema.attributes ?? {}),
    mark: ['data*'],
  },
}

interface Props {
  text: string
  isDark: boolean
  findRanges?: ReadonlyArray<Range>
  matchIndexOffset?: number
  activeMatchIndex?: number
  onActiveMatchRef?: (node: HTMLElement | null) => void
}

function MarkdownContent({
  text,
  isDark,
  findRanges = [],
  matchIndexOffset = 0,
  activeMatchIndex = -1,
  onActiveMatchRef,
}: Props) {
  const remarkPlugins = useMemo(
    () => [
      remarkGfm,
      [findHighlightPlugin, { ranges: findRanges, matchIndexOffset, activeMatchIndex }],
    ] as ComponentProps<typeof ReactMarkdown>['remarkPlugins'],
    [findRanges, matchIndexOffset, activeMatchIndex],
  )

  const rehypePlugins = useMemo(
    () => [[rehypeSanitize, sanitizeSchema]] as ComponentProps<typeof ReactMarkdown>['rehypePlugins'],
    [],
  )

  const components: ComponentProps<typeof ReactMarkdown>['components'] = useMemo(() => ({
    pre(props) {
      const codeChild = Children.toArray(props.children).find(
        (c): c is ReactElement => isValidElement(c) && c.type === 'code',
      )
      if (!codeChild) {
        return <pre {...props} />
      }
      const codeProps = codeChild.props as { className?: string; children?: ReactNode }
      const match = /language-([\w-]+)/.exec(codeProps.className ?? '')
      const codeChildren = codeProps.children
      if (typeof codeChildren === 'string') {
        const code = codeChildren.replace(/\n$/, '')
        const lang = match?.[1]
        return lang
          ? <CodeBlock code={code} lang={lang} isDark={isDark} />
          : <CodeBlock code={code} isDark={isDark} />
      }
      // Find-highlight has split the code block into mixed text + <mark> nodes.
      // Render plainly so the highlights survive; sacrifice shiki for this one block.
      return (
        <pre className="my-2 p-3 rounded-md overflow-x-auto bg-warm-surface dark:bg-dark-surface text-[12.5px] leading-snug font-mono">
          <code>{codeChildren}</code>
        </pre>
      )
    },
    code({ children, ...rest }) {
      // Only inline code reaches here visibly — `pre` handles fenced cases.
      // Re-rendering of the inner `<code>` inside `pre`'s CodeBlock branch is discarded.
      return (
        <code className="font-mono text-[0.92em] px-1 py-0.5 rounded bg-warm-surface dark:bg-dark-surface" {...rest}>
          {children}
        </code>
      )
    },
    mark({ children, ...rest }) {
      const dataActive = (rest as { 'data-active'?: string })['data-active']
      const isActive = dataActive === 'true'
      return (
        <mark
          ref={isActive ? onActiveMatchRef : undefined}
          data-testid={isActive ? 'session-find-active-match' : undefined}
          className="font-semibold bg-transparent"
          style={{ color: 'var(--color-accent)' }}
        >
          {children}
        </mark>
      )
    },
    a({ children, href }) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-accent dark:text-accent-dark underline-offset-2 hover:underline"
        >
          {children}
        </a>
      )
    },
  }), [isDark, onActiveMatchRef])

  return (
    <div className="markdown-body text-sm text-neutral-800 dark:text-neutral-200 leading-relaxed break-words [&_p]:my-1 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_li]:my-0.5 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-[15px] [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-warm-border [&_blockquote]:dark:border-dark-border [&_blockquote]:pl-3 [&_blockquote]:text-warm-muted [&_blockquote]:dark:text-dark-muted [&_table]:my-2 [&_th]:text-left [&_th]:font-semibold [&_td]:py-1 [&_td]:pr-3">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

export default memo(MarkdownContent)
