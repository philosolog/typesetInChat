# TypesetInChat

Vencord plugin (desktop only). Toggle a chat bar button to preview your message box as a Typst or LaTeX render, and send the render as an image instead of text.

- **Preview / send:** the chat bar button opens a live preview above the message box. With it on, sending uploads a PNG rendered by the local `typst` CLI.
- **Typst / LaTeX:** switch modes in the preview panel. LaTeX is converted to Typst with Tylax, then rendered.
- **Re-edit:** right-click (or use the hover button on) one of your typeset messages, then "Edit Typeset Image".
- **Source recovery**, in order: local cache (IndexedDB, keyed by message) → source embedded in the PNG (`iTXt` chunk) and alt text → optional local [Nougat](https://github.com/facebookresearch/nougat) API (`nougat_api`) whose LaTeX output opens in LaTeX mode.

## Requirements

- [Typst CLI](https://github.com/typst/typst) installed (auto-detected in Homebrew/cargo/PATH, or set the path in settings).
- The **TypesettingTools** plugin in the same build (LaTeX mode reuses its Tylax wasm).
- Nougat is optional: `uv tool install nougat-ocr`, run `nougat_api`, and set the endpoint (localhost only).

## Notes

Typst runs with `--root` set to a throwaway temp directory so message source can't read arbitrary local files.
