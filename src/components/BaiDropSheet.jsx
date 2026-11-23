/**
 * BaiDropSheet — Zero-Cloud Offline Share Sheet for a single Note.
 *
 * Lets classmates share any unlocked note (plus its Flashcards & Quiz!) 100% offline:
 * - Download portable `.bai.json` file (send via Bluetooth / Nearby Share / Messenger)
 * - Copy compact `BAIDROP1:...` Share Code to paste in Settings → BaiDrop Import
 */
import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Share2, Download, Copy, X, ShieldCheck } from 'lucide-react';
import {
  buildNoteBaiBundle,
  encodeBaiShareCode,
  downloadBaiFile,
} from '../lib/baiDrop';
import { useDialog } from './ui/DialogProvider';

export default function BaiDropSheet({ open, onClose, note, folderName = 'Shared' }) {
  const { toast } = useDialog();

  const bundle = useMemo(() => (open && note ? buildNoteBaiBundle(note, folderName) : null), [
    open,
    note,
    folderName,
  ]);

  const shareCode = useMemo(() => {
    if (!bundle) return '';
    try {
      return encodeBaiShareCode(bundle);
    } catch {
      return '';
    }
  }, [bundle]);

  if (!open || !bundle) return null;

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(shareCode);
      toast('BaiDrop Share Code copied! Paste in Settings → BaiDrop Import.', { type: 'success' });
    } catch {
      toast('Could not access clipboard — use Download .bai.json instead', { type: 'error' });
    }
  };

  const handleDownload = () => {
    downloadBaiFile(bundle);
    toast('Downloaded portable .bai.json bundle!', { type: 'success' });
  };

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet-panel" onClick={e => e.stopPropagation()}>
        <div className="sheet-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Share2 size={18} color="var(--accent-ink)" />
            <span className="sheet-title">BaiDrop Offline Share</span>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close BaiDrop">
            <X size={18} />
          </button>
        </div>

        <p className="settings-help" style={{ marginTop: 0 }}>
          Share <strong>{bundle.note.title}</strong> ({bundle.note.flashcards.length} cards, {bundle.note.quiz.length}{' '}
          quiz items) with a classmate <strong>100% offline</strong> — no cloud account needed!
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          <button type="button" className="btn btn-primary w-full" onClick={handleDownload}>
            <Download size={16} /> Export Portable .bai.json File
          </button>
          <button
            type="button"
            className="btn btn-secondary w-full"
            disabled={!shareCode}
            onClick={handleCopyCode}
          >
            <Copy size={16} /> Copy Compact Share Code ({Math.ceil(shareCode.length / 1024)} KB)
          </button>
        </div>

        <div className="settings-help" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <ShieldCheck size={14} color="#28b44c" />
          <span>Only this single note is packaged. Your Hidden Vault &amp; Passwords &amp; Keys are never touched.</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
