/**
 * imageEnhance — 100% offline HTML5 Canvas2D Whiteboard & Document Auto-Enhance Scanner.
 * Brightens dim shadows, boosts marker/pen ink contrast, and produces crisp OCR-ready images.
 */

function clampByte(n) {
  return n < 0 ? 0 : n > 255 ? 255 : Math.round(n);
}

/**
 * Pure pixel buffer enhancer (directly unit-testable without Canvas!).
 * - 'whiteboard': preserves marker colors while whitening dim background & sharpening ink
 * - 'document': crisp high-contrast B&W scanned paper look ideal for handouts & OCR
 */
export function enhancePixelsRgba(data, mode = 'whiteboard') {
  if (!data || data.length < 4) return data;

  // 1. Estimate dark & paper white levels via fast sub-sampled luminance histogram
  const hist = new Uint32Array(256);
  const stride = Math.max(4, Math.floor(data.length / 8000) * 4);
  let samples = 0;
  for (let i = 0; i < data.length; i += stride) {
    const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    hist[lum < 0 ? 0 : lum > 255 ? 255 : lum] += 1;
    samples += 1;
  }

  let acc = 0;
  let lowP = 18;
  let highP = 225;
  const lowTarget = Math.max(1, Math.floor(samples * 0.03));
  const highTarget = Math.max(1, Math.floor(samples * 0.88));
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc <= lowTarget) lowP = v;
    if (acc <= highTarget) highP = v;
  }
  const span = Math.max(48, highP - lowP);

  // 2. Apply adaptive contrast curve + ink boost per pixel
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    if (mode === 'document') {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const norm = (lum - lowP) / span;
      // S-curve compression pushes paper towards 255 and keeps ink sharp & dark
      const out = norm >= 0.72 ? 255 : norm <= 0.2 ? norm * 90 : ((norm - 0.2) / 0.52) * 235 + 18;
      const c = clampByte(out);
      data[i] = c;
      data[i + 1] = c;
      data[i + 2] = c;
    } else {
      // Whiteboard mode: lift paper brightness + stretch color contrast gently
      const scale = 255 / span;
      const nr = clampByte((r - lowP) * scale);
      const ng = clampByte((g - lowP) * scale);
      const nb = clampByte((b - lowP) * scale);
      const lum = (nr + ng + nb) / 3;
      const maxCh = Math.max(nr, ng, nb);
      const minCh = Math.min(nr, ng, nb);
      const sat = maxCh - minCh;
      // Whiten flat grey board background while keeping marker ink saturated
      if (lum > 188 && sat < 26) {
        data[i] = 252;
        data[i + 1] = 252;
        data[i + 2] = 253;
      } else {
        data[i] = nr;
        data[i + 1] = ng;
        data[i + 2] = nb;
      }
    }
  }
  return data;
}

/** Auto-enhance a photo Data URL cleanly on Canvas2D (runs 100% offline in the browser/WebView). */
export async function enhanceWhiteboardImage(dataUrl, mode = 'whiteboard', maxDim = 1600) {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return dataUrl;
  }
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const s = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * s);
          height = Math.round(height * s);
        }
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, width);
        canvas.height = Math.max(1, height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        enhancePixelsRgba(imgData.data, mode);
        ctx.putImageData(imgData, 0, 0);
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
