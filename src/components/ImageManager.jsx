/**
 * ImageManager — camera / photo library picker + inline image display.
 * Uses Capacitor Camera on native, <input type="file"> on web.
 * Images stored as data URLs in the note's images[] field.
 */
import { useState, useRef, useCallback } from 'react';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';

/** Pick an image: camera or library. Returns dataURL or null. */
export async function pickImage(source) {
  try {
    if (Capacitor.isNativePlatform?.()) {
      const photo = await Camera.getPhoto({
        resultType: CameraResultType.DataUrl,
        source: source === 'camera' ? CameraSource.Camera : CameraSource.Photos,
        quality: 70,
        width: 1280,
        height: 1280,
        correctOrientation: true,
      });
      return photo.dataUrl || null;
    }
    // Web fallback
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      if (source === 'camera') input.setAttribute('capture', 'environment');
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      };
      input.click();
    });
  } catch (err) {
    if (err?.message?.includes('cancel')) return null;
    console.warn('[pickImage]', err);
    return null;
  }
}

/** Shrink a dataURL image to maxDim and return compressed JPEG dataURL. */
export async function compressImage(dataUrl, maxDim = 1280, quality = 0.7) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/**
 * Inline images strip shown in the editor.
 * images: [{id, dataUrl}] — tap the ✕ to remove, tap the image to view full size.
 * showAdd=false hides the built-in add buttons (the parent renders its own).
 */
export default function ImageStrip({ images = [], onAdd, onRemove, readOnly = false, showAdd = true }) {
  const [viewing, setViewing] = useState(null); // dataUrl being viewed full-screen

  const openPicker = async source => {
    const dataUrl = await pickImage(source);
    if (!dataUrl) return;
    const compressed = await compressImage(dataUrl);
    onAdd?.(compressed);
  };

  return (
    <div className="image-strip-wrap">
      <div className="image-strip">
        {images.map(img => (
          <div key={img.id} className="image-thumb">
            <img
              src={img.dataUrl}
              alt="note image"
              onClick={() => setViewing(img.dataUrl)}
              style={{ cursor: 'pointer' }}
            />
            {!readOnly && (
              <button
                className="image-remove"
                aria-label="Remove image"
                onClick={() => onRemove?.(img.id)}
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {showAdd && !readOnly && (
          <div className="image-add">
            <button className="image-add-btn" aria-label="Take photo" onClick={() => openPicker('camera')}>
              📷
            </button>
            <button className="image-add-btn" aria-label="Choose from library" onClick={() => openPicker('library')}>
              🖼
            </button>
          </div>
        )}
      </div>

      {viewing && (
        <div className="image-viewer-overlay" onClick={() => setViewing(null)}>
          <img src={viewing} alt="full size" onClick={e => e.stopPropagation()} />
          <button className="image-viewer-close" onClick={() => setViewing(null)} aria-label="Close">✕</button>
        </div>
      )}
    </div>
  );
}