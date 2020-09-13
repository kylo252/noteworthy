// electron imports
import { clipboard } from "electron";

// prosemirror imports
import { EditorView as ProseEditorView, EditorView } from "prosemirror-view";
import { Schema as ProseSchema, MarkType, Node as ProseNode, Mark, Slice } from "prosemirror-model";
import { baseKeymap, toggleMark } from "prosemirror-commands";
import { EditorState as ProseEditorState, Transaction, Plugin as ProsePlugin, EditorState } from "prosemirror-state";
import { history } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { gapCursor } from "prosemirror-gapcursor";

// project imports
import { IPossiblyUntitledFile } from "@common/fileio";
import { Editor } from "./editor";

// markdown
import { nwtSchema } from "@common/nwt/nwt-schema";
import { buildInputRules_markdown, buildKeymap_markdown } from "@common/pm-schema";

// views
import { mathInputRules } from "@common/inputrules";
import { openPrompt, TextField } from "@common/prompt/prompt";
import mathSelectPlugin from "@root/lib/prosemirror-math/src/plugins/math-select";
import { MainIpcHandlers } from "@main/MainIPC";
import { findWrapping } from "prosemirror-transform";
import { EmbedView } from "@common/nwt/nwt-embed";
import { mathPlugin } from "@root/lib/prosemirror-math/src/math-plugin";

////////////////////////////////////////////////////////////

// editor class
export class NwtEditor extends Editor<ProseEditorState> {

	_proseEditorView: ProseEditorView | null;
	_proseSchema: ProseSchema;
	_editorElt: HTMLElement;
	_keymap: ProsePlugin;
	_initialized:boolean;

	// == Constructor =================================== //

	constructor(file: IPossiblyUntitledFile | null, editorElt: HTMLElement, mainProxy: MainIpcHandlers) {
		super(file, editorElt, mainProxy);

		// no editor until initialized
		this._initialized = false;
		this._proseEditorView = null;
		this._proseSchema = nwtSchema;
		this._editorElt = editorElt;

		function markActive(state:EditorState, type:MarkType) {
			let { from, $from, to, empty } = state.selection
			if (empty) return type.isInSet(state.storedMarks || $from.marks())
			else return state.doc.rangeHasMark(from, to, type)
		}

		this._keymap = keymap({
			"Tab": (state, dispatch, view) => {
				if(dispatch){
					dispatch(state.tr.deleteSelection().insertText("\t"));
				}
				return true;
			},
			"Ctrl-s": (state, dispatch, view) => {
				this.saveCurrentFile(false);
				return true;
			},
			"Ctrl-Space": (state, dispatch, view) => {
				let { $from, $to } = state.selection;
				let nodeType = nwtSchema.nodes.embed_md;

				openPrompt({
					title: "Embed Document",
					fields: {
						fileName: new TextField({
							label: "File Name",
							required: true
						}),
					},
					callback(attrs: { [key: string]: any; } | undefined) {
						// insert new embed node at top level
						let tr = state.tr.insert($to.after(1), nodeType.createAndFill(attrs))
						if(dispatch){ dispatch(tr); }
						if(view){ view.focus(); }
					}
				})
				return true;
			},
			"Ctrl-k": (state, dispatch, view) => {
				// only insert link when highlighting text
				if(state.selection.empty){ return false; }

				console.log("link toggle");
				let markType = this._proseSchema.marks.link;
				if(markActive(state, markType)) {
					console.log("link active");
					if(dispatch){ toggleMark(markType)(state, dispatch) }
					return true
				}
				console.log("opening prompt");
				openPrompt({
					title: "Create a link",
					fields: {
						href: new TextField({
							label: "Link target",
							required: true
						}),
						title: new TextField({ label: "Title" })
					},
					callback(attrs: { [key: string]: any; } | undefined) {
						if(view){
							toggleMark(markType, attrs)(view.state, view.dispatch)
							view.focus()
						}
					}
				})
				return true;
			},
			"Ctrl-e": (state, dispatch, view) => {
				let { $from, $to } = state.selection;
				// selection must be entirely within a single node
				if(!$from.sameParent($to)){ return false; }
				
				console.log($from);
				console.log($from.node(), $from.parent)
				console.log("isText?", $from.node().isText, $from.node().isTextblock);
				// get selected node

				// marks
				console.log($from.marks());
				for(let mark of $from.marks()){
					if(mark.type.name == "link"){
						let new_href = prompt("change link:", mark.attrs.href);
						if(dispatch){
							dispatch(state.tr.setNodeMarkup($from.pos, undefined, {
								href: new_href,
								title: mark.attrs.title
							}));
						}
					}
				}

				return true;
			}
		})
	}

