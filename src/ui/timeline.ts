import type { Notation } from "../guitar";
import type { Note, TabNote } from "../logic";
import { FONT_NAME, FONT_SMALL, FONT_SMALL_BOLD, colors, line, prepare, text } from "./canvas";
import { TAB_H, TabLane } from "./tabs";

const TL_H = 190;
const TL_TOP = 42; // sous les noms
const TL_NAME_Y = 20; // milieu de la ligne des noms
const TL_NAME_TOP = TL_NAME_Y - 14; // hauteur sur laquelle un nom se clique
const TL_NAME_BOTTOM = TL_NAME_Y + 14;
const TL_SECTION_Y = 37; // nom des parties du morceau, entre les noms et les notes
const TL_BOTTOM = TL_H - 22; // au-dessus de l'axe du temps
const TL_PAD = 10;
const TL_MAX_SCALE = 400; // pixels par seconde au plus : au-delà, les noms trop serrés sont omis
const TL_GRAB = 8; // pixels de part et d'autre de la ligne rouge où elle peut être saisie
const TL_PAN_THRESHOLD = 4; // pixels de glissement à partir desquels un clic devient un défilement
const TL_FOLLOW = 0.3; // en lecture, la tête de lecture reste à cette fraction de la largeur visible

/** Ce que la frise montre : les notes du fichier et le nom de ce qui est joué pour chacune. */
export interface TimelineModel {
  notes: Note[];
  /** Notes réellement jouées (les autres sont grisées). */
  used: Set<Note>;
  /**
   * Nom de l'accord ou de la note entendu, pour chaque note jouée, dans l'ordre du temps.
   * `written` : accord écrit dans le fichier ou choisi sur la frise, et non calculé.
   * `edited` : parmi eux, ceux choisis sur la frise.
   */
  labels: { start: number; name: string; written?: boolean; edited?: boolean }[];
  /** Mode accord : un nom n'est écrit que s'il diffère du précédent. */
  chords: boolean;
  duration: number;
  /** Parties du morceau (repères du fichier) : un trait et un nom à leur début. */
  sections: { start: number; name: string }[];
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
  private loopStart: number | null = null; // bornes de la boucle (s)
  private loopEnd: number | null = null;
  private pan: { x: number; scroll: number; moved: boolean } | null = null; // partition saisie à la souris
  private dragSeek = false; // un glissement au doigt déplace la lecture au lieu de faire défiler
  private bars: { x1: number; x2: number; y: number; used: boolean }[] = [];
  private barHeight = 2;
  private names: { x: number; name: string; start: number; written: boolean; edited: boolean }[] = [];
  private marks: { x: number; label: string }[] = [];
  private sections: { x: number; name: string }[] = [];
  private axisEnd = 0;
  private measure = document.createElement("canvas").getContext("2d")!;
  private widths = new Map<string, number>();
  private readonly lane: TabLane | null;

  constructor(
    private readonly scroller: HTMLElement,
    private readonly spacer: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    onSeek: (seconds: number) => void,
    /** Clic sur le nom d'un accord, donné par le début (s) de la note qui le porte. */
    onName: (start: number) => void,
    /** Double clic sur la ligne rouge : jouer ce qu'elle désigne. */
    onPlayheadDouble: () => void = () => {},
    /** Bande Simple Corde sous la frise (même défilement, même échelle) : son canevas. */
    tabCanvas?: HTMLCanvasElement,
  ) {
    this.measure.font = FONT_NAME; // largeur des noms ; celle des repères de l'axe est surestimée, sans gêne
    this.lane = tabCanvas ? new TabLane(tabCanvas) : null;
    this.spacer.style.height = `${TL_H + (tabCanvas ? TAB_H : 0)}px`;

    // `offsetX` compte depuis le bord gauche du canevas touché ; les deux sont alignés sur celui de la fenêtre
    const seek = (event: PointerEvent) => onSeek((scroller.scrollLeft + event.offsetX - TL_PAD) / this.scale);
    let tap = false; // doigt posé à l'arrêt : un simple toucher place la lecture, un glissement fait défiler
    let pressed: number | null = null; // nom d'accord sur lequel le bouton de la souris a été enfoncé
    for (const target of tabCanvas ? [canvas, tabCanvas] : [canvas]) {
      target.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        if (event.pointerType !== "mouse" && !this.dragSeek) {
          tap = true;
          return;
        }
        pressed = this.nameAt(event);
        if (pressed !== null) return; // le clic sur un accord le modifie, sans déplacer la lecture
        target.setPointerCapture(event.pointerId);
        if (event.pointerType === "mouse" && !this.dragSeek && !this.onPlayhead(event)) {
          // souris : saisir la partition ailleurs que sur la ligne rouge la fait glisser
          this.pan = { x: event.clientX, scroll: scroller.scrollLeft, moved: false };
          scroller.classList.add("panning");
          return;
        }
        this.held = true;
        seek(event);
      });
      target.addEventListener("pointermove", (event) => {
        if (this.held) seek(event);
        else if (this.pan) {
          const dx = event.clientX - this.pan.x;
          if (Math.abs(dx) > TL_PAN_THRESHOLD) this.pan.moved = true;
          if (this.pan.moved) scroller.scrollLeft = this.pan.scroll - dx;
        } else if (event.pointerType === "mouse") {
          target.style.cursor = this.onPlayhead(event) ? "ew-resize" : "grab";
        }
      });
      const release = (event: PointerEvent, cancelled: boolean) => {
        const name = cancelled ? null : this.nameAt(event);
        if (name !== null && (tap || name === pressed)) onName(name);
        else if (!cancelled && tap) seek(event);
        else if (!cancelled && this.pan && !this.pan.moved) seek(event); // simple clic : place la lecture
        tap = this.held = false;
        this.pan = null;
        pressed = null;
        scroller.classList.remove("panning");
      };
      target.addEventListener("pointerup", (event) => release(event, false));
      target.addEventListener("pointercancel", (event) => release(event, true));

