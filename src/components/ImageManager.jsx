/**
 * ImageManager — camera / photo library picker + Blob-backed image strip +
 * full-screen zoomable viewer with "Explain Photo" and "Extract Text (OCR)".
 *
 * Fixes:
 * - Web file picker cancel no longer hangs Promises (handles oncancel + focus).
 * - Native Capacitor photos skip redundant second JPEG compression.
 * - Supports Dexie v4 Blob attachments via Object URLs (revoked cleanly on unmount).
 */
import { useState, useEffect } from 'react';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { X, Sparkles, ScanText, ZoomIn, ZoomOut, Camera as CameraIcon, Image as ImageIcon } from 'lucide-react';
import { resolveImageBlob, resolveImageDataUrl } from '../store/db';
import { explainImage, ocrImage } from '../lib/aiFeatures';
import MarkdownContent from './ui/MarkdownContent';
import { useDialog } from './ui/DialogProvider';

/** Pick an image from camera or library. Resolves to { dataUrl, alreadyCompressed } or null. */
export async function pickImage(source) {
  try {
    if (Capacitor.isNativePlatform?.()) {
      const photo = await Camera.getPhoto({
        resultType: CameraResultType.DataUrl,
        source: source === 'camera' ? CameraSource.Camera : CameraSource.Photos,
        quality: 82,
        width: 1600,
        height: 1600,
        correctOrientation: true,
      });
      return photo.dataUrl ? { dataUrl: photo.dataUrl, alreadyCompressed: true } : null;
    }

    // Web fallback with safe cancel handling so callers never hang forever
    return new Promise(resolve => {
      let settled = false;
      const done = val => {
        if (settled) return;
        settled = true;
        window.removeEventListener('focus', onWindowFocus);
        resolve(val);
      };

      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      if (source === 'camera') input.setAttribute('capture', 'environment');

      const onWindowFocus = () => {
        setTimeout(() => {
          if (!input.files || input.files.length === 0) done(null);
        }, 350);
      };

      input.addEventListener('cancel', () => done(null));
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return done(null);
        const reader = new FileReader();
        reader.onload = () => done({ dataUrl: String(reader.result || ''), alreadyCompressed: false });
        reader.onerror = () => done(null);
        reader.readAsDataURL(file);
      };

      window.addEventListener('focus', onWindowFocus);
      input.click();
    });
  } catch (err) {
    if (/cancel/i.test(err?.message || '')) return null;
    console.warn('[pickImage]', err);
    return null;
  }
}

