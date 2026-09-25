/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 philosolog
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile } from "child_process";
import { access, cp, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { homedir, tmpdir } from "os";
import { basename, join } from "path";

export interface RenderOptions {
    /** Explicit path to the typst binary. Empty means auto-detect. */
    typstPath: string;
    ppi: number;
    /** Page width in pt. 0 fits the page to its content. */
    pageWidth: number;
    background: "light" | "dark" | "transparent";
    /** Extra Typst placed before the user's source (e.g. #import of a preamble). */
    preamble: string;
    /** Optional local folder (e.g. a phiamble clone) exposed to the render as `preamble/`. */
    libraryPath?: string;
}

export type RenderResult =
    | { ok: true; png: Uint8Array; }
    | { ok: false; error: string; };

const RENDER_TIMEOUT_MS = 20_000;
const MAX_SOURCE_LENGTH = 50_000;

// Electron apps launched from Finder/Dock don't inherit the shell PATH, so check the usual spots.
function candidatePaths() {
    const exe = process.platform === "win32" ? "typst.exe" : "typst";
    return [
        "/opt/homebrew/bin/" + exe,
        "/usr/local/bin/" + exe,
        "/usr/bin/" + exe,
        join(homedir(), ".cargo", "bin", exe),
        join(homedir(), ".local", "bin", exe),
        join(homedir(), "AppData", "Local", "Microsoft", "WinGet", "Links", exe)
    ];
}

function run(file: string, args: string[], cwd?: string) {
    return new Promise<{ stdout: string; stderr: string; }>((resolve, reject) => {
        execFile(file, args, { cwd, timeout: RENDER_TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) reject(Object.assign(error, { stderr }));
            else resolve({ stdout, stderr });
        });
    });
}

async function resolveTypst(custom: string): Promise<string | null> {
    const candidates = custom ? [custom] : [...candidatePaths(), "typst"];
    for (const candidate of candidates) {
        try {
            if (candidate !== "typst") await access(candidate);
            await run(candidate, ["--version"]);
            return candidate;
        } catch { /* try next */ }
    }
    return null;
}

const COLORS = {
    light: { fill: "white", text: "black" },
    dark: { fill: "rgb(\"#313338\")", text: "rgb(\"#dbdee1\")" },
    transparent: { fill: "none", text: "black" }
} as const;

function wrap(source: string, o: RenderOptions) {
    const { fill, text } = COLORS[o.background] ?? COLORS.light;
    const width = o.pageWidth > 0 ? `${o.pageWidth}pt` : "auto";
    return `#set page(width: ${width}, height: auto, margin: 12pt, fill: ${fill})
#set text(size: 12pt, fill: ${text})
${o.preamble}
${source}
`;
}

export async function findTypst(_, typstPath: string): Promise<{ path: string; version: string; } | null> {
    const path = await resolveTypst(typstPath);
    if (!path) return null;
    const { stdout } = await run(path, ["--version"]);
    return { path, version: stdout.trim() };
}

export async function renderTypst(_, source: string, options: RenderOptions): Promise<RenderResult> {
    if (source.length > MAX_SOURCE_LENGTH) return { ok: false, error: "Source too long." };

    const typst = await resolveTypst(options.typstPath);
    if (!typst) return { ok: false, error: "Typst binary not found. Install Typst or set its path in the plugin settings." };

    const dir = await mkdtemp(join(tmpdir(), "vc-typeset-"));
    try {
        if (options.libraryPath) {
            // Optional phiamble checkout, importable as #import "preamble/lib.typ". Copied so --root still confines reads.
            await cp(options.libraryPath, join(dir, "preamble"), { recursive: true, filter: src => basename(src) !== ".git" });
        }
        await writeFile(join(dir, "in.typ"), wrap(source, options));
        // --root confines #read/#image/#include to the temp dir so a message can't read arbitrary files.
        await run(typst, [
            "compile", "in.typ", "out-{p}.png",
            "--format", "png",
            "--ppi", String(Math.min(Math.max(options.ppi, 72), 600)),
            "--root", dir
        ], dir);
        return { ok: true, png: new Uint8Array(await readFile(join(dir, "out-1.png"))) };
    } catch (e: any) {
        const message = String(e?.stderr || e?.message || e).trim();
        return { ok: false, error: message.slice(0, 1500) };
    } finally {
        rm(dir, { recursive: true, force: true }).catch(() => { });
    }
}

/**
 * Sends an image to a local Nougat API server (`nougat_api`, POST /predict/) and returns its markdown/LaTeX output.
 * Runs in the main process so renderer CSP doesn't block requests to localhost.
 */
export async function ocrWithNougat(_, endpoint: string, image: Uint8Array): Promise<{ ok: true; text: string; } | { ok: false; error: string; }> {
    try {
        const url = new URL(endpoint);
        if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
            return { ok: false, error: "Nougat endpoint must be on localhost." };
        }

        const form = new FormData();
        form.append("file", new Blob([image as BlobPart], { type: "image/png" }), "typeset.png");

        const res = await fetch(url, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
        if (!res.ok) return { ok: false, error: `Nougat server responded ${res.status}` };

        const raw = await res.text();
        let text = raw;
        try {
            const parsed = JSON.parse(raw);
            if (typeof parsed === "string") text = parsed;
        } catch { /* plain text */ }
        return { ok: true, text: text.trim() };
    } catch (e: any) {
        return { ok: false, error: String(e?.message ?? e) };
    }
}
