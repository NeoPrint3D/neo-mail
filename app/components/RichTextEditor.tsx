// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified for NeoMail; see NOTICE and MODIFICATIONS.md.

import { Tooltip } from "@cloudflare/kumo";
import Button from "~/components/Button";
import {
	ArrowClockwiseIcon,
	ArrowCounterClockwiseIcon,
	LinkBreakIcon,
	LinkSimpleIcon,
	ListBulletsIcon,
	ListNumbersIcon,
	MinusIcon,
	QuotesIcon,
	TextBIcon,
	TextItalicIcon,
	TextStrikethroughIcon,
	TextUnderlineIcon,
} from "@phosphor-icons/react";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TiptapImage from "@tiptap/extension-image";
import LinkExtension from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useId, useRef, useState } from "react";
import AppDialog from "./AppDialog";

interface RichTextEditorProps {
	value: string;
	onChange: (value: string) => void;
}

export default function RichTextEditor({
	value,
	onChange,
}: RichTextEditorProps) {
	const linkId = useId();
	const linkInput = useRef<HTMLInputElement>(null);
	const [link, setLink] = useState<{ href: string; from: number; to: number; editing: boolean } | null>(null);
	const [linkError, setLinkError] = useState("");
	const editor = useEditor({
		extensions: [
			StarterKit.configure({ link: false, underline: false }),
			Underline,
			TextAlign.configure({ types: ["heading", "paragraph"] }),
			LinkExtension.configure({ openOnClick: false }),
			TiptapImage,
			TextStyle,
			Color,
			Highlight.configure({ multicolor: true }),
		],
		content: value,
		editorProps: {
			attributes: {
				class:
					"prose prose-sm max-w-none focus:outline-none min-h-[180px] p-3 text-sm [&_blockquote]:border-l-2 [&_blockquote]:border-kumo-line [&_blockquote]:pl-3 [&_blockquote]:text-kumo-subtle [&_blockquote]:bg-kumo-tint [&_blockquote]:py-1 [&_blockquote]:my-2 [&_blockquote]:text-xs [&_blockquote]:rounded-r-sm",
			},
		},
		onUpdate: ({ editor }) => {
			onChange(editor.getHTML());
		},
	});

	useEffect(() => {
		if (editor && !editor.isDestroyed && value !== editor.getHTML()) {
			// A loaded draft or quote is not a user edit. Don't steal focus or
			// open the iPhone keyboard until the user taps the editor.
			editor.chain().setContent(value, { emitUpdate: false }).setTextSelection(1).run();
		}
	}, [value, editor]);

	if (!editor) return null;

	function openLinkDialog() {
		if (!editor) return;
		const href = editor.getAttributes("link").href || "";
		const { from, to } = editor.state.selection;
		setLinkError(""); setLink({ href, from, to, editing: !!href });
	}

	function saveLink() {
		if (!editor || !link) return;
		const href = link.href.trim();
		let url: URL;
		try { url = new URL(href); } catch { setLinkError("Enter a full URL, such as https://example.com."); return; }
		if (!["https:", "http:", "mailto:", "tel:"].includes(url.protocol) || /\s/.test(href)) {
			setLinkError("Use a valid HTTPS, HTTP, email, or phone link."); return;
		}
		const chain = editor.chain().setTextSelection({ from: link.from, to: link.to }).extendMarkRange("link");
		if (!link.editing && link.from === link.to) {
			chain.insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }).unsetMark("link").run();
		} else {
			chain.setLink({ href }).run();
		}
		setLink(null);
		requestAnimationFrame(() => { if (!editor.isDestroyed) editor.commands.focus(); });
	}

	return (
		<div className="rounded-lg border border-kumo-line overflow-hidden flex flex-col h-full">
			{/* Toolbar */}
			<div className="editor-toolbar flex flex-wrap items-center gap-0.5 bg-kumo-recessed px-2 py-1.5 border-b border-kumo-line shrink-0">
				{/* Text formatting */}
				<Tooltip content="Bold" side="bottom" asChild>
					<Button
						variant={editor.isActive("bold") ? "secondary" : "ghost"}
						shape="square"
						size="sm"
						icon={<TextBIcon size={16} />}
						onClick={() => editor.chain().focus().toggleBold().run()}
						aria-label="Bold"
					/>
				</Tooltip>
				<Tooltip content="Italic" side="bottom" asChild>
					<Button
						variant={editor.isActive("italic") ? "secondary" : "ghost"}
						shape="square"
						size="sm"
						icon={<TextItalicIcon size={16} />}
						onClick={() => editor.chain().focus().toggleItalic().run()}
						aria-label="Italic"
					/>
				</Tooltip>
				<Tooltip content="Underline" side="bottom" asChild>
					<Button
						variant={editor.isActive("underline") ? "secondary" : "ghost"}
						shape="square"
						size="sm"
						icon={<TextUnderlineIcon size={16} />}
						onClick={() => editor.chain().focus().toggleUnderline().run()}
						aria-label="Underline"
					/>
				</Tooltip>
				<Tooltip content="Strikethrough" side="bottom" asChild>
					<Button
						variant={editor.isActive("strike") ? "secondary" : "ghost"}
						shape="square"
						size="sm"
						icon={<TextStrikethroughIcon size={16} />}
						onClick={() => editor.chain().focus().toggleStrike().run()}
						aria-label="Strikethrough"
					/>
				</Tooltip>

				<div className="mx-1 h-5 w-px bg-kumo-fill" />

				{/* Lists */}
				<Tooltip content="Bullet list" side="bottom" asChild>
					<Button
						variant={editor.isActive("bulletList") ? "secondary" : "ghost"}
						shape="square"
						size="sm"
						icon={<ListBulletsIcon size={16} />}
						onClick={() => editor.chain().focus().toggleBulletList().run()}
						aria-label="Bullet list"
					/>
				</Tooltip>
				<Tooltip content="Numbered list" side="bottom" asChild>
					<Button
						variant={editor.isActive("orderedList") ? "secondary" : "ghost"}
						shape="square"
						size="sm"
						icon={<ListNumbersIcon size={16} />}
						onClick={() => editor.chain().focus().toggleOrderedList().run()}
						aria-label="Numbered list"
					/>
				</Tooltip>

				<div className="mx-1 h-5 w-px bg-kumo-fill" />

				{/* Block formatting */}
				<Tooltip content="Blockquote" side="bottom" asChild>
					<Button
						variant={editor.isActive("blockquote") ? "secondary" : "ghost"}
						shape="square"
						size="sm"
						icon={<QuotesIcon size={16} />}
						onClick={() => editor.chain().focus().toggleBlockquote().run()}
						aria-label="Blockquote"
					/>
				</Tooltip>
				<Tooltip content="Link" side="bottom" asChild>
					<Button
						variant={editor.isActive("link") ? "secondary" : "ghost"}
						shape="square"
						size="sm"
						icon={<LinkSimpleIcon size={16} />}
						onClick={openLinkDialog}
						aria-label="Link"
					/>
				</Tooltip>
				{editor.isActive("link") && (
					<Tooltip content="Remove link" side="bottom" asChild>
						<Button
							variant="ghost"
							shape="square"
							size="sm"
							icon={<LinkBreakIcon size={16} />}
							onClick={() => editor.chain().focus().unsetLink().run()}
							aria-label="Remove link"
						/>
					</Tooltip>
				)}
				<Tooltip content="Horizontal rule" side="bottom" asChild>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={<MinusIcon size={16} />}
						onClick={() => editor.chain().focus().setHorizontalRule().run()}
						aria-label="Horizontal rule"
					/>
				</Tooltip>

				<div className="mx-1 h-5 w-px bg-kumo-fill" />

				{/* Undo/Redo */}
				<Tooltip content="Undo" side="bottom" asChild>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={<ArrowCounterClockwiseIcon size={16} />}
						onClick={() => editor.chain().focus().undo().run()}
						disabled={!editor.can().undo()}
						aria-label="Undo"
					/>
				</Tooltip>
				<Tooltip content="Redo" side="bottom" asChild>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={<ArrowClockwiseIcon size={16} />}
						onClick={() => editor.chain().focus().redo().run()}
						disabled={!editor.can().redo()}
						aria-label="Redo"
					/>
				</Tooltip>
			</div>

			{/* Editor content */}
			<div className="flex-1 overflow-y-auto">
				<EditorContent editor={editor} />
			</div>
			{link && <AppDialog title={link.editing ? "Edit link" : "Add a link"} description="Enter the address this link should open."
				icon={<LinkSimpleIcon size={24} weight="duotone" />} initialFocus={linkInput} onClose={() => setLink(null)} onSubmit={saveLink}
				actions={<button type="submit" className="mail-button primary" disabled={!link.href.trim()}>{link.editing ? "Save link" : "Insert link"}</button>}>
				<div className="choice-field"><label htmlFor={linkId} className="choice-label">Link address</label>
					<input ref={linkInput} id={linkId} className="field-input" value={link.href} inputMode="url" autoCapitalize="none" spellCheck={false}
						placeholder="https://example.com" onChange={(event) => { setLink({ ...link, href: event.target.value }); setLinkError(""); }} />
				</div>
				{linkError && <p className="form-error" role="alert">{linkError}</p>}
			</AppDialog>}
		</div>
	);
}