	// == Lifecycle ===================================== //

	init() {
		// only initialize once
		if(this._initialized){ return; }
		// create prosemirror config
		let config = {
			schema: this._proseSchema,
			plugins: [
				keymap(buildKeymap_markdown(this._proseSchema)),
				keymap(baseKeymap),
				this._keymap,
				buildInputRules_markdown(this._proseSchema),
				mathPlugin,
				mathInputRules,
				mathSelectPlugin,
				history(),
				gapCursor()
			]
		}
		// create prosemirror state (from file)
		let state:ProseEditorState;
		if(this._currentFile && this._currentFile.contents){
			state = this.parseContents(this._currentFile.contents);
		} else {
			state = ProseEditorState.create(config);
		}
		// create prosemirror instance
		this._proseEditorView = new ProseEditorView(this._editorElt, {
			state: state,
			nodeViews: {
				"embed_md": (node, view, getPos) => {
					return new EmbedView(node, view, getPos as (() => number), this._mainProxy);
				}
			},
			dispatchTransaction: (tr: Transaction): void => {
				// unsaved changes?
				if(tr.docChanged){ this.handleDocChanged(); }

				let proseView:EditorView = (this._proseEditorView as EditorView);

				console.log("selection :: ", tr.selection.from, tr.selection.to)

				// apply transaction
				proseView.updateState(proseView.state.apply(tr));
			},
			handleClick: (view: ProseEditorView<any>, pos: number, event: MouseEvent) => {
				let node = view.state.doc.nodeAt(pos);
				if(!node){ return false; }

				// ctrl-click
				let mark:Mark|null|undefined
				if(event.ctrlKey && node.isText){
					let markTypes = ["wikilink", "citation", "tag"];
					// wikilinks, tags, citations
					if (mark = node.marks.find((mark: Mark) => markTypes.includes(mark.type.name))){
						let tag = node.text;
						if (tag) { this._mainProxy.tag.requestTagOpen({tag, create:true}); }
					}
					// links
					else if(mark = nwtSchema.marks.link.isInSet(node.marks)){
						let url:string = mark.attrs.href;
						if (url) { this._mainProxy.shell.requestExternalLinkOpen(url); }
					}
				}
				return true;
			},
			handlePaste: (view:EditorView, event:ClipboardEvent, slice:Slice<any>) => {
				let file:File|undefined;

				/** @todo (6/22/20) make this work with the ClipboardEvent? */

				// for some reason, event.clipboardData.getData("img/png") etc.
				// do not return any data.  So we use the electron clipboard instead.
				if(clipboard.availableFormats("clipboard").find(str => str.startsWith("image"))){
					let dataUrl:string = clipboard.readImage("clipboard").toDataURL();
					
					let imgNode = nwtSchema.nodes.image.createAndFill({
						src: dataUrl
					});
					
					if(imgNode){
						let { $from } = view.state.selection;
						let tr = view.state.tr.deleteSelection().insert(
							$from.pos,
							imgNode
						)
						view.dispatch(tr);
						return true;
					}

				}
				
				return false;
			}
		});
		// initialized
		this._initialized = true;
	}

	destroy(): void {
		// destroy prosemirror instance
		this._proseEditorView?.destroy();
		this._proseEditorView = null;
		// de-initialize
		this._initialized = false;
	}
	// == Document Model ================================ //


	serializeContents(): string {
		if (!this._proseEditorView) { return ""; }
		return JSON.stringify(
			this._proseEditorView.state.toJSON(), undefined, "\t"
		);
	}

	parseContents(contents: string): ProseEditorState {
		let config = {
			schema: nwtSchema,
			plugins: [this._keymap]
		}
		return ProseEditorState.fromJSON(config, JSON.parse(contents))
	}

	setContents(contents: ProseEditorState): void {
		console.log("editor-markdown :: setContents", contents);
		if(!this._proseEditorView){
			console.warn("editor-markdown :: setContents :: no editor!");
			return;
		}

		this._proseEditorView.updateState(contents);
	}
}