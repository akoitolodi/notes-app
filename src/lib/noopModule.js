// Lightweight stub for unused optional dependencies (e.g. html2canvas, canvg in jspdf)
export default function noopOptionalDep() {
  throw new Error('Optional dependency disabled in production bundle');
}