/** Shrink a dataURL image to maxDim and return compressed JPEG dataURL (preserves PNG if transparent). */
export async function compressImage(dataUrl, maxDim = 1440, quality = 0.8) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width <= maxDim && height <= maxDim && String(dataUrl).length < 450000) {
        return resolve(dataUrl);
      }
      if (width > maxDim || height > maxDim) {
        const scale = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      const isPng = String(dataUrl).startsWith('data:image/png');
      resolve(canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function ImageThumb({ img, readOnly, onRemove, onOpen }) {
  const [src, setSrc] = useState(img.dataUrl || null);

  useEffect(() => {
    if (img.dataUrl) {
      setSrc(img.dataUrl);
      return undefined;
    }
    let url = null;
    let live = true;
    resolveImageBlob(img).then(blob => {
      if (!live || !blob) return;
      url = URL.createObjectURL(blob);
      setSrc(url);
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [img]);

  if (!src) return null;

  return (
    <div className="image-thumb">
      <img src={src} alt="Note attachment" onClick={() => onOpen(img, src)} />
      {!readOnly && (
        <button
          type="button"
          className="image-remove"
          aria-label="Remove image"
          onClick={() => onRemove?.(img.id)}
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

export default function ImageStrip({
  images = [],
  onAdd,
  onRemove,
  onAppendText,
  noteContext = '',
  subject = 'General',
  readOnly = false,
  showAdd = true,
}) {
  const { toast } = useDialog();
  const [viewing, setViewing] = useState(null); // { img, src }
  const [zoomed, setZoomed] = useState(false);
  const [aiBusy, setAiBusy] = useState(null); // null | 'explain' | 'ocr'
  const [explanation, setExplanation] = useState('');

  useEffect(() => {
    if (!viewing) return undefined;
    const onKey = e => {
      if (e.key === 'Escape') {
        setViewing(null);
        setZoomed(false);
        setExplanation('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewing]);

  const openPicker = async source => {
    const picked = await pickImage(source);
    if (!picked?.dataUrl) return;
    const finalUrl = picked.alreadyCompressed
      ? picked.dataUrl
      : await compressImage(picked.dataUrl);
    onAdd?.(finalUrl);
  };

  const handleExplainPhoto = async () => {
    if (!viewing || aiBusy) return;
    setAiBusy('explain');
    setExplanation('');
    try {
      const dataUrl = await resolveImageDataUrl(viewing.img);
      if (!dataUrl) throw new Error('Could not load image data');
      const text = await explainImage({
        imageDataUrl: dataUrl,
        noteContext,
        subject,
      });
      setExplanation(text);
    } catch (err) {
      toast(`Explain failed: ${err.message}`, { type: 'error' });
    } finally {
      setAiBusy(null);
    }
  };

  const handleOcrPhoto = async () => {
    if (!viewing || aiBusy) return;
    setAiBusy('ocr');
    try {
      const dataUrl = await resolveImageDataUrl(viewing.img);
      if (!dataUrl) throw new Error('Could not load image data');
      const text = await ocrImage({ imageDataUrl: dataUrl, subject });
      if (text && text.trim()) {
        onAppendText?.(text.trim());
        toast('Extracted text added to note', { type: 'success' });
        setViewing(null);
      } else {
        toast('No readable text found in this photo');
      }
    } catch (err) {
      toast(`OCR failed: ${err.message}`, { type: 'error' });
    } finally {
      setAiBusy(null);
    }
  };

  if (images.length === 0 && (!showAdd || readOnly)) return null;

  return (
    <div className="image-strip-wrap">
      <div className="image-strip">
        {images.map(img => (
          <ImageThumb
            key={img.id}
            img={img}
            readOnly={readOnly}
            onRemove={onRemove}
            onOpen={(item, src) => {
              setViewing({ img: item, src });
              setZoomed(false);
              setExplanation('');
            }}
          />
        ))}
        {showAdd && !readOnly && (
          <div className="flex gap-8" style={{ flexShrink: 0 }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ width: 112, height: 112, flexDirection: 'column' }}
              aria-label="Take photo"
              onClick={() => openPicker('camera')}
            >
              <CameraIcon size={24} />
              <span style={{ fontSize: 12 }}>Photo</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ width: 112, height: 112, flexDirection: 'column' }}
              aria-label="Choose from library"
              onClick={() => openPicker('library')}
            >
              <ImageIcon size={24} />
              <span style={{ fontSize: 12 }}>Gallery</span>
            </button>
          </div>
        )}
      </div>

      {viewing && (
        <div
          className="image-viewer-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Image viewer"
        >
          <div className="image-viewer-top">
            <button
              type="button"
              className="image-viewer-icon-btn"
              onClick={() => setZoomed(z => !z)}
              aria-label={zoomed ? 'Zoom out' : 'Zoom in'}
            >
              {zoomed ? <ZoomOut size={19} /> : <ZoomIn size={19} />}
            </button>
            <button
              type="button"
              className="image-viewer-icon-btn"
              onClick={() => {
                setViewing(null);
                setZoomed(false);
                setExplanation('');
              }}
              aria-label="Close image viewer"
            >
              <X size={20} />
            </button>
          </div>

          <div
            className="image-viewer-stage"
            onClick={() => {
              if (zoomed) setZoomed(false);
              else setViewing(null);
            }}
          >
            <img
              src={viewing.src}
              alt="Full size attachment"
              className={zoomed ? 'zoomed' : ''}
              onClick={e => {
                e.stopPropagation();
                setZoomed(z => !z);
              }}
            />
          </div>

          {explanation && (
            <div className="image-viewer-ai">
              <MarkdownContent text={explanation} />
            </div>
          )}

          <div className="image-viewer-bar">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={Boolean(aiBusy)}
              onClick={handleExplainPhoto}
            >
              {aiBusy === 'explain' ? (
                <>
                  <span className="spinner" style={{ width: 14, height: 14 }} /> Explaining…
                </>
              ) : (
                <>
                  <Sparkles size={15} /> Explain photo
                </>
              )}
            </button>
            {onAppendText && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={Boolean(aiBusy)}
                onClick={handleOcrPhoto}
              >
                {aiBusy === 'ocr' ? (
                  <>
                    <span className="spinner" style={{ width: 14, height: 14 }} /> Reading…
                  </>
                ) : (
                  <>
                    <ScanText size={15} /> Extract text (OCR)
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
