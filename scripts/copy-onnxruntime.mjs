import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'node_modules/onnxruntime-web/dist');
const destination = resolve(root, 'public/onnxruntime');
const files = [
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
];

await mkdir(destination, { recursive: true });
for (const file of files) {
  await copyFile(resolve(source, file), resolve(destination, file));
}
console.log(`Copied ${files.length} ONNX Runtime WebAssembly assets to public/onnxruntime.`);
