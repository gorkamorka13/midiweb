import { OPEN_STRINGS, noteName, type Notation } from "../guitar";
import type { TabNote } from "../logic";
import { FONT_SMALL, FONT_SMALL_BOLD, colors, line, prepare, text } from "./canvas";

export const TAB_H = 112;
const TAB_TOP = 18; // corde la plus aiguë
const TAB_GAP = 16; // entre deux cordes
const TAB_LABEL_X = 10; // numéros des cordes, au bord gauche de la partie visible

/** Ce que la frise donne à la bande pour dessiner la même portion de temps qu'elle. */
export interface TabView {
  /** Défilement et largeur de la partie visible (pixels). */
  left: number;
  width: number;
  /** Abscisse (pixels, défilement non compris) d'un instant du morceau. */
  x: (seconds: number) => number;
  playhead: number | null;
  loop: readonly [start: number, end: number] | null;
}

/**
 * Bande « Simple Corde » sous la frise : une ligne par corde, le numéro de case de chaque note à
 * son instant. Elle partage le défilement et l'échelle de la frise, dont elle est dessinée à
 * chaque image.
 */
export class TabLane {
  private notes: TabNote[] = [];
  private notation: Notation = "fr";
  private transpose = 0; // demi-tons entre le doigté et ce qu'on entend (capo, transposition)
  private view: TabView | null = null;
  private measure = document.createElement("canvas").getContext("2d")!;
  private widths = new Map<string, number>();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.measure.font = FONT_SMALL_BOLD;
  }

  setNotes(notes: TabNote[], notation: Notation = "fr", transpose = 0): void {
    this.notes = notes;
    this.notation = notation;
    this.transpose = transpose;
    if (this.view) this.render(this.view);
  }

  private textWidth(value: string): number {
    let width = this.widths.get(value);
    if (width === undefined) this.widths.set(value, (width = this.measure.measureText(value).width));
    return width;
  }

  /** Ordonnée de la corde : la plus aiguë en haut, comme sur une tablature. */
  private y(string: number): number {
    return TAB_TOP + (OPEN_STRINGS.length - 1 - string) * TAB_GAP;
  }

  render(view: TabView): void {
    this.view = view;
    const ctx = prepare(this.canvas, view.width, TAB_H);
    // La bande ne dessine que ce qui est visible, comme la frise
    ctx.save();
    ctx.translate(-view.left, 0);
    const [left, right] = [view.left, view.left + view.width];

    if (view.loop) {
      ctx.fillStyle = colors.loop;
      ctx.fillRect(view.x(view.loop[0]), 0, view.x(view.loop[1]) - view.x(view.loop[0]), TAB_H);
    }
    OPEN_STRINGS.forEach((_, string) => line(ctx, left, this.y(string), right, this.y(string), colors.border));

    const bar = 3;
    for (let i = 0; i < this.notes.length; i++) {
      const n = this.notes[i];
      const x1 = view.x(n.start);
      if (x1 > right) break;
      const x2 = Math.max(x1 + 2, view.x(n.start + n.duration) - 1);
      if (x2 < left) continue;
      const y = this.y(n.string);
      ctx.fillStyle = colors.note;
      ctx.fillRect(x1, y - bar / 2, x2 - x1, bar);

      // Le numéro de case et le nom de la note coupent la corde ; le nom est omis, puis le numéro,
      // quand la note suivante les recouvrirait
      const fret = String(n.fret);
      const name = noteName(n.pitch + this.transpose, this.notation);
      const room = i + 1 < this.notes.length ? view.x(this.notes[i + 1].start) - x1 : Infinity;
      const fretWidth = this.textWidth(fret);
      const nameWidth = this.textWidth(name);
      const full = room >= fretWidth + nameWidth + 10;
      if (!full && room < fretWidth + 4) continue;
      const boxWidth = full ? fretWidth + nameWidth + 8 : fretWidth + 4;
      ctx.fillStyle = colors.bg;
      ctx.fillRect(x1 - 1, y - 8, boxWidth, 16);
      text(ctx, x1 + 1, y, fret, colors.text, FONT_SMALL_BOLD, "left");
      if (full) text(ctx, x1 + fretWidth + 5, y, name, colors.accent, FONT_SMALL_BOLD, "left");
    }

    if (view.playhead !== null) {
      const x = view.x(view.playhead);
      line(ctx, x, 2, x, TAB_H - 2, colors.accent, 2);
    }
    ctx.restore();

    // Numéros des cordes, fixes au bord gauche (1 = la plus aiguë)
    OPEN_STRINGS.forEach((_, string) => {
      const y = this.y(string);
      ctx.fillStyle = colors.bg;
      ctx.fillRect(TAB_LABEL_X - 4, y - 7, 14, 14);
      text(ctx, TAB_LABEL_X, y, String(OPEN_STRINGS.length - string), colors.muted, FONT_SMALL, "left");
    });
    text(ctx, TAB_LABEL_X, 7, "Simple Corde", colors.muted, FONT_SMALL_BOLD, "left");
  }
}
