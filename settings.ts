/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 philosolog
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

// Same as src/preamble.typ in philosolog/Margaid.
const MARGAID_PREAMBLE = `#set page(height: auto, width: auto, margin: 0.5cm, fill: rgb("#36393f"))
#set text(fill: white, size: 24pt)`;

export const settings =definePluginSettings({
    defaultMode: {
        type: OptionType.SELECT,
        description: "Syntax used by the typesetting editor by default",
        options: [
            { label: "Typst", value: "typst", default: true },
            { label: "LaTeX (converted to Typst with Tylax)", value: "latex" }
        ]
    },
    typstPath: {
        type: OptionType.STRING,
        description: "Path to the typst binary. Leave empty to auto-detect (Homebrew, cargo, PATH)",
        default: ""
    },
    ppi: {
        type: OptionType.NUMBER,
        description: "Render resolution (pixels per inch, 72-600). Higher is sharper but larger",
        default: 200
    },
    pageWidth: {
        type: OptionType.NUMBER,
        description: "Page width in pt. 0 fits the image to its content (long lines will not wrap)",
        default: 420
    },
    background: {
        type: OptionType.SELECT,
        description: "Image background. Light works in every Discord theme",
        options: [
            { label: "Light (white)", value: "light", default: true },
            { label: "Dark (Discord dark)", value: "dark" },
            { label: "Transparent", value: "transparent" }
        ]
    },
    preamble: {
        type: OptionType.STRING,
        description: "Typst code placed before every render (e.g. #import, #set rules). Defaults to Margaid's preamble; clear it to use the background option above",
        default: MARGAID_PREAMBLE,
        multiline: true
    },
    libraryPath: {
        type: OptionType.STRING,
        description: "Optional path to a local phiamble checkout. Copied into each render as preamble/ so you can #import \"preamble/lib.typ\". Leave empty to disable",
        default: ""
    },
    embedSource: {
        type: OptionType.BOOLEAN,
        description: "Embed the source in the PNG file and alt text so images can be re-edited after the local cache is cleared",
        default: true
    },
    nougatEndpoint: {
        type: OptionType.STRING,
        description: "Optional local Nougat API URL (e.g. http://localhost:8503/predict/) used to rebuild source from images that carry no embedded source",
        default: ""
    }
});
