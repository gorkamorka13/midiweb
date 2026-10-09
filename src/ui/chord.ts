import { CHORD_FRETS, OPEN_STRINGS, findBarre, noteName, type Notation } from "../guitar";
import type { Display } from "../player";
import { FONT_MARK, FONT_SMALL, FONT_SMALL_BOLD, colors, line, prepare, text } from "./canvas";

const CD_FRETS = 5; // nombre de cases visibles sur le diagramme
// Cases visibles en mode « depuis le sillet » : jusqu'à la plus haute case de tous les accords,
// pour que le diagramme garde la même taille d'un accord à l'autre
const NUT_FRETS = Math.max(CD_FRETS, ...Object.values(CHORD_FRETS).flat().map((f) => f ?? 0));
const CD_STRINGS = OPEN_STRINGS.length;
const [DS, DF] = [22, 28]; // écart entre deux cordes, entre deux frettes

type Point = readonly [x: number, y: number];

/**
 * Diagramme d'accord, vertical (sillet en haut, Mi grave à gauche) ou horizontal (sillet à
 * gauche, Mi grave en bas, comme une tablature) : cases jouées, et cordes allumées (`lit`)
 * juste après avoir été frappées. Les textes restent droits dans les deux sens.
 *
 * Par défaut, la fenêtre de cases suit l'accord (« 4fr » s'il est haut sur le manche). Avec
 * `fromNut`, le manche est montré depuis le sillet jusqu'à la case la plus haute des accords.
 */
export function drawChord(
  canvas: HTMLCanvasElement, display: Display | null, lit: boolean[] | null, notation: Notation,
  horizontal = false, fromNut = false,
): void {
  const frets = display ? display.frets : OPEN_STRINGS.map(() => null);
  // Transposé vers l'aigu, la forme se joue avec un capo
  const capo = display && display.transpose > 0 ? display.transpose : 0;
  // Depuis le sillet, le capo est à sa vraie case et la forme se décale d'autant
  const shift = fromNut ? capo : 0;
  const fretted = frets.filter((f): f is number => !!f).map((f) => f + shift);
  // Fenêtre de cases : à partir du sillet, ou de la première case jouée si l'accord est plus haut
  const base = fromNut || !fretted.length || Math.max(...fretted) <= CD_FRETS ? 1 : Math.min(...fretted);
  const count = fromNut ? Math.max(NUT_FRETS, capo, ...fretted) : CD_FRETS; // nombre de cases dessinées
  const ctx = prepare(canvas, horizontal ? 76 + count * DF : 190, horizontal ? 154 : 66 + count * DF);
  // Point de la corde `s` (0 = Mi grave) à la position `p` le long du manche (0 = sillet, en frettes)
  const at = (s: number, p: number): Point =>
    horizontal ? [50 + p * DF, 28 + (CD_STRINGS - 1 - s) * DS] : [46 + s * DS, 44 + p * DF];
  /** Rectangle arrondi entre deux points alignés, élargi de `pad` le long de la ligne et de `half` de chaque côté. */
  const bar = ([x1, y1]: Point, [x2, y2]: Point, half: number, pad: number) => {
    const [padX, padY] = x1 === x2 ? [half, pad] : [pad, half];
    ctx.beginPath();
    ctx.roundRect(Math.min(x1, x2) - padX, Math.min(y1, y2) - padY, Math.abs(x2 - x1) + 2 * padX, Math.abs(y2 - y1) + 2 * padY, half);
    ctx.fill();
  };

  const last = CD_STRINGS - 1;

  for (let i = 0; i <= count; i++) {
    const [[x1, y1], [x2, y2]] = [at(0, i), at(last, i)];
    line(ctx, x1, y1, x2, y2, colors.grid, i === 0 && base === 1 ? 4 : 1);
  }
  if (base > 1) {
    const [x, y] = at(last, 0.5);
    if (horizontal) text(ctx, x, y - 14, `${base}fr`, colors.muted, FONT_SMALL);
    else text(ctx, at(0, 0)[0] - 10, at(0, 0.5)[1], `${base}fr`, colors.muted, FONT_SMALL, "right");
  }

  if (fromNut) {
    // Repères de cases, comme les marques du manche
    for (const f of [3, 5, 7, 9, 12]) {
      if (f > count) break;
      if (f === capo) continue; // la place est prise par l'étiquette du capo
      const [x, y] = at(horizontal ? last : 0, f - 0.5);
      if (horizontal) text(ctx, x, y - 14, String(f), colors.muted, FONT_SMALL);
      else text(ctx, x - 14, y, String(f), colors.muted, FONT_SMALL, "right");
    }
  }

  // Le capo tient lieu de sillet, sauf depuis le sillet où il se pose sur sa case
  if (capo) {
    const p = fromNut ? capo - 0.5 : 0;
    const [x, y] = at(horizontal ? last : 0, fromNut ? p : 0);
    const [lx, ly] = fromNut ? [x, y] : [x, horizontal ? y : at(0, -0.5)[1]];
    if (horizontal) text(ctx, lx, ly - 14, `capo ${capo}`, colors.muted, FONT_SMALL, fromNut ? "center" : "right");
    else text(ctx, lx - 10, ly, `capo ${capo}`, colors.muted, FONT_SMALL, "right");
    if (base === 1) {
      ctx.fillStyle = colors.muted;
      if (fromNut) bar(at(0, p), at(last, p), 9, 9);
      else bar(at(0, 0), at(last, 0), 4, 8);
    }
  }

  // Le barré remplace les ronds des cordes qu'il couvre ; une corde frappée garde son rond accentué
  const barre = display?.mode === "accord" ? findBarre(frets) : null;
  const barreFret = barre ? barre.fret + shift : 0;
  if (barre && barreFret - base >= 0 && barreFret - base < count) {
    const p = barreFret - base + 0.5;
    ctx.fillStyle = colors.text;
    bar(at(barre.from, p), at(barre.to, p), 9, 9);
  }

  const single = !!display && display.mode !== "accord";
  frets.forEach((fret, s) => {
    const hit = !!lit && lit[s];
    const [[x1, y1], [x2, y2]] = [at(s, 0), at(s, count)];
    line(ctx, x1, y1, x2, y2, hit ? colors.accent : colors.grid, hit ? 4 : 2);
    const [nx, ny] = at(s, count + 0.4);
    text(ctx, nx, ny, noteName(OPEN_STRINGS[s], notation), colors.muted, FONT_SMALL);
    if (!display) return;
    const [mx, my] = at(s, -0.5);
    if (fret === null) {
      // en simple corde, les autres cordes ne sont pas étouffées, juste non jouées
      if (!single) text(ctx, mx, my, "×", colors.muted, FONT_MARK);
    } else if (fret === 0 && shift) {
      // corde à vide sous le capo : le capo la tient
    } else if (fret === 0) {
      ctx.strokeStyle = hit ? colors.accent : colors.text;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mx, my, 5, 0, 2 * Math.PI);
      ctx.stroke();
    } else if (fret + shift - base >= 0 && fret + shift - base < count) {
      if (barre && fret === barre.fret && s >= barre.from && s <= barre.to && !hit) return;
      const [x, y] = at(s, fret + shift - base + 0.5);
      ctx.fillStyle = hit ? colors.accent : colors.text;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, 2 * Math.PI);
      ctx.fill();
      if (single) text(ctx, x, y, String(fret + shift), colors.bg, FONT_SMALL_BOLD);
    }
  });
}
