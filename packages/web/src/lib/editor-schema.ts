// The editor's own blocks and inline content as data — their type, props and content — shared by the page editor
// (components, which add how each one looks) and the server's live documents (lib/collab, which hold the same blocks
// with no view): one definition, so a page held live has exactly the schema the editor writes (plan:collaboration).
export const codeBlockConfig = { type: 'codeBlock', propSchema: { language: { default: '' }, code: { default: '' } }, content: 'none' } as const;
export const embedBlockConfig = { type: 'embed', propSchema: { node: { default: '' } }, content: 'none' } as const;
export const collectionBlockConfig = { type: 'collection', propSchema: { kind: { default: 'goal' }, query: { default: '' }, view: { default: 'table' } }, content: 'none' } as const;
export const nodeBlockConfig = { type: 'node', propSchema: { kind: { default: 'req' }, slug: { default: '' }, status: { default: '' }, form: { default: 'prose' }, textKey: { default: 'text' }, body: { default: '' }, extra: { default: '' }, check: { default: '' }, list: { default: '' }, row: { default: '' } }, content: 'inline' } as const;
export const drawingBlockConfig = { type: 'drawing', propSchema: { src: { default: '' }, title: { default: 'Drawing' } }, content: 'none' } as const;
export const viewBlockConfig = { type: 'view', propSchema: { slug: { default: 'task' }, query: { default: '' } }, content: 'none' } as const;
export const tagInlineConfig = { type: 'tag', propSchema: { id: { default: '' } }, content: 'none' } as const;
export const imgInlineConfig = { type: 'img', propSchema: { url: { default: '' }, alt: { default: '' } }, content: 'none' } as const;

// a pasted or imported <pre><code> becomes a code block with its language
export const codeBlockParse = (el: HTMLElement) => { if (el.tagName !== 'PRE') return undefined; const c = el.querySelector('code'); const lang = c?.getAttribute('data-language') || (c?.className.match(/language-([\w-]+)/) ?? [])[1] || el.getAttribute('data-language') || ''; return { language: lang, code: (c ?? el).textContent ?? '' }; };
