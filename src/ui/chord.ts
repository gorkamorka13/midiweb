import { OPEN_STRINGS, noteName, type Notation } from "../guitar";
import type { Display } from "../player";
import {
  COL_ACCENT, COL_GRID, COL_MUTED, COL_TEXT, FONT_MARK, FONT_SMALL, FONT_SMALL_BOLD, line, prepare, text,
} from "./canvas";

const CD_W = 190;
const CD_H = 206;
const CD_FRETS = 5; // nombre de cases visibles sur le diagramme

/**
 * Diagramme d'accord : cordes verticales (Mi grave à gauche), cases jouées, et cordes
 * allumées (`lit`) juste après avoir été frappées.
 */
export function drawChord(
  canvas: HTMLCanvasElement, display: Display | null, lit: boolean[] | null, notation: Notation,
): void {
  const ctx = prepare(canvas, CD_W, CD_H);
  const [x0, dx, y0, dy] = [46, 22, 44, 28];
  const frets = display ? display.frets : OPEN_STRINGS.map(() => null);
  const fretted = frets.filter((f): f is number => !!f);
  // Fenêtre de cases : à partir du sillet, ou de la première case jouée si l'accord est plus haut
  const base = !fretted.length || Math.max(...fretted) <= CD_FRETS ? 1 : Math.min(...fretted);

  for (let i = 0; i <= CD_FRETS; i++) {
    const y = y0 + i * dy;
    line(ctx, x0, y, x0 + 5 * dx, y, COL_GRID, i === 0 && base === 1 ? 4 : 1);
  }
  if (base > 1) text(ctx, x0 - 10, y0 + dy / 2, `${base}fr`, COL_MUTED, FONT_SMALL, "right");

  const single = !!display && display.mode !== "accord";
  frets.forEach((fret, s) => {
    const x = x0 + s * dx;
    const hit = !!lit && lit[s];
    line(ctx, x, y0, x, y0 + CD_FRETS * dy, hit ? COL_ACCENT : COL_GRID, hit ? 4 : 2);
    text(ctx, x, y0 + CD_FRETS * dy + 11, noteName(OPEN_STRINGS[s], notation), COL_MUTED, FONT_SMALL);
    if (!display) return;
    if (fret === null) {
      // en simple corde, les autres cordes ne sont pas étouffées, juste non jouées
      if (!single) text(ctx, x, y0 - 14, "×", COL_MUTED, FONT_MARK);
    } else if (fret === 0) {
      ctx.strokeStyle = hit ? COL_ACCENT : COL_TEXT;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y0 - 14, 5, 0, 2 * Math.PI);
      ctx.stroke();
    } else if (fret - base >= 0 && fret - base < CD_FRETS) {
      const y = y0 + (fret - base + 0.5) * dy;
      ctx.fillStyle = hit ? COL_ACCENT : COL_TEXT;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, 2 * Math.PI);
      ctx.fill();
      if (single) text(ctx, x, y, String(fret), "#ffffff", FONT_SMALL_BOLD);
    }
  });
}
