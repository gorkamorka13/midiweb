// Affichage : couleurs et outils de dessin communs à la frise et au diagramme d'accord

/** Couleurs des canevas : celles du thème clair, puis celles du thème affiché (`refreshColors`). */
export const colors = {
  bg: "#ffffff",
  border: "#d8dce3",
  grid: "#8a8f98",
  note: "#3b6fb6",
  noteOff: "#cdd3dc",
  accent: "#e8590c",
  loop: "rgb(59 111 182 / 0.14)", // fond de la boucle
  text: "#1b2028",
  muted: "#5d6673",
};

// Variable de style.css qui donne chaque couleur
const TOKENS: Record<keyof typeof colors, string> = {
  bg: "--surface",
  border: "--border",
  grid: "--grid",
  note: "--note",
  noteOff: "--note-off",
  accent: "--accent",
  loop: "--loop",
  text: "--text",
  muted: "--muted",
};

/** Relit les couleurs du thème affiché ; les canevas sont ensuite à redessiner. */
export function refreshColors(): void {
  const style = getComputedStyle(document.documentElement);
  for (const key of Object.keys(TOKENS) as (keyof typeof colors)[]) {
    const value = style.getPropertyValue(TOKENS[key]).trim();
    if (value) colors[key] = value;
  }
}

const FAMILY = '"Segoe UI", system-ui, -apple-system, sans-serif';
export const FONT_SMALL = `11px ${FAMILY}`;
export const FONT_SMALL_BOLD = `bold 11px ${FAMILY}`;
export const FONT_NAME = `600 17px ${FAMILY}`; // noms des accords et des notes sur la frise
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
  ctx.fillStyle = colors.bg;
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
