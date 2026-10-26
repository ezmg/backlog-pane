// Redmine's Textile and Backlog.md's Markdown, both ways, for what issues
// use most: headings, bold and italic, inline code, code blocks, lists,
// quotes, links and images. Anything else passes as it is. Pure.
//
// Redmine keeps a description in the format its administrator chose:
// Textile (the default before Redmine 5.1) or Markdown / CommonMark. A
// project sets which, in Integration…; with Markdown nothing is converted.
// The two directions are built to give the same text back for what they
// cover, so a description that went out and came back counts as unchanged.

/** Text outside code: inline rules apply here only. */
function inlineToMarkdown(line: string): string {
  return line
    .split(/(`[^`]*`|@[^@\s][^@]*@)/)
    .map((part, i) => {
      if (i % 2 === 1) return part.startsWith('@') ? `\`${part.slice(1, -1)}\`` : part
      return part
        .replace(/!([^\s!(][^\s!]*?)(?:\(([^)]*)\))?!/g, (_, src: string, alt?: string) => `![${alt ?? ''}](${src})`)
        .replace(/"([^"\n]+)":((?:https?|ftp|mailto):[^\s<>"]*[^\s<>".,;:!?)])/g, '[$1]($2)')
        .replace(/(^|[\s(>[{'"])\*(?=\S)([^*\n]*?\S)\*(?=$|[\s.,;:!?)\]'"])/g, '$1**$2**')
        .replace(/(^|[\s(>[{'"])_(?=\S)([^_\n]*?\S)_(?=$|[\s.,;:!?)\]'"])/g, '$1*$2*')
        .replace(/(^|[\s(>[{'"])-(?=\S)([^-\n]*?\S)-(?=$|[\s.,;:!?)\]'"])/g, '$1~~$2~~')
    })
    .join('')
}

/** Textile, as Redmine keeps it, in Backlog.md's Markdown. */
export function textileToMarkdown(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string
    // <pre>, <pre><code class="xml">: a fenced block, its text untouched.
    const pre = /^\s*<pre>(?:<code(?:\s+class=["']?([\w+-]+)["']?)?>)?(.*)$/.exec(line)
    if (pre) {
      const body: string[] = []
      let rest = pre[2] ?? ''
      let j = i
      while (!/<\/pre>/.test(rest) && j + 1 < lines.length) {
        if (rest !== '') body.push(rest)
        rest = lines[++j] as string
      }
      const last = rest.replace(/(?:<\/code>)?<\/pre>.*$/, '')
      if (last !== '') body.push(last)
      out.push(`\`\`\`${pre[1] ?? ''}`, ...body.map(one => one.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')), '```')
      i = j
      continue
    }
    const heading = /^h([1-6])\.\s+(.*)$/.exec(line)
    if (heading) {
      out.push(`${'#'.repeat(Number(heading[1]))} ${inlineToMarkdown(heading[2] ?? '')}`)
      continue
    }
    const quote = /^bq\.\s+(.*)$/.exec(line)
    if (quote) {
      out.push(`> ${inlineToMarkdown(quote[1] ?? '')}`)
      continue
    }
    // Lists: "#" numbered, "*" bulleted, one mark more per level.
    const item = /^([#*]+)\s+(.*)$/.exec(line)
    if (item) {
      const marks = item[1] as string
      const depth = marks.length - 1
      const isNumbered = marks.endsWith('#')
      out.push(`${'   '.repeat(depth)}${isNumbered ? '1.' : '-'} ${inlineToMarkdown(item[2] ?? '')}`)
      continue
    }
    out.push(inlineToMarkdown(line))
  }
  return out.join('\n')
}

function inlineToTextile(line: string): string {
  return line
    .split(/(`[^`]*`)/)
    .map((part, i) => {
      if (i % 2 === 1) return `@${part.slice(1, -1)}@`
      return part
        .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt: string, src: string) => (alt ? `!${src}(${alt})!` : `!${src}!`))
        .replace(/\[([^\]\n]+)\]\(((?:https?|ftp|mailto):[^)\s]+)\)/g, '"$1":$2')
        .replace(/~~(?=\S)([^~\n]*?\S)~~/g, '-$1-')
        .replace(/(^|[^*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?!\*)/g, '$1_$2_')
        .replace(/\*\*(?=\S)([^*\n]*?\S)\*\*/g, '*$1*')
    })
    .join('')
}

/** Backlog.md's Markdown in Textile, for a description sent to a Textile Redmine. */
export function markdownToTextile(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string
    const fence = /^```([\w+-]*)\s*$/.exec(line)
    if (fence) {
      const body: string[] = []
      let j = i + 1
      while (j < lines.length && !/^```\s*$/.test(lines[j] as string)) body.push(lines[j++] as string)
      const escaped = body.map(one => one.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
      out.push(fence[1] ? `<pre><code class="${fence[1]}">` : '<pre>', ...escaped, fence[1] ? '</code></pre>' : '</pre>')
      i = j
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      out.push(`h${(heading[1] as string).length}. ${inlineToTextile(heading[2] ?? '')}`)
      continue
    }
    // Redmine's Textile reads "> " quotes as Markdown does: kept as they are.
    const quote = /^(>+\s?)(.*)$/.exec(line)
    if (quote) {
      out.push(`${quote[1]}${inlineToTextile(quote[2] ?? '')}`)
      continue
    }
    const item = /^(\s*)(?:([-*+])|\d+[.)])\s+(.*)$/.exec(line)
    if (item) {
      const indent = (item[1] as string).replace(/\t/g, '   ').length
      // Nested items are indented by 2 to 4 spaces a level in Markdown.
      const depth = Math.round(indent / 3)
      out.push(`${(item[2] ? '*' : '#').repeat(depth + 1)} ${inlineToTextile(item[3] ?? '')}`)
      continue
    }
    out.push(inlineToTextile(line))
  }
  return out.join('\n')
}
