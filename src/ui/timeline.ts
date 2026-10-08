import type { Note } from "../logic";
import {
  COL_ACCENT, COL_BORDER, COL_GRID, COL_MUTED, COL_NOTE, COL_NOTE_OFF, COL_TEXT, FONT_SMALL, line, prepare, text,
} from "./canvas";

const TL_H = 104;
const TL_PAD = 10;
const TL_MAX_SCALE = 400; // pixels par seconde au plus : au-delà, les noms trop serrés sont omis
const TL_FOLLOW = 0.3; // en lecture, la tête de lecture reste à cette fraction de la largeur visible

/** Ce que la frise montre : les notes du fichier et le nom de ce qui est joué pour chacune. */
export interface TimelineModel {
  notes: Note[];
  /** Notes réellement jouées (les autres sont grisées). */
  used: Set<Note>;
  /** Nom de l'accord ou de la note entendu, pour chaque note jouée, dans l'ordre du temps. */
  labels: { start: number; name: string }[];
  /** Mode accord : un nom n'est écrit que s'il diffère du précédent. */
  chords: boolean;
  duration: number;
}

/**
 * Frise du morceau : notes, noms des accords ou des notes jouées, axe du temps et tête de lecture.
 *
 * La frise peut être bien plus large que la fenêtre : seul ce qui est visible est dessiné, dans un
 * canevas qui reste en place pendant que son conteneur défile.
 */
export class Timeline {
  private model: TimelineModel | null = null;
  private scale = 1.0; // pixels par seconde
  private width = 0; // largeur totale de la frise, qui défile si elle dépasse la largeur visible
  private viewWidth = 0;
  private held = false; // bouton de la souris enfoncé sur la frise
  private playhead: number | null = null; // position de lecture (s), null = masquée
  private bars: { x1: number; x2: number; y: number; used: boolean }[] = [];
  private barHeight = 2;
  private names: { x: number; name: string }[] = [];
  private marks: { x: number; label: string }[] = [];
  private axisEnd = 0;
  private measure = document.createElement("canvas").getContext("2d")!;
  private widths = new Map<string, number>();

