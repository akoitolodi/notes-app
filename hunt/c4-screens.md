# Chunk review: src/components/FoldersScreen.jsx, src/components/NotesListScreen.jsx, src/components/StudyScreen.jsx, src/components/ExamSummaryScreen.jsx (model: gemini-3.5-flash)

...}`).
When `useEffect(() => { generate(); }, [generate]);` runs, `generate` depends on `folder`.
If `folder` object reference changes on parent re-renders, `generate` is recreated, triggering `useEffect` again, re-fetching/re-generating exam summary (making AI API call every render!).
Wait, is `folder` reference unstable? But wait, let's check where `folder` comes from or if there's a more glaring bug.

Wait! Look closely at `FoldersScreen.jsx`!
Let's check `FoldersScreen.jsx`:
```javascript
        {folders.map(folder => (
          <div
            key={folder.id}
            className="list-item"
            style={{
