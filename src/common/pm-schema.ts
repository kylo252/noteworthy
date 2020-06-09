import { Schema, NodeType } from "prosemirror-model";
import {
	inputRules, wrappingInputRule, textblockTypeInputRule,
	smartQuotes, emDash, ellipsis, undoInputRule
} from "prosemirror-inputrules"
import {
	wrapIn, setBlockType, chainCommands, toggleMark, exitCode,
	joinUp, joinDown, lift, selectParentNode
} from "prosemirror-commands"
import { wrapInList, splitListItem, liftListItem, sinkListItem } from "prosemirror-schema-list"
import { undo, redo } from "prosemirror-history"
import { Transaction, EditorState, Plugin } from "prosemirror-state";
import { ProseCommand } from "./types";

export const PlainSchema = new Schema({
	nodes : {
		doc: {
			content: "block+"
		}, 
		paragraph: {
			group: "block",
			content: "inline*",
			toDOM() { return ["p", 0] },
			parseDOM: [{ tag: "p" }]
		},
		text: {
			group: "inline"
		}
	}
});

export const FancySchema = new Schema({
	nodes: {
		text: {
			group: "inline"
		},
		star: {
			inline: true,
			group: "inline",
			toDOM() { return ["star", "*"] },
			parseDOM: [{ tag: "star" }]
		},
		paragraph: {
			group: "block",
			content: "inline*",
			toDOM() { return ["p", 0] },
			parseDOM: [{ tag: "p" }]
		},
		boring_paragraph: {
			group: "block",
			content: "text*",
			marks: "",
			toDOM() { return ["p", { class: "boring" }, 0] },
			parseDOM: [{ tag: "p.boring", priority: 60 }]
		},
		doc: {
			content: "block+"
		}
	},
	marks: {
		shouting: {
			toDOM() { return ["shouting", 0] },
			parseDOM: [{ tag: "shouting" }]
		},
		link: {
			attrs: { href: {} },
			toDOM(node) { return ["a", { href: node.attrs.href }, 0] },
			parseDOM: [{ tag: "a", getAttrs(dom) { return { href: (dom as HTMLAnchorElement).href } } }],
			inclusive: false
		}
	}
});