  constructor(
    private readonly scroller: HTMLElement,
    private readonly spacer: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    onSeek: (seconds: number) => void,
  ) {
    this.measure.font = FONT_SMALL;
    this.spacer.style.height = `${TL_H}px`;

    const seek = (event: PointerEvent) => onSeek((scroller.scrollLeft + event.offsetX - TL_PAD) / this.scale);
    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      this.held = true;
      canvas.setPointerCapture(event.pointerId);
      seek(event);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (this.held) seek(event);
    });
    const release = () => (this.held = false);
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);

    // La molette fait défiler la frise, quand elle dépasse de la fenêtre
    scroller.addEventListener(
      "wheel",
      (event) => {
        if (this.width <= this.viewWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
        event.preventDefault();
        scroller.scrollLeft += Math.sign(event.deltaY) * (this.viewWidth / 10);
      },
      { passive: false },
    );
    scroller.addEventListener("scroll", () => this.render());
    new ResizeObserver(() => {
      if (scroller.clientWidth !== this.viewWidth) this.layout();
    }).observe(scroller);
    this.layout();
  }

  private textWidth(value: string): number {
    let width = this.widths.get(value);
    if (width === undefined) this.widths.set(value, (width = this.measure.measureText(value).width));
    return width;
  }

  private x(seconds: number): number {
    return TL_PAD + this.scale * seconds;
  }

  /** En lecture, un clic ou un glissement sur la frise déplace la lecture. */
  setSeekable(seekable: boolean): void {
    this.scroller.classList.toggle("seekable", seekable);
  }

  setModel(model: TimelineModel | null): void {
    this.model = model;
    this.layout();
  }

  scrollToStart(): void {
    this.scroller.scrollLeft = 0;
  }

  /**
   * Pixels par seconde : le morceau entier dans la largeur si tous les noms y tiennent, sinon
   * juste assez pour les écrire tous, dans la limite de TL_MAX_SCALE.
   */
  private fitScale(model: TimelineModel): number {
    let scale = (this.viewWidth - 2 * TL_PAD) / model.duration;
    const shown = model.labels.filter((l, i) => !(model.chords && i && l.name === model.labels[i - 1].name));
    for (let i = 0; i + 1 < shown.length; i++) {
      const gap = shown[i + 1].start - shown[i].start;
      const width = this.textWidth(shown[i].name);
      if (gap * TL_MAX_SCALE <= width + 6) return Math.max(scale, TL_MAX_SCALE);
      scale = Math.max(scale, (width + 6) / gap);
    }
    return scale;
  }

  /**
   * Place les notes, les noms et l'axe du temps (la tête de lecture est déplacée séparément par
   * `movePlayhead`). L'instant affiché au bord gauche est conservé.
   */
  private layout(): void {
    const leftTime = Math.max(0, this.scroller.scrollLeft) / this.scale;
    this.viewWidth = this.scroller.clientWidth;
    this.bars = [];
    this.names = [];
    this.marks = [];
    const model = this.model;
    if (!model) {
      this.scale = 1.0;
      this.width = this.viewWidth;
      this.spacer.style.width = `${this.width}px`;
      this.render();
      return;
    }

    this.scale = this.fitScale(model);
    this.width = Math.max(this.viewWidth, 2 * TL_PAD + this.scale * model.duration);
    const [top, bottom] = [26, TL_H - 22];
    let low = Infinity;
    let high = -Infinity;
    for (const n of model.notes) {
      low = Math.min(low, n.pitch);
      high = Math.max(high, n.pitch);
    }
    const span = Math.max(1, high - low);
    const bar = Math.max(2.0, Math.min(6.0, (bottom - top) / (span + 1)));
    this.barHeight = bar;

    // Notes : position horizontale = temps, verticale = hauteur (grisées si écartées par « Mélodie seule »)
    for (const n of model.notes) {
      const x1 = this.x(n.start);
      this.bars.push({
        x1,
        x2: Math.max(x1 + 2, this.x(n.start + n.duration) - 1),
        y: bottom - bar - ((bottom - top - bar) * (n.pitch - low)) / span,
        used: model.used.has(n),
      });
    }

    // Noms : l'accord à chaque changement en mode accord, chaque note en Simple Corde. Un nom
    // n'est omis que si l'échelle maximale ne lui laisse pas la place
    let nextFree = 0;
    let last: string | null = null;
    for (const { start, name } of model.labels) {
      const x = this.x(start);
      if (model.chords && name === last) continue;
      if (x < nextFree) {
        last = null; // pas la place : l'accord suivant sera affiché même s'il est identique
        continue;
      }
      this.names.push({ x, name });
      nextFree = x + this.textWidth(name) + 6;
      last = name;
    }

    // Axe du temps
    this.axisEnd = this.width - TL_PAD;
    const step = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => s * this.scale >= 80) ?? 1200;
    for (let t = 0; t < Math.trunc(model.duration) + 1; t += step) {
      const x = this.x(t);
      const label = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
      if (x + this.textWidth(label) + 2 > this.width) break;
      this.marks.push({ x, label });
    }

    this.width = Math.max(this.width, nextFree); // le dernier nom peut dépasser la fin du morceau
    this.spacer.style.width = `${this.width}px`;
    this.scroller.scrollLeft = leftTime * this.scale;
    this.render();
  }

  /** Dessine la partie visible de la frise. */
  private render(): void {
    const ctx = prepare(this.canvas, this.viewWidth, TL_H);
    if (!this.model) {
      text(ctx, this.viewWidth / 2, TL_H / 2, "Aucun fichier chargé", COL_MUTED, FONT_SMALL);
      return;
    }
    const left = this.scroller.scrollLeft;
    const right = left + this.viewWidth;
    const bottom = TL_H - 22;
    ctx.save();
    ctx.translate(-left, 0);

    for (const used of [false, true]) {
      // les notes jouées sont dessinées par-dessus les notes écartées
      ctx.fillStyle = used ? COL_NOTE : COL_NOTE_OFF;
      for (const b of this.bars) {
        if (b.x1 > right) break;
        if (b.used === used && b.x2 >= left) ctx.fillRect(b.x1, b.y, b.x2 - b.x1, this.barHeight);
      }
    }

    for (const { x, name } of this.names) {
      if (x > right) break;
      if (x + this.textWidth(name) >= left) text(ctx, x, 13, name, COL_TEXT, FONT_SMALL, "left");
    }

    line(ctx, TL_PAD, bottom + 3, this.axisEnd, bottom + 3, COL_BORDER);
    for (const { x, label } of this.marks) {
      if (x > right) break;
      line(ctx, x, bottom + 3, x, bottom + 7, COL_GRID);
      text(ctx, x + 2, TL_H - 7, label, COL_MUTED, FONT_SMALL, "left");
    }

    if (this.playhead !== null) {
      const x = this.x(this.playhead);
      line(ctx, x, 2, x, TL_H - 2, COL_ACCENT, 2);
    }
    ctx.restore();
  }

  /** Place la tête de lecture et fait défiler la frise pour la suivre. */
  movePlayhead(seconds: number): void {
    this.playhead = seconds;
    if (!this.held) {
      // pendant un clic maintenu, la frise ne bouge pas sous le pointeur
      this.scroller.scrollLeft = Math.max(0.0, this.x(seconds) - this.viewWidth * TL_FOLLOW);
    }
    this.render();
  }

  hidePlayhead(): void {
    this.playhead = null;
    this.render();
  }
}
