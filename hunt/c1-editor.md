# Chunk review: src/components/NoteEditor.jsx, src/components/SlideUpPanel.jsx (model: gemini-3.5-flash)


`const ex = expandedInline[block.id];`
In `swipe` view, `expandedInline[b.id]` is `undefined` (or not set to `'simpler'`/`'example'`)!
So `ex` is `undefined`.
`activeVariant(b)` checks:
`if (ex === 'simpler' && block.simpler) return block.simpler;` -> false!
`if (ex === 'example' && block.example) return block.example;` -> false!
`return block.explanation || '';`
So `activeVariant(b)` returns `block.explanation`!
`block.simpler` and `block.example` ARE NEVER SHOWN in `swipe` view even
