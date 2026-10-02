# Third-party software and model licenses

The application uses the packages listed in `package.json` and resolved in `package-lock.json`. Review each package's installed license and any transitive notices before redistributing a production build.

Important runtime dependencies include React, Vite, TypeScript, Lucide React, PDF.js, Mammoth, JSZip, Express, Express Session, Helmet, Express Rate Limit, and Microsoft Authentication Library for Node.js. Their licenses and notices should be verified against the exact versions being shipped; this file is not a substitute for the package-provided license texts.

## Downloadable Piper voice engine

The Piper feature loads its selected voice model and pinned phonemizer files in the browser. ONNX Runtime WASM
assets are copied from the locked npm package into the production build by `scripts/copy-onnxruntime.mjs`.
Story text is sent only to local Web Workers; it is not sent to model or runtime hosts.

| Component | Version / source | License | Use and notes |
|---|---|---|---|
| `@mintplex-labs/piper-tts-web` | 1.0.5 | MIT | JavaScript Piper inference wrapper. |
| ONNX Runtime Web (`onnxruntime-web`) | 1.30.0 | MIT | Browser inference runtime; the build self-hosts its ESM loader and WASM files from this exact npm version, including the WebGPU JSEP assets. |
| `@diffusionstudio/piper-wasm` | 1.0.0 | MIT declared by package | Browser phonemizer WASM package. Its README says the build includes Piper phonemization and eSpeak NG. |
| Piper phonemize | Upstream `rhasspy/piper-phonemize` | MIT | Source license is MIT. |
| eSpeak NG | Upstream `rhasspy/espeak-ng` | GPL-3.0-or-later | The software license is GPL-3.0-or-later. The WASM package's published build instructions use an unpinned upstream clone, so its exact embedded source revision is not disclosed. The project records this limitation rather than claiming a reproducible build. |
| `@breezystack/lamejs` | 1.2.7 | LGPL-3.0 | Pure JavaScript MP3 encoder, kept as a separate module. This fork includes the missing MPEG mode import present in the original `lamejs@1.2.1`. Preserve the LGPL notice and make the exact source available when distributing the app. |
| `fflate` | 0.8.2 | MIT | Streaming ZIP muxer for per-chapter MP3 exports. |
| `use-strict` | 1.0.1 | MIT | Transitive helper dependency of the LAME encoder. |

GPL-3.0-or-later components are compatible with this AGPL-3.0-or-later project under AGPL-3.0 section 13, subject to preserving all notices and meeting the applicable source-code and corresponding-source obligations when distributing the combined work. eSpeak NG also includes data with separate notices (`COPYING.APACHE`, `COPYING.BSD2`, and `COPYING.UCD` upstream); check these against the exact runtime artifact before redistributing it. Runtime files are fetched from the pinned package version rather than checked into this repository.

## Offered Piper voice model

The two English (US) models below are eligible and are fetched from the immutable `rhasspy/piper-voices`
revision `375a0fe641dea077c2a47b4e9a056d6da521eed3`.

| Voice/model | Repository metadata license | Training data and model-card statement | Size |
|---|---|---|---:|
| `en_US-libritts-high` (speaker `p3922`, index 0) | MIT (`rhasspy/piper-voices` repository metadata at the pinned revision) | Model card says trained from scratch on LibriTTS `train-clean-360`; dataset license is CC BY 4.0. | 136,673,811-byte ONNX model + 20,163-byte config |
| `en_US-libritts_r-medium` (voice labelled Fast) | MIT (same pinned repository metadata) | Its model card identifies LibriTTS-R from OpenSLR 141, licensed CC BY 4.0; medium-quality model fine-tuned from English lessac medium. | 78,580,914-byte ONNX model + 20,123-byte config |

The model-card and repository metadata are distinct: model cards identify dataset terms, while the repository
revision declares MIT. This distinction is retained in the UI/docs and does not imply that the recorded speaker
or dataset is owned by this project. Other candidate voices with non-commercial or unclear terms are not offered.

Sources reviewed:

- [Piper Web package metadata](https://www.npmjs.com/package/@mintplex-labs/piper-tts-web)
- [ONNX Runtime Web license](https://github.com/microsoft/onnxruntime/blob/main/LICENSE)
- [Piper WASM package metadata and build notes](https://github.com/diffusion-studio/piper-wasm)
- [Piper phonemize license](https://github.com/rhasspy/piper-phonemize/blob/master/LICENSE.md)
- [eSpeak NG license and notices](https://github.com/rhasspy/espeak-ng)
- [Pinned LibriTTS voice model card](https://huggingface.co/rhasspy/piper-voices/blob/375a0fe641dea077c2a47b4e9a056d6da521eed3/en/en_US/libritts/high/MODEL_CARD)
- [Pinned LibriTTS-R medium voice model card](https://huggingface.co/rhasspy/piper-voices/blob/375a0fe641dea077c2a47b4e9a056d6da521eed3/en/en_US/libritts_r/medium/MODEL_CARD)
- [Pinned Piper voice repository metadata](https://huggingface.co/api/models/rhasspy/piper-voices/revision/375a0fe641dea077c2a47b4e9a056d6da521eed3)

## Development and test tooling added for audiobook export work

These packages are development-only and are not included in the production application bundle:

| Package | Version | Declared license | Use |
|---|---:|---|---|
| ESLint (`eslint`, `@eslint/js`) | 9.39.5 | MIT | Linting |
| `typescript-eslint` | 8.71.0 | MIT | TypeScript lint rules |
| `eslint-plugin-react-hooks` | 7.1.1 | MIT | React Hooks lint rules |
| `eslint-plugin-jsx-a11y` | 6.10.2 | MIT | JSX accessibility lint rules |
| Prettier | 3.9.9 | MIT | Formatting |
| `@playwright/test` | 1.63.0 | Apache-2.0 | Browser tests |
| `@axe-core/playwright` | 4.13.0 | MPL-2.0 | Automated accessibility tests |
| `@types/node` | 26.6.4 | MIT | Node.js type definitions for test configuration |

These permissive/open-source development tools do not add a runtime service or paid dependency. Review package notices for the exact versions in `package-lock.json` when redistributing tooling or CI environments. Browser binaries used by Playwright are test-only and are not shipped in the application.
