# Word Atlas · 词光

**See the word. Hear it. Make it yours.**

[Try this fork](https://mure.iepose.cn/) · [Dataset](data/) · [简体中文](README.md)

<img src="docs/assets/cover-v2.jpg" alt="Word Atlas" width="100%">

This fork of [designfuchen/word-atlas](https://github.com/designfuchen/word-atlas) adds public registration, a Node.js/SQLite account API, browser drafts and manual whole-progress saves. Guest use remains available. Original attribution and the MIT / CC BY 4.0 licenses are preserved.

## Accounts and manual saves

1. Register or sign in from **My**. Guest data is kept separately.
2. Answers, favorites, typing history and learning settings are written to a browser draft without per-interaction API calls.
3. Choose **Save to account** under **Account and sync** to upload the complete snapshot.
4. Sign in on another device, or explicitly load account progress, to access the saved version.

Failed saves retain the draft. Retries reuse the operation ID. A newer server revision causes a conflict instead of silently overwriting another device.
Edits made while a save is in flight remain local until the next manual save.
There is no periodic background upload or polling.

Version 2 JSON imports and exports remain supported. Imports update the local draft first and require a manual save.
Theme, autoplay and ambient audio preferences stay on the current device.
Clearing browser site data removes unsaved drafts; export a backup first.

Registration is open. There is no self-service password reset.
The administrator of this instance can be contacted at [mure@qq.com](mailto:mure@qq.com).

## Learning features

- Illustrated word cards, bilingual definitions, two examples, collocations and usage notes.
- UK/US pronunciation and example recordings.
- Meaning recognition, picture cloze, listening recognition and spelling.
- FSRS spaced repetition, configurable retention and first-attempt accuracy.
- A vocabulary galaxy with WebGL2 and a fallback for unsupported devices.
- Independent word, sentence-copying and dictation practice.
- Cached entries and media for offline use after loading.

Recent fixes include HTTP-compatible operation IDs, removal of the persistent sync overlay, frosted answer feedback panels and a clickable dictation replay button.

<img src="docs/assets/atlas-desktop.jpg" alt="Vocabulary atlas" width="100%">

Original screenshots and the [introduction film](docs/assets/launch.mp4) illustrate the upstream application; the account panel and save workflow in this fork differ.

## Quick start

Requires **Node.js 22.13+** and npm. The account API uses built-in node:sqlite and cannot run on Node.js 20.
The repository contains the original image and audio collection, so the initial download may take time.

```bash
git clone --depth 1 https://github.com/mureliauw-source/word-atlas.git
cd word-atlas
npm ci
```

Run the following commands in separate terminals:

```bash
npm run api   # Account API at 127.0.0.1:3001
npm run dev   # Vite frontend at 127.0.0.1:5188
```

Open http://127.0.0.1:5188. Vite proxies /api/ to the API.
Both servers default to loopback. Configure the bind address and allowed origins for LAN access.
The local database defaults to .data/word-atlas.sqlite and is excluded from Git.

```bash
npm test
npm run test:server
npm run check:server
npm run check:atlas
npm run build
npm run build:server
```

## NAS / Docker deployment

```bash
npm run build
npm run build:server
cp deploy/.env.example deploy/.env
# Set ALLOWED_ORIGINS to the exact browser origins.
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d
```

The example serves port 18088 and persists SQLite files in deploy/data/.
See the [deployment guide](docs/deployment.md) for configuration, tunnel origin handling and code rollback.
The frontend and bundled API have been tested; the reusable Compose example still needs validation on the deployment host.

Static hosting alone supports guest use. Registration, login and account saves require the matching Node.js API under the same origin at /api/.

## Open dataset

| Resource                                                    | Contents                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------ |
| [JSON](data/word-atlas.json) and [CSV](data/word-atlas.csv) | 7,298 entries, CEFR A1–C2, 19 topics                         |
| Examples                                                    | 14,596 everyday and IELTS examples with Chinese translations |
| [Images](public/atlas/img/)                                 | 7,298 illustrations plus thumbnails                          |
| [Recordings](public/atlas/audio/)                           | 22,905 word and example recordings                           |

[Dataset schema](docs/dataset.md) · [Generation pipeline](docs/pipeline.md) · [Learning model](docs/learning-model.md)

Text and illustrations were generated for the original project using AI; speech was synthesized with ElevenLabs.
Automated checks do not replace manual review. Definitions, examples, images or pronunciation may contain errors.
This is not an official IELTS list and does not promise score improvements.

## Contributing and licenses

Report problems in [this fork's issues](https://github.com/mureliauw-source/word-atlas/issues).
Include the word ID, reproduction steps and expected result.
See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

Application code is [MIT](LICENSE). Vocabulary text, illustrations and word recordings are [CC BY 4.0](CONTENT_LICENSE.md), with credit to“Word Atlas contributors（词光）”.
Dependencies and fonts retain their respective licenses.

Original project by [@designfuchen](https://github.com/designfuchen); original author updates on [X · @yangleiocx3](https://x.com/yangleiocx3).
Account, manual-save and self-hosting changes are maintained by [@mureliauw-source](https://github.com/mureliauw-source).
