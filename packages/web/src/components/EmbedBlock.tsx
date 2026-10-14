'use client';
import { createReactBlockSpec } from '@blocknote/react';
import { EmbeddedCard, EmbedPicker } from './EmbeddedCard';
import { embedBlockConfig } from '@/lib/editor-schema';
export { EmbeddedCard } from './EmbeddedCard';

// The editor block: one line `![[kind:slug]]` in the markdown (rule:embed-line), the card on the page. The prop is
// `node`, not `id`: a prop called id collides with the block's own id inside BlockNote.
export const EmbedBlock = createReactBlockSpec(
  embedBlockConfig,
  { render: props => {
    const id = (props.block.props as { node: string }).node;
    if (!id) return <EmbedPicker onPick={picked => props.editor.updateBlock(props.block, { props: { node: picked } } as never)} />;
    return <EmbeddedCard id={id} inEditor />;
  } },
);
