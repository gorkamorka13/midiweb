// Affichage : couleurs et outils de dessin communs à la frise et au diagramme d'accord

export const COL_BG = "#ffffff";
export const COL_BORDER = "#c8ccd2";
export const COL_GRID = "#8a8f98";
export const COL_NOTE = "#3b6fb6";
export const COL_NOTE_OFF = "#cfd4dc";
export const COL_ACCENT = "#e8590c";
export const COL_TEXT = "#1f2328";
export const COL_MUTED = "#6b7280";

const FAMILY = '"Segoe UI", system-ui, -apple-system, sans-serif';
export const FONT_SMALL = `11px ${FAMILY}`;
export const FONT_SMALL_BOLD = `bold 11px ${FAMILY}`;
export const FONT_MARK = `15px ${FAMILY}`;

/** Dimensionne le canevas en pixels CSS, net sur les écrans à haute densité, et le vide. */
export function prepare(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D {
  const ratio = window.devicePixelRatio || 1;
  const w = Math.round(width * ratio);
  const h = Math.round(height * ratio);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = COL_BG;
  ctx.fillRect(0, 0, width, height);
  return ctx;
}

export function line(
  ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, width = 1,
): void {
  // Un trait d'épaisseur impaire est net s'il passe au milieu des pixels
  const shift = width % 2 === 1 ? 0.5 : 0;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  if (x1 === x2) {
    ctx.moveTo(Math.round(x1) + shift, y1);
    ctx.lineTo(Math.round(x2) + shift, y2);
  } else {
    ctx.moveTo(x1, Math.round(y1) + shift);
    ctx.lineTo(x2, Math.round(y2) + shift);
  }
  ctx.stroke();
}

export function text(
  ctx: CanvasRenderingContext2D, x: number, y: number, value: string, color: string, font: string,
  align: CanvasTextAlign = "center",
): void {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(value, x, y);
}
