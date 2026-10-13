/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 philosolog
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { editTypeset, Mode, recoverSource, render } from "@plugins/typesetInChat/core";
import { openModal } from "@utils/modal";
import { Message, RenderModalProps } from "@vencord/discord-types";
import { Modal, React, showToast, useEffect, useState } from "@webpack/common";

const PREVIEW_DEBOUNCE_MS = 400;

export interface PreviewState {
    url: string | null;
    error: string | null;
    loading: boolean;
}

export function usePreview(source: string, mode: Mode): PreviewState {
    const [state, setState] = useState<PreviewState>({ url: null, error: null, loading: false });

    useEffect(() => {
        if (!source.trim()) {
            setState({ url: null, error: null, loading: false });
            return;
        }

        let cancelled = false;
        let objectUrl: string | null = null;
        setState(s => ({ ...s, loading: true }));

        const timer = setTimeout(async () => {
            const result = await render(source, mode).catch(e => ({ ok: false as const, error: String(e?.message ?? e) }));
            if (cancelled) return;
            if (result.ok) {
                objectUrl = URL.createObjectURL(new Blob([result.png as BlobPart], { type: "image/png" }));
                setState({ url: objectUrl, error: null, loading: false });
            } else {
                // keep the last good image visible while the source is mid-edit
                setState(s => ({ url: s.url, error: result.error, loading: false }));
            }
        }, PREVIEW_DEBOUNCE_MS);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [source, mode]);

    // revoke the previous object URL once replaced or unmounted
    useEffect(() => () => { if (state.url) URL.revokeObjectURL(state.url); }, [state.url]);

    return state;
}

export function ModeSwitch({ mode, onChange }: { mode: Mode; onChange(mode: Mode): void; }) {
    return (
        <div className="vc-typeset-modes">
            {(["typst", "latex"] as const).map(m => (
                <button key={m} type="button" data-active={m === mode} onClick={() => onChange(m)}>
                    {m === "typst" ? "Typst" : "LaTeX"}
                </button>
            ))}
        </div>
    );
}

export function PreviewImage({ preview }: { preview: PreviewState; }) {
    return (
        <>
            {preview.url && (
                <div className="vc-typeset-image" style={{ opacity: preview.loading ? 0.6 : 1 }}>
                    <img src={preview.url} alt="Typeset preview" />
                </div>
            )}
            {preview.error && <pre className="vc-typeset-error">{preview.error}</pre>}
        </>
    );
}

function EditorModal({ modalProps, message, initialSource, initialMode }: {
    modalProps: RenderModalProps;
    message: Message;
    initialSource: string;
    initialMode: Mode;
}) {
    const [source, setSource] = useState(initialSource);
    const [mode, setMode] = useState<Mode>(initialMode);
    const [saving, setSaving] = useState(false);
    const preview = usePreview(source, mode);

    async function save() {
        setSaving(true);
        try {
            await editTypeset(message, { v: 1, mode, source });
            showToast("Typeset image updated", "success");
            modalProps.onClose();
        } catch (e: any) {
            showToast(`Failed to update: ${String(e?.message ?? e).slice(0, 200)}`, "failure");
            setSaving(false);
        }
    }

    return (
        <Modal
            {...modalProps}
            size="lg"
            title="Edit typeset image"
            actions={[
                { text: "Save", variant: "primary", onClick: save, loading: saving, disabled: saving || !source.trim() || !!preview.error },
                { text: "Cancel", variant: "secondary", onClick: modalProps.onClose }
            ]}
        >
            <div className="vc-typeset-editor">
                <ModeSwitch mode={mode} onChange={setMode} />
                <textarea
                    value={source}
                    spellCheck={false}
                    autoFocus
                    onChange={e => setSource(e.currentTarget.value)}
                />
                <PreviewImage preview={preview} />
            </div>
        </Modal>
    );
}

export async function openEditor(message: Message, fallbackMode: Mode) {
    let entry;
    try {
        entry = await recoverSource(message);
    } catch (e: any) {
        showToast(`Could not recover source: ${String(e?.message ?? e).slice(0, 200)}`, "failure");
        return;
    }

    if (!entry) {
        showToast("No source found for this image. Set a Nougat endpoint in the plugin settings to rebuild it.", "failure");
        return;
    }

    openModal(props => (
        <ErrorBoundary>
            <EditorModal modalProps={props} message={message} initialSource={entry.source} initialMode={entry.mode ?? fallbackMode} />
        </ErrorBoundary>
    ));
}
