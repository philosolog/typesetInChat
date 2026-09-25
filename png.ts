/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 philosolog
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Round-trips the Typst/LaTeX source through the PNG itself (an iTXt chunk), so an
// image can be re-opened in the editor even after the local cache is gone.

const KEYWORD = "typesetinchat";
const SIGNATURE_LENGTH = 8;

export interface EmbeddedSource {
    v: 1;
    mode: "typst" | "latex";
    source: string;
}

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(bytes: Uint8Array) {
    let c = 0xffffffff;
    for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

export function embedSource(png: Uint8Array, data: EmbeddedSource): Uint8Array {
    const enc = new TextEncoder();
    const body = enc.encode(JSON.stringify(data));
    const keyword = enc.encode(KEYWORD);
    // keyword \0 compressionFlag compressionMethod languageTag \0 translatedKeyword \0 text
    const payload = new Uint8Array(keyword.length + 5 + body.length);
    payload.set(keyword, 0);
    payload.set(body, keyword.length + 5);

    const chunk = new Uint8Array(12 + payload.length);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, payload.length);
    chunk.set(enc.encode("iTXt"), 4);
    chunk.set(payload, 8);
    view.setUint32(8 + payload.length, crc32(chunk.subarray(4, 8 + payload.length)));

    // IEND is always the last 12 bytes
    const iend = png.length - 12;
    const out = new Uint8Array(png.length + chunk.length);
    out.set(png.subarray(0, iend), 0);
    out.set(chunk, iend);
    out.set(png.subarray(iend), iend + chunk.length);
    return out;
}

export function extractSource(png: Uint8Array): EmbeddedSource | null {
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    const dec = new TextDecoder();
    let pos = SIGNATURE_LENGTH;

    while (pos + 12 <= png.length) {
        const length = view.getUint32(pos);
        const type = dec.decode(png.subarray(pos + 4, pos + 8));
        if (type === "iTXt") {
            const data = png.subarray(pos + 8, pos + 8 + length);
            const nul = data.indexOf(0);
            if (dec.decode(data.subarray(0, nul)) === KEYWORD) {
                try {
                    const parsed = JSON.parse(dec.decode(data.subarray(nul + 5)));
                    if (parsed?.v === 1 && typeof parsed.source === "string") return parsed;
                } catch { /* malformed */ }
            }
        }
        if (type === "IEND") break;
        pos += 12 + length;
    }
    return null;
}