// MarkdownSchema
// (https://github.com/ProseMirror/prosemirror-markdown/blob/master/src/schema.js)
export const MarkdownSchema = new Schema({
	nodes: {
		doc: {
			content: "block+"
		},

		paragraph: {
			content: "inline*",
			group: "block",
			parseDOM: [{ tag: "p" }],
			toDOM() { return ["p", 0] }
		},

		blockquote: {
			content: "block+",
			group: "block",
			parseDOM: [{ tag: "blockquote" }],
			toDOM() { return ["blockquote", 0] }
		},

		horizontal_rule: {
			group: "block",
			parseDOM: [{ tag: "hr" }],
			toDOM() { return ["div", ["hr"]] }
		},

		heading: {
			attrs: { level: { default: 1 } },
			content: "(text | image)*",
			group: "block",
			defining: true,
			parseDOM: [{ tag: "h1", attrs: { level: 1 } },
			{ tag: "h2", attrs: { level: 2 } },
			{ tag: "h3", attrs: { level: 3 } },
			{ tag: "h4", attrs: { level: 4 } },
			{ tag: "h5", attrs: { level: 5 } },
			{ tag: "h6", attrs: { level: 6 } }],
			toDOM(node) { return ["h" + node.attrs.level, 0] }
		},

		code_block: {
			content: "text*",
			group: "block",
			code: true,
			defining: true,
			marks: "",
			attrs: { params: { default: "" } },
			parseDOM: [{
				tag: "pre", preserveWhitespace: "full", getAttrs: node => (
					{ params: (node as HTMLElement).getAttribute("data-params") || "" }
				)
			}],
			toDOM(node) {
				// TODO: change typings to avoid the difficult syntax below
				// this atrocity is due to ProseMirror typings disallowing "null" in attrs
				let attrs = {
					...((node.attrs.params) && { "data-params" : node.attrs.params })
				}
				return ["pre", attrs, ["code", 0]] 
			}
		},

		ordered_list: {
			content: "list_item+",
			group: "block",
			attrs: { order: { default: 1 }, tight: { default: false } },
			parseDOM: [{
				tag: "ol", getAttrs(dom) {
					return {
						order: (dom as HTMLElement).hasAttribute("start") ? +((dom as HTMLElement).getAttribute("start") as string) : 1,
						tight: (dom as HTMLElement).hasAttribute("data-tight")
					}
				}
			}],
			toDOM(node) {
				// TODO: change typings to avoid the difficult syntax below
				// this atrocity is due to ProseMirror typings disallowing "null" in attrs
				let attrs = {
					...((node.attrs.order != 1) && { "start" : node.attrs.order}),
					...((node.attrs.tight)      && { "data-tight" : "true" })	
				}
				
				return ["ol", attrs, 0]
			}
		},

		bullet_list: {
			content: "list_item+",
			group: "block",
			attrs: { tight: { default: false } },
			parseDOM: [{ tag: "ul", getAttrs: dom => ({ tight: (dom as HTMLElement).hasAttribute("data-tight") }) }],
			toDOM(node) { 
				return ["ul", node.attrs.tight ? { "data-tight": "true" } : undefined, 0] 
			}
		},

		list_item: {
			content: "paragraph block*",
			defining: true,
			parseDOM: [{ tag: "li" }],
			toDOM() { return ["li", 0] }
		},

		text: {
			group: "inline"
		},

		image: {
			inline: true,
			attrs: {
				src: {},
				alt: { default: null },
				title: { default: null }
			},
			group: "inline",
			draggable: true,
			parseDOM: [{
				tag: "img[src]", getAttrs(dom) {
					return {
						src: (dom as HTMLElement).getAttribute("src"),
						title: (dom as HTMLElement).getAttribute("title"),
						alt: (dom as HTMLElement).getAttribute("alt")
					}
				}
			}],
			toDOM(node) { return ["img", node.attrs] }
		},

		hard_break: {
			inline: true,
			group: "inline",
			selectable: false,
			parseDOM: [{ tag: "br" }],
			toDOM() { return ["br"] }
		}
	},

	marks: {
		em: {
			parseDOM: [{ tag: "i" }, { tag: "em" },
			{ style: "font-style", getAttrs: value => value == "italic" && null }],
			toDOM() { return ["em"] }
		},

		strong: {
			parseDOM: [{ tag: "b" }, { tag: "strong" },
			{ style: "font-weight", getAttrs: value => /^(bold(er)?|[5-9]\d{2,})$/.test(value as string) && null }],
			toDOM() { return ["strong"] }
		},

		link: {
			attrs: {
				href: {},
				title: { default: null }
			},
			inclusive: false,
			parseDOM: [{
				tag: "a[href]", getAttrs(dom) {
					return {
						href: (dom as HTMLElement).getAttribute("href"),
						title: (dom as HTMLElement).getAttribute("title")
					}
				}
			}],
			toDOM(node) { return ["a", node.attrs] }
		},

		code: {
			parseDOM: [{ tag: "code" }],
			toDOM() { return ["code"] }
		}
	}
})

// : (NodeType) → InputRule
// Given a blockquote node type, returns an input rule that turns `"> "`
// at the start of a textblock into a blockquote.
export function blockQuoteRule(nodeType:NodeType) {
	return wrappingInputRule(/^\s*>\s$/, nodeType)
}

// : (NodeType) → InputRule
// Given a list node type, returns an input rule that turns a number
// followed by a dot at the start of a textblock into an ordered list.
export function orderedListRule(nodeType:NodeType) {
	return wrappingInputRule(/^(\d+)\.\s$/, nodeType, match => ({ order: +match[1] }),
		(match, node) => node.childCount + node.attrs.order == +match[1])
}

// : (NodeType) → InputRule
// Given a list node type, returns an input rule that turns a bullet
// (dash, plush, or asterisk) at the start of a textblock into a
// bullet list.
export function bulletListRule(nodeType:NodeType) {
	return wrappingInputRule(/^\s*([-+*])\s$/, nodeType)
}

