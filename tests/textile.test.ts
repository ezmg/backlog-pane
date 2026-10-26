import { describe, expect, test } from 'claude-code/testing'

import { markdownToTextile, textileToMarkdown } from '../hooks/textile'

// Redmine's Textile and Backlog.md's Markdown: what issues use most, and
// the same text back after a round trip.

describe('Textile to Markdown', () => {
  test('numbered and bulleted lists, nested', async () => {
    expect(textileToMarkdown('Steps:\n# Book a car\n# Cancel\n## Again\n* one\n** two')).toBe(
      'Steps:\n1. Book a car\n1. Cancel\n   1. Again\n- one\n   - two',
    )
  })
  test('bold, italic, inline code, struck out; not inside words or URLs', async () => {
    expect(textileToMarkdown('* *Pause and messages*: _see_ @code 10075@ and -old- text')).toBe(
      '- **Pause and messages**: *see* `code 10075` and ~~old~~ text',
    )
    expect(textileToMarkdown('snake_case_name and a-b-c and https://x.test/a_b_c-d.mp4?e=f')).toBe(
      'snake_case_name and a-b-c and https://x.test/a_b_c-d.mp4?e=f',
    )
  })
  test('code blocks, with or without a language, their text untouched', async () => {
    const text = 'The error:\n<pre><code class="xml">\nReset: {\n    code: 10076, *not bold*\n},\n</code></pre>\nAfter.'
    expect(textileToMarkdown(text)).toBe('The error:\n```xml\nReset: {\n    code: 10076, *not bold*\n},\n```\nAfter.')
    expect(textileToMarkdown('<pre>a &lt; b</pre>')).toBe('```\na < b\n```')
  })
  test('headings, quotes, links and images', async () => {
    expect(textileToMarkdown('h2. Services\nbq. Quoted\nSee "the docs":https://x.test/api. !shot.png!')).toBe(
      '## Services\n> Quoted\nSee [the docs](https://x.test/api). ![](shot.png)',
    )
  })
})

describe('Markdown to Textile', () => {
  test('the same constructs, the other way', async () => {
    expect(markdownToTextile('## Title\n1. one\n   1. sub\n- dot\n**bold** *it* `code` ~~gone~~ [a](https://x.test)')).toBe(
      'h2. Title\n# one\n## sub\n* dot\n*bold* _it_ @code@ -gone- "a":https://x.test',
    )
    expect(markdownToTextile('```js\nif (a < b) {}\n```')).toBe('<pre><code class="js">\nif (a &lt; b) {}\n</code></pre>')
  })
  test('a round trip gives the same text back', async () => {
    const textile = [
      'Steps:',
      '# Book a car',
      '## Again',
      '* *Pause*: _see_ @x@',
      '',
      '<pre><code class="xml">',
      'a &lt; b',
      '</code></pre>',
      'h3. End',
    ].join('\n')
    expect(markdownToTextile(textileToMarkdown(textile))).toBe(textile)
    const markdown = '# Title\n\n1. one\n   - two\n\n**bold** and *it* and `code`'
    expect(textileToMarkdown(markdownToTextile(markdown))).toBe(markdown)
  })
})
