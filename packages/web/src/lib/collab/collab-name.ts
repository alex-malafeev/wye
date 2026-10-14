// The Yjs fragment a page's blocks live in — the same name on the server (lib/collab/collab-blocks) and in the editor
export const FRAGMENT = 'document-store';
// a live document's name is the page's ref
export const docName = (product: string, project: string, slug: string) => `${product}/${project}/${slug}`;
