/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 philosolog
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "@plugins/typesetInChat/style.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { addMessagePreSendListener, MessageSendListener, removeMessagePreSendListener } from "@api/MessageEvents";
import { isTypesetMessage, loadCache, Mode, sendTypeset } from "@plugins/typesetInChat/core";
import { settings } from "@plugins/typesetInChat/settings";
import { ModeSwitch, openEditor, PreviewImage, usePreview } from "@plugins/typesetInChat/ui";
import { Devs } from "@utils/constants";
import definePlugin, { IconComponent, PluginNative } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { AuthenticationStore, ChannelStore, ComponentDispatch, DraftStore, DraftType, Menu, React, ReactDOM, showToast, useEffect, useLayoutEffect, useState, useStateFromStores } from "@webpack/common";

const Native = VencordNative.pluginHelpers.TypesetInChat as PluginNative<typeof import("./native")>;

// ---- toggle state, shared between the chat bar button and the send hook ----

const state = { enabled: false, mode: null as Mode | null };
const subscribers = new Set<() => void>();
const currentMode = () => state.mode ?? (settings.store.defaultMode as Mode);

function update(patch: Partial<typeof state>) {
    Object.assign(state, patch);
    subscribers.forEach(fn => fn());
}

function useToggleState() {
    const [, force] = useState(0);
    useEffect(() => {
        const fn = () => force(n => n + 1);
        subscribers.add(fn);
        return () => void subscribers.delete(fn);
    }, []);
    return { enabled: state.enabled, mode: currentMode() };
}

// ---- UI ----

const TypesetIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg width={width} height={height} viewBox="0 0 24 24" className={className}>
        <path fill="currentColor" d="M5 4h14v4h-2V6h-4v12h2.5v2h-9v-2H11V6H7v2H5V4Z" />
    </svg>
);

function PreviewPanel({ channelId, mode }: { channelId: string; mode: Mode; }) {
    const draft = useStateFromStores([DraftStore], () => DraftStore.getDraft(channelId, DraftType.ChannelMessage) ?? "");
    const preview = usePreview(draft, mode);
    const [pos, setPos] = useState({ bottom: 80, left: 16 });

    useLayoutEffect(() => {
        const box = document.querySelector<HTMLElement>("form [class*=\"channelTextArea\"]");
        if (!box) return;
        const rect = box.getBoundingClientRect();
        setPos({ bottom: window.innerHeight - rect.top + 8, left: rect.left });
    }, [draft]);

    return ReactDOM.createPortal(
        <div className="vc-typeset-panel" style={pos}>
            <div className="vc-typeset-header">
                <span>Typeset preview. Sending posts this image instead of text.</span>
                <ModeSwitch mode={mode} onChange={m => update({ mode: m })} />
            </div>
            {draft.trim()
                ? <PreviewImage preview={preview} />
                : <span className="vc-typeset-header">Start typing in the message box…</span>}
        </div>,
        document.body
    );
}

const ToggleButton: ChatBarButtonFactory = ({ channel, isMainChat }) => {
    const { enabled, mode } = useToggleState();
    if (!isMainChat) return null;

    return (
        <>
            <ChatBarButton
                tooltip={enabled ? `Typesetting on (${mode === "typst" ? "Typst" : "LaTeX"}) — click to disable` : "Send as typeset image"}
                onClick={() => update({ enabled: !enabled })}
            >
                <TypesetIcon height={20} width={20} className={enabled ? "vc-typeset-on" : undefined} />
            </ChatBarButton>
            {enabled && <PreviewPanel channelId={channel.id} mode={mode} />}
        </>
    );
};

// ---- send ----

const onPreSend: MessageSendListener = (channelId, msg, _options, props) => {
    if (!state.enabled || !msg.content.trim() || props.hasAttachments || props.hasStickers) return;

    const source = msg.content;
    sendTypeset(channelId, { v: 1, mode: currentMode(), source }).catch(e => {
        showToast(`Typeset failed: ${String(e?.message ?? e).slice(0, 200)}`, "failure");
    });

    // Cancelling keeps the text in the box; clear it since the image was sent instead.
    try { ComponentDispatch.dispatchToLastSubscribed("CLEAR_TEXT"); } catch { /* best effort */ }
    return { cancel: true };
};

// ---- message actions ----

function canEdit(message: Message) {
    return isTypesetMessage(message) && message.author.id === AuthenticationStore.getId();
}

const messageCtxPatch: NavContextMenuPatchCallback = (children, { message }: { message: Message; }) => {
    if (!canEdit(message)) return;

    children.push(
        <Menu.MenuItem
            id="vc-typeset-edit"
            key="vc-typeset-edit"
            label="Edit Typeset Image"
            action={() => openEditor(message, currentMode())}
        />
    );
};

export default definePlugin({
    name: "TypesetInChat",
    description: "Preview and send messages as Typst or LaTeX renders (via the Typst CLI), then re-edit sent images later",
    authors: [Devs.philosolog],
    tags: ["Chat", "Utility"],
    settings,

    contextMenus: { message: messageCtxPatch },

    chatBarButton: { icon: TypesetIcon, render: ToggleButton },

    messagePopoverButton: {
        icon: TypesetIcon,
        render(message) {
            if (!canEdit(message)) return null;
            return {
                label: "Edit Typeset Image",
                icon: TypesetIcon,
                message,
                channel: ChannelStore.getChannel(message.channel_id),
                onClick: () => openEditor(message, currentMode())
            };
        }
    },

    async start() {
        await loadCache();
        addMessagePreSendListener(onPreSend);

        const found = await Native.findTypst(settings.store.typstPath);
        if (!found) showToast("TypesetInChat: Typst binary not found. Install it or set the path in plugin settings.", "failure");
    },

    stop() {
        removeMessagePreSendListener(onPreSend);
        update({ enabled: false });
    }
});