      target.addEventListener("dblclick", (event) => {
        if (this.onPlayhead(event)) onPlayheadDouble();
      });
    }

    // La molette fait défiler la frise, quand elle dépasse de la fenêtre
    scroller.addEventListener(
      "wheel",
      (event) => {
        if (this.width <= this.viewWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
        event.preventDefault();
        scroller.scrollLeft += Math.sign(event.deltaY) * (this.viewWidth / 60);
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

  /** Le pointeur est sur la ligne rouge (ou assez près pour la saisir). */
  private onPlayhead(event: MouseEvent): boolean {
    if (this.playhead === null) return false;
    return Math.abs(this.x(this.playhead) - (this.scroller.scrollLeft + event.offsetX)) <= TL_GRAB;
  }

  /** Début (s) de l'accord dont le nom est sous le pointeur, en mode accord ; null ailleurs. */
  private nameAt(event: PointerEvent): number | null {
    if (event.target !== this.canvas || !this.model?.chords || event.offsetY < TL_NAME_TOP || event.offsetY > TL_NAME_BOTTOM) return null;
    const x = this.scroller.scrollLeft + event.offsetX;
    const hit = this.names.find((n) => x >= n.x - 3 && x <= n.x + this.textWidth(n.name) + 3);
    return hit ? hit.start : null;
  }

  /** En lecture, un glissement au doigt sur la frise déplace la lecture au lieu de la faire défiler. */
  setDragSeek(dragSeek: boolean): void {
    this.dragSeek = dragSeek;
    this.scroller.classList.toggle("drag-seek", dragSeek);
  }

  /** Bornes de la boucle (s) ; une seule peut être posée. */
  setLoop(start: number | null, end: number | null): void {
    this.loopStart = start;
    this.loopEnd = end;
    this.render();
  }

  setModel(model: TimelineModel | null): void {
    this.model = model;
    this.layout();
  }

  /** Notes de la bande Simple Corde. */
  setTab(notes: TabNote[], notation?: Notation, transpose?: number): void {
    this.lane?.setNotes(notes, notation, transpose);
  }

  scrollToStart(): void {
    this.scroller.scrollLeft = 0;
  }

  /** Redessine la frise telle quelle : les couleurs du thème ont changé. */
  redraw(): void {
    this.render();
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
    // Le zoom dépend des noms affichés (donc des pistes jouées) : on garde en place la tête de lecture
    // si elle est visible, sinon l'instant du bord gauche
    const left = Math.max(0, this.scroller.scrollLeft);
    const seen = this.playhead !== null ? this.x(this.playhead) - left : -1;
    const anchor =
      seen >= 0 && seen <= this.scroller.clientWidth
        ? { time: this.playhead!, offset: seen }
        : { time: Math.max(0, (left - TL_PAD) / this.scale), offset: 0 };
    this.viewWidth = this.scroller.clientWidth;
    this.bars = [];
    this.names = [];
    this.marks = [];
    this.sections = [];
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
    const [top, bottom] = [TL_TOP, TL_BOTTOM];
    let low = Infinity;
    let high = -Infinity;
    for (const n of model.notes) {
      low = Math.min(low, n.pitch);
      high = Math.max(high, n.pitch);
    }
    const span = Math.max(1, high - low);
    const bar = Math.max(3.0, Math.min(10.0, (bottom - top) / (span + 1)));
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
    for (const { start, name, written = false, edited = false } of model.labels) {
      const x = this.x(start);
      if (model.chords && name === last) continue;
      if (x < nextFree) {
        last = null; // pas la place : l'accord suivant sera affiché même s'il est identique
        continue;
      }
      this.names.push({ x, name, start, written, edited });
      nextFree = x + this.textWidth(name) + 6;
      last = name;
    }

    this.sections = model.sections.map(({ start, name }) => ({ x: this.x(start), name }));

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
    this.scroller.scrollLeft = Math.max(0, this.x(anchor.time) - anchor.offset);
    this.render();
  }

  /** Dessine la partie visible de la frise. */
  private render(): void {
    const ctx = prepare(this.canvas, this.viewWidth, TL_H);
    this.lane?.render({
      left: this.scroller.scrollLeft,
      width: this.viewWidth,
      x: (seconds) => this.x(seconds),
      playhead: this.model ? this.playhead : null,
      loop: this.loopStart !== null && this.loopEnd !== null ? [this.loopStart, this.loopEnd] : null,
    });
    if (!this.model) {
      text(ctx, this.viewWidth / 2, TL_H / 2, "Aucun fichier chargé", colors.muted, FONT_SMALL);
      return;
    }
    const left = this.scroller.scrollLeft;
    const right = left + this.viewWidth;
    const bottom = TL_BOTTOM;
    ctx.save();
    ctx.translate(-left, 0);

    if (this.loopStart !== null && this.loopEnd !== null) {
      ctx.fillStyle = colors.loop;
      ctx.fillRect(this.x(this.loopStart), 0, this.x(this.loopEnd) - this.x(this.loopStart), TL_H);
    }
    for (const bound of [this.loopStart, this.loopEnd]) {
      if (bound !== null) line(ctx, this.x(bound), 0, this.x(bound), TL_H, colors.note);
    }

    for (const used of [false, true]) {
      // les notes jouées sont dessinées par-dessus les notes écartées
      ctx.fillStyle = used ? colors.note : colors.noteOff;
      for (const b of this.bars) {
        if (b.x1 > right) break;
        if (b.used === used && b.x2 >= left) ctx.fillRect(b.x1, b.y, b.x2 - b.x1, this.barHeight);
      }
    }

    for (const { x, name } of this.sections) {
      if (x > right) break;
      line(ctx, x, TL_SECTION_Y - 6, x, bottom, colors.grid);
      text(ctx, x + 4, TL_SECTION_Y, name, colors.muted, FONT_SMALL_BOLD, "left");
    }

    // Un accord écrit se distingue d'un accord calculé par sa couleur, un accord choisi sur la frise par une autre
    for (const { x, name, written, edited } of this.names) {
      if (x > right) break;
      if (x + this.textWidth(name) < left) continue;
      text(ctx, x, TL_NAME_Y, name, edited ? colors.edited : written ? colors.accent : colors.text, FONT_NAME, "left");
    }

    line(ctx, TL_PAD, bottom + 3, this.axisEnd, bottom + 3, colors.border);
    for (const { x, label } of this.marks) {
      if (x > right) break;
      line(ctx, x, bottom + 3, x, bottom + 7, colors.grid);
      text(ctx, x + 2, TL_H - 7, label, colors.muted, FONT_SMALL, "left");
    }

    if (this.playhead !== null) {
      const x = this.x(this.playhead);
      line(ctx, x, 2, x, TL_H - 2, colors.accent, 2);
    }
    ctx.restore();
  }

  /** Place la tête de lecture et, si `follow`, fait défiler la frise pour la suivre. */
  movePlayhead(seconds: number, follow = true): void {
    this.playhead = seconds;
    if (follow && !this.held && !this.pan) {
      // pendant un clic maintenu ou un glissement de la partition, la frise ne bouge pas sous le pointeur
      this.scroller.scrollLeft = Math.max(0.0, this.x(seconds) - this.viewWidth * TL_FOLLOW);
    }
    this.render();
  }

  hidePlayhead(): void {
    this.playhead = null;
    this.render();
  }
}
