/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 philosolog
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { EmbeddedSource, embedSource, extractSource } from "@plugins/typesetInChat/png";
import { settings } from "@plugins/typesetInChat/settings";
import { convertLatexToTypst } from "@plugins/typesettingTools/converter";
import { PluginNative } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher, MessageActions, PendingReplyStore, RestAPI, SnowflakeUtils } from "@webpack/common";

// LaTeX mode reuses the Tylax wasm bundled by the TypesettingTools plugin (a separate submodule).

const Native = VencordNative.pluginHelpers.TypesetInChat as PluginNative<typeof import("./native")>;
const { uniqueId } = findByPropsLazy("uniqueId");

export type Mode = "typst" | "latex";
export type RenderOutcome = { ok: true; png: Uint8Array; } | { ok: false; error: string; };

export interface CacheEntry extends EmbeddedSource {
    savedAt: number;
}

// ---- cache (survives restarts, unlike MessageLogger's in-memory history) ----

const CACHE_KEY = "TypesetInChat_cache";
const CACHE_LIMIT = 1000;
let cache = new Map<string, CacheEntry>();

export async function loadCache() {
    const stored = await DataStore.get<[string, CacheEntry][]>(CACHE_KEY);
    cache = new Map(stored ?? []);
}

function cacheKey(channelId: string, messageId: string) {
    return `${channelId}:${messageId}`;
}

export function cacheSource(channelId: string, messageId: string, entry: EmbeddedSource) {
    cache.set(cacheKey(channelId, messageId), { ...entry, savedAt: Date.now() });
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    return DataStore.set(CACHE_KEY, [...cache]);
}

export function clearCache() {
    cache.clear();
    return DataStore.del(CACHE_KEY);
}

// ---- rendering ----

async function toTypst(source: string, mode: Mode): Promise<{ ok: true; typst: string; } | { ok: false; error: string; }> {
    if (mode === "typst") return { ok: true, typst: source };
    const res = await convertLatexToTypst(source, { pretty: false, full_document: false });
    return res.success ? { ok: true, typst: res.output } : { ok: false, error: `LaTeX conversion failed: ${res.error}` };
}

export async function render(source: string, mode: Mode): Promise<RenderOutcome> {
    const typst = await toTypst(source, mode);
    if (!typst.ok) return typst;

    const { typstPath, ppi, pageWidth, background, preamble, libraryPath } = settings.store;
    return Native.renderTypst(typst.typst, { typstPath, ppi, pageWidth, background: background as "light" | "dark" | "transparent", preamble, libraryPath: libraryPath.trim() || undefined });
}

export function buildPng(png: Uint8Array, entry: EmbeddedSource) {
    return settings.store.embedSource ? embedSource(png, entry) : png;
}

// ---- upload / send / edit ----

async function uploadPng(channelId: string, png: Uint8Array, filename: string) {
    const { body: { attachments } } = await RestAPI.post({
        url: `/channels/${channelId}/attachments`,
        body: { files: [{ filename, file_size: png.length, id: uniqueId(), is_clip: false }] }
    }) as { body: { attachments: { id: string, upload_url: string, upload_filename: string; }[]; }; };

    const [slot] = attachments;
    const res = await fetch(slot.upload_url, { method: "PUT", body: new Blob([png as BlobPart]) });
    if (!res.ok) throw new Error(`Upload failed (${res.status})`);

    return {
        id: slot.id,
        filename,
        uploaded_filename: slot.upload_filename
    };
}

function altText(entry: EmbeddedSource) {
    return settings.store.embedSource ? entry.source.slice(0, 1000) : undefined;
}

export async function sendTypeset(channelId: string, entry: EmbeddedSource) {
    const rendered = await render(entry.source, entry.mode);
    if (!rendered.ok) throw new Error(rendered.error);

    const png = buildPng(rendered.png, entry);
    const file = await uploadPng(channelId, png, "typeset.png");

    const reply = PendingReplyStore.getPendingReply(channelId);
    if (reply) FluxDispatcher.dispatch({ type: "DELETE_PENDING_REPLY", channelId });

    const res = await RestAPI.post({
        url: `/channels/${channelId}/messages`,
        body: {
            content: "",
            channel_id: channelId,
            nonce: SnowflakeUtils.fromTimestamp(Date.now()),
            sticker_ids: [],
            type: 0,
            attachments: [{ ...file, description: altText(entry) }],
            message_reference: reply ? MessageActions.getSendMessageOptionsForReply(reply)?.messageReference : null
        }
    });

    await cacheSource(channelId, res.body.id, entry);
}

/** Replaces the typeset image of an existing message with a new render. */
export async function editTypeset(message: Message, entry: EmbeddedSource) {
    const rendered = await render(entry.source, entry.mode);
    if (!rendered.ok) throw new Error(rendered.error);

    const file = await uploadPng(message.channel_id, buildPng(rendered.png, entry), "typeset.png");

    await RestAPI.patch({
        url: `/channels/${message.channel_id}/messages/${message.id}`,
        body: { attachments: [{ ...file, description: altText(entry) }] }
    });

    await cacheSource(message.channel_id, message.id, entry);
}

// ---- recovery: cache -> embedded PNG chunk -> Nougat ----

export function isTypesetMessage(message: Message) {
    return message.attachments?.length === 1
        && message.attachments[0].filename === "typeset.png"
        && !message.content;
}

export async function recoverSource(message: Message): Promise<EmbeddedSource | null> {
    const cached = cache.get(cacheKey(message.channel_id, message.id));
    if (cached) return cached;

    const attachment = message.attachments?.[0];
    if (!attachment) return null;

    const bytes = new Uint8Array(await (await fetch(attachment.url)).arrayBuffer());

    const embedded = extractSource(bytes);
    if (embedded) return embedded;

    const endpoint = settings.store.nougatEndpoint.trim();
    if (!endpoint) return null;

    const ocr = await Native.ocrWithNougat(endpoint, bytes);
    if (!ocr.ok) throw new Error(ocr.error);

    // Nougat emits Markdown with LaTeX math; hand it to the LaTeX editor mode (Tylax converts on render).
    return { v: 1, mode: "latex", source: ocr.text };
}