// : (NodeType) → InputRule
// Given a code block node type, returns an input rule that turns a
// textblock starting with three backticks into a code block.
export function codeBlockRule(nodeType: NodeType) {
	return textblockTypeInputRule(/^```$/, nodeType)
}

// : (NodeType, number) → InputRule
// Given a node type and a maximum level, creates an input rule that
// turns up to that number of `#` characters followed by a space at
// the start of a textblock into a heading whose level corresponds to
// the number of `#` signs.
export function headingRule(nodeType: NodeType, maxLevel:number) {
	return textblockTypeInputRule(new RegExp("^(#{1," + maxLevel + "})\\s$"),
		nodeType, match => ({ level: match[1].length }))
}

// : (Schema) → Plugin
// A set of input rules for creating the basic block quotes, lists,
// code blocks, and heading.
export function buildInputRules_markdown(schema:Schema) {
	let rules = smartQuotes.concat(ellipsis, emDash), type
	if (type = schema.nodes.blockquote) rules.push(blockQuoteRule(type))
	if (type = schema.nodes.ordered_list) rules.push(orderedListRule(type))
	if (type = schema.nodes.bullet_list) rules.push(bulletListRule(type))
	if (type = schema.nodes.code_block) rules.push(codeBlockRule(type))
	if (type = schema.nodes.heading) rules.push(headingRule(type, 6))
	return inputRules({ rules })
}

const mac = typeof navigator != "undefined" ? /Mac/.test(navigator.platform) : false

// :: (Schema, ?Object) → Object
// Inspect the given schema looking for marks and nodes from the
// basic schema, and if found, add key bindings related to them.
// This will add:
//
// * **Mod-b** for toggling [strong](#schema-basic.StrongMark)
// * **Mod-i** for toggling [emphasis](#schema-basic.EmMark)
// * **Mod-`** for toggling [code font](#schema-basic.CodeMark)
// * **Ctrl-Shift-0** for making the current textblock a paragraph
// * **Ctrl-Shift-1** to **Ctrl-Shift-Digit6** for making the current
//   textblock a heading of the corresponding level
// * **Ctrl-Shift-Backslash** to make the current textblock a code block
// * **Ctrl-Shift-8** to wrap the selection in an ordered list
// * **Ctrl-Shift-9** to wrap the selection in a bullet list
// * **Ctrl->** to wrap the selection in a block quote
// * **Enter** to split a non-empty textblock in a list item while at
//   the same time splitting the list item
// * **Mod-Enter** to insert a hard break
// * **Mod-_** to insert a horizontal rule
// * **Backspace** to undo an input rule
// * **Alt-ArrowUp** to `joinUp`
// * **Alt-ArrowDown** to `joinDown`
// * **Mod-BracketLeft** to `lift`
// * **Escape** to `selectParentNode`
//
// You can suppress or map these bindings by passing a `mapKeys`
// argument, which maps key names (say `"Mod-B"` to either `false`, to
// remove the binding, or a new key name string.
export function buildKeymap_markdown(schema:Schema, mapKeys?:{ [key:string] : string|false }) {
	let keys:{ [key:string]: ProseCommand } = {};
	let type;

	function bind(key:string, cmd:any) {
		if (mapKeys) {
			let mapped = mapKeys[key]
			if (mapped === false) return
			if (mapped) key = mapped
		}
		keys[key] = cmd
	}


	bind("Mod-z", undo)
	bind("Shift-Mod-z", redo)
	bind("Backspace", undoInputRule)
	if (!mac) bind("Mod-y", redo)

	bind("Alt-ArrowUp", joinUp)
	bind("Alt-ArrowDown", joinDown)
	bind("Mod-BracketLeft", lift)
	bind("Escape", selectParentNode)

	if (type = schema.marks.strong) {
		bind("Mod-b", toggleMark(type))
		bind("Mod-B", toggleMark(type))
	}
	if (type = schema.marks.em) {
		bind("Mod-i", toggleMark(type))
		bind("Mod-I", toggleMark(type))
	}
	if (type = schema.marks.code)
		bind("Mod-`", toggleMark(type))

	if (type = schema.nodes.bullet_list)
		bind("Shift-Ctrl-8", wrapInList(type))
	if (type = schema.nodes.ordered_list)
		bind("Shift-Ctrl-9", wrapInList(type))
	if (type = schema.nodes.blockquote)
		bind("Ctrl->", wrapIn(type))
	if (type = schema.nodes.hard_break) {
		let br = type, cmd = chainCommands(exitCode, (state, dispatch) => {
			if(dispatch){
				dispatch(state.tr.replaceSelectionWith(br.create()).scrollIntoView())
			}
			return true
		})
		bind("Mod-Enter", cmd)
		bind("Shift-Enter", cmd)
		if (mac) bind("Ctrl-Enter", cmd)
	}
	if (type = schema.nodes.list_item) {
		bind("Enter", splitListItem(type))
		bind("Mod-[", liftListItem(type))
		bind("Mod-]", sinkListItem(type))
	}
	if (type = schema.nodes.paragraph)
		bind("Shift-Ctrl-0", setBlockType(type))
	if (type = schema.nodes.code_block)
		bind("Shift-Ctrl-\\", setBlockType(type))
	if (type = schema.nodes.heading)
		for (let i = 1; i <= 6; i++) bind("Shift-Ctrl-" + i, setBlockType(type, { level: i }))
	if (type = schema.nodes.horizontal_rule) {
		let hr = type
		bind("Mod-_", (state:EditorState, dispatch:((tr:Transaction)=>void)) => {
			dispatch(state.tr.replaceSelectionWith(hr.create()).scrollIntoView())
			return true
		})
	}

	return keys
}