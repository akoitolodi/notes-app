# Chunk review: src/components/NoteEditor.jsx (model: gemini-3.5-flash)

const newBlocks = result.blocks || [];
      setBlocks(newBlocks);
      setFlashcards(result.flashcards || []);
      setQuiz(result.quiz || []);
      await updateNote(note.id, {
        blocks: newBlocks,
        flashcards: result.flashcards || [],
        quiz: result.quiz || [],
      });
      setMode('read');
    } catch (err) {
      setScanError(err.message);
    } finally {
      setIsScanning(false);
    }
  }, [title, body, note]);
```
Wait! Look at `savedRef.current = { title, body }`:
Where is this assigned in `handleSave`?
