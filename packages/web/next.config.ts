import type { NextConfig } from 'next';
// transformers.js, its ONNX runtime and LanceDB are native/server-only; keep them out of the bundler.
// wye.test: the dev server reached under another name, as a server is (scripts/collab-presence.mjs) — dev only
const config: NextConfig = { reactStrictMode: true, allowedDevOrigins: ['wye.test'], serverExternalPackages: ['@huggingface/transformers', 'onnxruntime-node', 'sharp', '@lancedb/lancedb', '@duckdb/node-api', '@duckdb/node-bindings'] };
export default config;
