// ==============================================================================
// 3. INTERFACE (page web)
// ==============================================================================

import "./style.css";
import exampleMelody from "../examples/au_clair_de_la_lune.mid?url";
import exampleTracks from "../examples/au_clair_de_la_lune_3_pistes.mid?url";
import { AudioOutput, Playback, type PlaybackView } from "./audio";
import {
  CHORDS,
  DEFAULT_INSTRUMENT,
  INSTRUMENTS,
  MAX_STRUMS,
  MAX_TRANSPOSE,
  SCALES,
  SCALE_ROOTS,
  SEEK_STEP,
  harmonyMap,
  keyName,
  mod,
  noteName,
  scaleLabel,
  shiftToKey,
  transposedChordName,
  transposedKeyName,
  type Key,
  type Mode,
  type Notation,
} from "./guitar";
import {
  applyChords,
  chordNameOf,
  detectKey,
  generateProcessedMidi,
  guessMelodyPart,
  harmonize,
  keepHighestNotes,
  listParts,
  readMidiInput,
  setChord,
  uniformBeats,
  type ChordMark,
  type MidiInput,
  type Note,
  type Part,
} from "./logic";
import { MIDICSV_EXTENSIONS, writeMidicsvChords } from "./midicsv";
import type { LiveParams } from "./player";
import { STYLES, type StrumStyle } from "./styles";
import { refreshColors } from "./ui/canvas";
import { drawChord } from "./ui/chord";
import { setButton, setTheme, setupShell, shellBusy } from "./ui/shell";
import { Timeline } from "./ui/timeline";

function $<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const lblFile = $("lbl-file");
const fileInput = $<HTMLInputElement>("file-input");
const tracksBox = $<HTMLDetailsElement>("tracks");
const tracksList = $("tracks-list");
const cbScale = $<HTMLSelectElement>("cb-scale");
const lblFileKey = $("lbl-file-key");
const cbFileKey = $<HTMLSelectElement>("cb-file-key");
const lblTranspose = $("lbl-transpose");
const chkMelody = $<HTMLInputElement>("chk-melody");
const chkMono = $<HTMLInputElement>("chk-mono");
const chkChromatic = $<HTMLInputElement>("chk-chromatic");
const cbInstrument = $<HTMLSelectElement>("cb-instrument");
const cbStyle = $<HTMLSelectElement>("cb-style");
const spinTempo = $<HTMLInputElement>("spin-tempo");
const spinStrums = $<HTMLInputElement>("spin-strums");
const scaleSpeed = $<HTMLInputElement>("scale-speed");
const scaleStrumSpeed = $<HTMLInputElement>("scale-strum-speed");
const scaleVolume = $<HTMLInputElement>("scale-volume");
const lblChord = $("lbl-chord");
const lblChordSub = $("lbl-chord-sub");
const cvChord = $<HTMLCanvasElement>("cv-chord");
const lblStroke = $("lbl-stroke");
const btnPlay = $<HTMLButtonElement>("btn-play");
const btnPause = $<HTMLButtonElement>("btn-pause");
const btnStart = $<HTMLButtonElement>("btn-start");
const btnBack = $<HTMLButtonElement>("btn-back");
const btnForward = $<HTMLButtonElement>("btn-forward");
const seekButtons = [btnStart, btnBack, btnForward]; // grisés tant qu'aucun fichier n'est chargé
const btnLoopStart = $<HTMLButtonElement>("btn-loop-start");
const btnLoopEnd = $<HTMLButtonElement>("btn-loop-end");
const btnLoopClear = $<HTMLButtonElement>("btn-loop-clear");
const lblLoop = $("lbl-loop");
const tlScroll = $("tl-scroll");
const lblPosition = $("lbl-position");
const lblStatus = $("lbl-status");
const welcome = $("welcome");
const player = $("player");
const dialog = $<HTMLDialogElement>("dlg");
const dlgCancel = $("dlg-cancel");
const chordDialog = $<HTMLDialogElement>("dlg-chord");
const cbChordRoot = $<HTMLSelectElement>("cb-chord-root");
const cbChordSuffix = $<HTMLSelectElement>("cb-chord-suffix");

let playback: Playback | null = null;
let audio: AudioOutput | null = null; // sortie sonore ouverte au premier usage, puis réutilisée
let starting = false; // lecture demandée, échantillons de l'instrument en cours de chargement
let playRequest = 0;
let fileRequest = 0;
let frameId = 0;
let transpose = 0;
let songDuration = 0.0;
let inputFileName: string | null = null;
let computedNotes: Note[] = []; // toutes les notes du fichier, avec les accords calculés
let chordMarks: ChordMark[] = []; // accords écrits dans le fichier ou choisis sur la frise
let chordsDirty = false; // accords modifiés depuis l'ouverture du fichier ou leur enregistrement
let sourceText: string | null = null; // texte du fichier MIDICSV ouvert : les accords s'y enregistrent
let fileNotes: Note[] = []; // toutes les notes du fichier, accords écrits compris
// Accords affichés sur la frise : `chord` est la clé de CHORDS, `tick` le début de la note dans le fichier
let chordLabels: { start: number; name: string; chord: string; tick?: number }[] = [];
let parts: Part[] = [];
let enabledParts = new Set<string>(); // pistes cochées
let melodyPart: Part | null = null; // piste qui porte probablement la mélodie
let inputNotes: Note[] | null = null; // notes des pistes cochées : celles qui sont jouées et exportées
let detectedKey: Key | null = null; // tonalité détectée dans le fichier
let fileBeats: number[] = []; // temps du morceau lus dans le fichier
let fileBpm = 120; // tempo du fichier
let beatsPerBar = 4;
let tempoGrid: { bpm: number; beats: number[] } | null = null; // grille du tempo saisi à la main
let cursor = 0.0; // position (s) d'où part la lecture ; déplaçable à l'arrêt
let loopStart: number | null = null; // bornes de la boucle (s)
let loopEnd: number | null = null;
let melodySaved: boolean | null = null; // état de « Mélodie seule » avant le passage en Simple Corde
let lastStrums = 2;
let shownPosition = -1; // dernière position donnée à la frise

const STORAGE_KEY = "midiweb.settings.v2";
const MIN_LOOP = 0.1; // durée (s) en dessous de laquelle une boucle n'est pas jouée
const EXAMPLES = [
  { name: "au_clair_de_la_lune.mid", url: exampleMelody },
  { name: "au_clair_de_la_lune_3_pistes.mid", url: exampleTracks },
];

const timeline = new Timeline(
  tlScroll,
  $("tl-spacer"),
  $<HTMLCanvasElement>("cv-timeline"),
  (seconds) => seekTo(seconds, false),
  (start) => editChord(start),
);

function checked(name: string): string {
  return document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)!.value;
}

const mode = () => checked("mode") as Mode;
const notation = () => checked("notation") as Notation;
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
}

function showMessage(title: string, message: string, cancellable = false): void {
  $("dlg-title").textContent = title;
  $("dlg-text").textContent = message;
  dlgCancel.hidden = !cancellable;
  if (dialog.open) dialog.close();
  dialog.returnValue = "";
  dialog.showModal();
}

/** Message avec « Annuler » : vrai si OK est choisi, faux si le message est fermé autrement. */
function confirmMessage(title: string, message: string): Promise<boolean> {
  showMessage(title, message, true);
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
  });
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// --- Tonalité, transposition, notation ---------------------------------------

/** Tonalité choisie, sous sa clé de SCALE_HARMONY (le libellé affiché dépend de la notation). */
function scaleKey(): string {
  return SCALES[cbScale.selectedIndex];
}

function changeTranspose(delta: number): void {
  transpose = Math.max(-MAX_TRANSPOSE, Math.min(MAX_TRANSPOSE, transpose + delta));
  onHarmonyChange();
  saveSettings();
}

/** Tonalité du morceau : celle qui a été détectée, sauf si une autre est choisie dans la liste. */
function fileKey(): Key | null {
  if (detectedKey === null) return null;
  return cbFileKey.value ? SCALE_ROOTS[cbFileKey.value] : detectedKey;
}

function updateTransposeLabel(): void {
  const level = transpose ? signed(transpose) : "0";
  lblTranspose.textContent = `${level}  (${transposedKeyName(scaleKey(), transpose, notation())})`;
}

/** Demi-tons ajoutés aux notes du fichier pour le jouer dans la tonalité choisie. */
function keyShift(): number {
  const key = fileKey();
  return key ? shiftToKey(key, scaleKey()) : 0;
}

function updateFileKeyLabel(): void {
  if (detectedKey === null) {
    lblFileKey.textContent = "aucun fichier";
    return;
  }
  const shift = keyShift();
  lblFileKey.textContent = shift ? `transposé de ${signed(shift)} demi-tons` : "non transposé";
}

/** Liste des tonalités du morceau : la tonalité détectée d'abord, puis les 24 pour la corriger. */
function fillFileKeys(): void {
  const selected = cbFileKey.value;
  const auto = detectedKey
    ? `Détectée : ${keyName(detectedKey[0], detectedKey[1], notation())}`
    : "Détectée automatiquement";
  cbFileKey.replaceChildren(
    new Option(auto, ""),
    ...SCALES.map((k) => new Option(transposedKeyName(k, 0, notation()), k)),
  );
  cbFileKey.value = selected;
  cbFileKey.disabled = detectedKey === null;
}

function onHarmonyChange(): void {
  updateFileKeyLabel();
  updateTransposeLabel();
  drawTimeline();
}

/**
 * En Simple Corde, une seule note à la fois : « Mélodie seule » est cochée d'office et grisée,
 * puis retrouve son état au retour en mode accord.
 */
function onModeChange(): void {
  const single = mode() === "corde";
  if (single && melodySaved === null) {
    melodySaved = chkMelody.checked;
    chkMelody.checked = true;
  } else if (!single && melodySaved !== null) {
    chkMelody.checked = melodySaved;
    melodySaved = null;
  }
  chkMelody.disabled = single;
  updateStyleControls();
  drawTimeline();
}

// --- Style de strumming ------------------------------------------------------

/** Style joué : aucun en Simple Corde, ni avec « Classique » (N strums par note). */
function activeStyle(): StrumStyle | null {
  return mode() === "accord" ? (STYLES[cbStyle.value] ?? null) : null;
}

/**
 * Temps du morceau sur lesquels le style est joué : ceux du fichier, ou une grille régulière si
 * le tempo affiché a été modifié (fichier sans tempo fiable).
 */
function styleBeats(): readonly number[] {
  const bpm = Math.trunc(Number(spinTempo.value));
  const min = Number(spinTempo.min);
  if (!(bpm >= min && bpm <= Number(spinTempo.max)) || bpm === Math.round(fileBpm)) return fileBeats;
  if (tempoGrid?.bpm !== bpm) tempoGrid = { bpm, beats: uniformBeats(bpm, songDuration) };
  return tempoGrid.beats;
}

/** Le style ne concerne que le mode accord ; il remplace le nombre de strums par note. */
function updateStyleControls(): void {
  const style = activeStyle();
  cbStyle.disabled = mode() !== "accord";
  spinTempo.disabled = !style || !inputNotes;
  spinStrums.disabled = style !== null;
}

function fillScales(): void {
  const selected = Math.max(0, cbScale.selectedIndex);
  cbScale.replaceChildren(...SCALES.map((k) => new Option(scaleLabel(k, notation()))));
  cbScale.selectedIndex = selected;
}

/** Réécrit tout ce qui affiche un nom de note ; la tonalité choisie reste la même. */
function onNotationChange(): void {
  fillScales();
  fillFileKeys();
  onHarmonyChange();
  if (!playback) drawChord(cvChord, null, null, notation()); // noms des cordes ; en lecture, `pollPlayer` redessine
}

// --- Pistes ------------------------------------------------------------------

const partId = ({ track, channel }: { track: number; channel: number }) => `${track}:${channel}`;

/** Une case par piste du fichier ; la liste n'apparaît que s'il y en a plusieurs. */
function fillTracks(): void {
  tracksBox.hidden = parts.length < 2;
  tracksList.replaceChildren(
    ...parts.map((part) => {
      const label = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.value = partId(part);
      box.checked = enabledParts.has(box.value);
      const name = part.name || `Piste ${part.track + 1}`;
      label.append(box, ` ${name} (canal ${part.channel + 1}, ${part.count} notes)`);
      return label;
    }),
  );
}

function fileStatus(): string {
  const status = `${inputNotes?.length ?? 0} notes détectées | Durée totale : ${songDuration.toFixed(2)}s`;
  const written = chordMarks.filter((m) => m.chord).length;
  if (!written && !chordsDirty) return status;
  return `${status} | ${written} accords écrits${chordsDirty ? " (non enregistrés)" : ""}`;
}

/** Les pistes cochées ont changé : elles seules sont jouées, y compris par la lecture en cours. */
function onTracksChange(): void {
  inputNotes = fileNotes.filter((n) => enabledParts.has(partId(n)));
  $("lbl-tracks").textContent = `Pistes jouées : ${enabledParts.size} sur ${parts.length}`;
  playback?.setNotes(inputNotes);
  if (!playback && !starting) lblStatus.textContent = fileStatus();
  drawTimeline();
}

function setTracks(enabled: Part[]): void {
  enabledParts = new Set(enabled.map(partId));
  for (const box of tracksList.querySelectorAll("input")) box.checked = enabledParts.has(box.value);
  onTracksChange();
}

// --- Frise du morceau --------------------------------------------------------

function drawTimeline(): void {
  if (!inputNotes) {
    timeline.setModel(null);
    return;
  }
  const used = chkMelody.checked ? keepHighestNotes(inputNotes) : inputNotes;

  // Ce qu'on entend réellement (tonalité et transposition comprises) : l'accord en mode accord ;
  // en Simple Corde, la note, écrite comme l'accord qu'elle porte dans la tonalité (Mi -> Mim),
  // ou seule si elle est hors tonalité
  const chords = mode() === "accord";
  const harmony = harmonyMap(scaleKey(), chkChromatic.checked);
  const shift = keyShift();
  let mark = 0; // premier accord écrit qui commence après la note
  const labels = used.map((n) => {
    const pitch = n.pitch + shift;
    const chord: string | undefined = chords ? chordNameOf(n, harmony, shift) : harmony[mod(pitch, 12)];
    const name = chord
      ? transposedChordName(chord, transpose, notation())
      : noteName(pitch + transpose, notation());
    while (mark < chordMarks.length && chordMarks[mark].seconds <= n.start + 1e-9) mark++;
    const written = chords && mark > 0 && chordMarks[mark - 1].chord !== null;
    return { start: n.start, name, written, chord: chord ?? "", tick: n.tick };
  });
  chordLabels = chords ? labels : [];
  // Les notes des pistes décochées restent dessinées, grisées
  timeline.setModel({ notes: fileNotes, used: new Set(used), labels, chords, duration: songDuration });
}

// --- Accords écrits ----------------------------------------------------------

/** Les accords écrits ont changé : la frise et la lecture en cours les prennent tout de suite. */
function setChordMarks(marks: ChordMark[]): void {
  chordMarks = marks;
  chordsDirty = true;
  fileNotes = applyChords(computedNotes, chordMarks);
  onTracksChange();
}

/**
 * Change l'accord dont le nom a été cliqué sur la frise, jusqu'au changement d'accord suivant.
 * L'accord se choisit tel qu'il est affiché et entendu ; il est retenu dans la tonalité du fichier,
 * comme s'il y était écrit.
 */
function editChord(start: number): void {
  const index = chordLabels.findIndex((l) => l.start === start);
  const label = chordLabels[index];
  if (label?.tick === undefined) return;
  const next = chordLabels.slice(index + 1).find((l) => l.name !== label.name && l.tick !== undefined);
  const [, root, suffix] = CHORDS[label.chord];
  cbChordRoot.replaceChildren(...Array.from({ length: 12 }, (_, i) => new Option(noteName(i, notation()), String(i))));
  cbChordRoot.value = String(mod(root + transpose, 12));
  cbChordSuffix.value = suffix;
  $("dlg-chord-text").textContent = next
    ? `De ${formatTime(label.start)} à ${formatTime(next.start)}.`
    : `De ${formatTime(label.start)} à la fin du morceau.`;
  const request = fileRequest;
  chordDialog.returnValue = "";
  chordDialog.showModal();
  chordDialog.addEventListener(
    "close",
    () => {
      const choice = chordDialog.returnValue;
      if ((choice !== "ok" && choice !== "auto") || request !== fileRequest) return; // annulé, ou autre fichier déposé
      const picked = [mod(Number(cbChordRoot.value) - transpose - keyShift(), 12), cbChordSuffix.value] as const;
      const from = { tick: label.tick!, seconds: label.start };
      const to = next ? { tick: next.tick!, seconds: next.start } : null;
      setChordMarks(setChord(chordMarks, from, to, choice === "ok" ? picked : null));
    },
    { once: true },
  );
}

// --- Ce qui est joué ---------------------------------------------------------

function updateNowPlaying(view: PlaybackView): void {
  const d = view.display;
  if (d === null) {
    // rien de frappé depuis le lancement ou le dernier déplacement
    clearNowPlaying(view.lit);
    return;
  }
  const t = d.transpose;
  let title: string;
  let modeName: string;
  let shape = "";
  let stroke = "";
  if (d.mode === "accord") {
    title = transposedChordName(d.chord, t, notation());
    modeName = "Accord 6 cordes";
    shape = `forme ${transposedChordName(d.chord, 0, notation())}`;
    stroke = d.up ? "↑ coup vers le haut" : "↓ coup vers le bas";
  } else {
    title = noteName(d.pitch, notation());
    modeName = "Simple corde";
  }
  // Transposé, le doigté affiché reste celui de la forme d'origine : capo vers l'aigu,
  // guitare accordée plus bas vers le grave
  const shift = t > 0 ? `capo ${t}` : t < 0 ? `accordé ${t} demi-tons` : "";
  const detail = [t ? shape : "", shift].filter(Boolean).join(", ");
  lblChord.textContent = title;
  lblChordSub.textContent = `${modeName}\n${detail}`;
  lblStroke.textContent = stroke;
  drawChord(cvChord, d, view.lit, notation());
}

function clearNowPlaying(lit: boolean[] | null = null): void {
  lblChord.textContent = "—";
  lblChordSub.textContent = "\n";
  lblStroke.textContent = "";
  drawChord(cvChord, null, lit, notation());
}

function showPosition(seconds: number): void {
  lblPosition.textContent = `${formatTime(seconds)} / ${formatTime(songDuration)}`;
}

/** Position de départ à l'arrêt : écrite, et marquée sur la frise. */
function showCursor(follow = false): void {
  showPosition(cursor);
  if (inputNotes) timeline.movePlayhead(cursor, follow);
  else timeline.hidePlayhead();
}

/** Déplace la lecture en cours ou, à l'arrêt, la position d'où partira la prochaine lecture. */
function seekTo(seconds: number, follow = true): void {
  if (playback) {
    playback.seekTo(seconds);
  } else if (inputNotes) {
    cursor = Math.min(songDuration, Math.max(0.0, seconds));
    showCursor(follow);
  }
}

function seekBy(delta: number): void {
  if (playback) playback.seek(delta);
  else seekTo(cursor + delta);
}

/** Boutons actifs selon l'état : déplacement et boucle dès qu'un fichier est chargé, pause en lecture. */
function updateTransport(): void {
  const loaded = inputNotes !== null;
  for (const button of [...seekButtons, btnLoopStart, btnLoopEnd]) button.disabled = !loaded;
  btnPause.disabled = !playback;
  timeline.setDragSeek(playback !== null);
  tlScroll.classList.toggle("seekable", loaded);
}

function resetDisplay(): void {
  setButton(btnPlay, "play", "Écouter");
  setButton(btnPause, "pause", "Pause");
  shownPosition = -1;
  updateTransport();
  showCursor();
  clearNowPlaying();
}

// --- Boucle ------------------------------------------------------------------

/** Boucle jouée : il faut ses deux bornes, assez écartées. */
function loopRange(): readonly [number, number] | null {
  if (loopStart === null || loopEnd === null || loopEnd - loopStart < MIN_LOOP) return null;
  return [loopStart, loopEnd];
}

function updateLoop(): void {
  const time = (bound: number | null) => (bound === null ? "…" : formatTime(bound));
  timeline.setLoop(loopStart, loopEnd);
  lblLoop.textContent = loopStart === null && loopEnd === null ? "aucune" : `${time(loopStart)} – ${time(loopEnd)}`;
  btnLoopClear.disabled = loopStart === null && loopEnd === null;
}

/** Pose une borne de la boucle à la position courante (celle qu'on entend, en lecture). */
function setLoopBound(end: boolean): void {
  if (!inputNotes) return;
  const position = playback ? playback.view().position : cursor;
  if (end) loopEnd = position;
  else loopStart = position;
  if (loopStart !== null && loopEnd !== null && loopStart > loopEnd) [loopStart, loopEnd] = [loopEnd, loopStart];
  updateLoop();
}

function clearLoop(): void {
  loopStart = loopEnd = null;
  updateLoop();
}

// --- Fichier, lecture, export ------------------------------------------------

/** Tant qu'aucun fichier n'est ouvert, l'accueil tient la place du lecteur. */
function showPlayer(loaded: boolean): void {
  welcome.hidden = loaded;
  player.hidden = !loaded;
}

async function loadExample(index: number): Promise<void> {
  const { name, url } = EXAMPLES[index];
  let bytes: ArrayBuffer;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    bytes = await response.arrayBuffer();
  } catch (e) {
    showMessage("Erreur", `Impossible de charger l'exemple : ${errorText(e)}`);
    return;
  }
  await loadFile(new File([bytes], name));
}

async function loadFile(file: File): Promise<void> {
  const request = ++fileRequest;
  stopAudio(true);
  timeline.scrollToStart();
  let input: MidiInput;
  let text: string | null = null;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (request !== fileRequest) return; // un autre fichier a été choisi entre-temps
    input = readMidiInput(file.name, bytes);
    const isCsv = MIDICSV_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));
    if (isCsv) text = new TextDecoder("utf-8").decode(bytes);
  } catch (e) {
    closeFile();
    showMessage("Erreur", `Impossible de lire le fichier : ${errorText(e)}`);
    return;
  }
  if (!input.notes.length) {
    closeFile();
    showMessage(
      "Fichier sans note",
      `« ${file.name} » ne contient aucune note jouable (les percussions du canal 10 sont ignorées).`,
    );
    return;
  }
  inputFileName = file.name;
  // Les accords sont lus dans toutes les pistes, cochées ou non ; ceux qui sont écrits l'emportent
  computedNotes = harmonize(input.notes);
  chordMarks = input.chords;
  chordsDirty = false;
  sourceText = text;
  fileNotes = applyChords(computedNotes, chordMarks);
  parts = listParts(input);
  // Plusieurs pistes jouées ensemble se superposent : seule la mélodie probable est cochée d'office
  melodyPart = guessMelodyPart(input);
  enabledParts = new Set((melodyPart ? [melodyPart] : parts).map(partId));
  // La tonalité est cherchée dans tout le fichier : elle ne change pas avec les pistes cochées
  detectedKey = detectKey(fileNotes);
  songDuration = Math.max(...fileNotes.map((n) => n.start + n.duration));
  fileBeats = input.beats;
  fileBpm = input.bpm;
  beatsPerBar = input.beatsPerBar;
  lblFile.textContent = file.name;
  lblFile.classList.remove("muted");
  showPlayer(true); // avant de dessiner : la frise prend la largeur disponible
  openFile();
}

/** Remet à zéro ce qui dépend du fichier (position, boucle, tonalité corrigée), puis l'affiche. */
function openFile(): void {
  cursor = 0.0;
  tempoGrid = null;
  spinTempo.value = String(Math.round(fileBpm));
  cbFileKey.value = "";
  fillFileKeys();
  fillTracks();
  tracksBox.open = parts.length > 1; // ouverte : on voit quelle piste a été retenue
  clearLoop();
  onTracksChange();
  onHarmonyChange();
  updateTransport();
  updateStyleControls();
  showCursor();
}

/** Fichier illisible ou vide : on ne garde pas les notes du fichier précédent. */
function closeFile(): void {
  inputFileName = null;
  computedNotes = [];
  chordMarks = [];
  chordsDirty = false;
  sourceText = null;
  fileNotes = [];
  parts = [];
  melodyPart = null;
  enabledParts = new Set();
  detectedKey = null;
  songDuration = 0.0;
  fileBeats = [];
  fileBpm = 120;
  beatsPerBar = 4;
  lblFile.textContent = "Aucun fichier sélectionné";
  lblFile.classList.add("muted");
  openFile();
  inputNotes = null;
  showPlayer(false);
  lblStatus.textContent = "En attente d'un fichier...";
  drawTimeline();
  updateTransport();
  updateStyleControls();
  showCursor();
}

/** Nombre de strums saisi, borné à 1..MAX_STRUMS ; dernière valeur valide si la saisie est invalide. */
function getStrums(): number {
  const value = Number(spinStrums.value);
  if (spinStrums.value.trim() !== "" && Number.isFinite(value)) {
    lastStrums = Math.max(1, Math.min(MAX_STRUMS, Math.trunc(value)));
  }
  return lastStrums;
}

/** Relit les réglages de l'interface pour le moteur de lecture. */
function readLiveParams(): LiveParams {
  return {
    mode: mode(),
    scale: scaleKey(),
    speed: Number(scaleSpeed.value),
    delayMs: Number(scaleStrumSpeed.value),
    strums: getStrums(),
    melody: chkMelody.checked,
    transpose,
    keyShift: keyShift(),
    program: INSTRUMENTS[cbInstrument.value],
    mono: chkMono.checked,
    chromatic: chkChromatic.checked,
    loop: loopRange(),
    style: activeStyle(),
    beats: styleBeats(),
    beatsPerBar,
  };
}

function toggleAudio(): void {
  if (playback || starting) stopAudio();
  else void playAudio();
}

/** Suspend ou reprend la lecture, sans revenir au début. */
function togglePause(): void {
  if (!playback) return;
  if (playback.paused) playback.resume();
  else playback.pause();
  if (playback.paused) setButton(btnPause, "play", "Reprendre");
  else setButton(btnPause, "pause", "Pause");
}

async function playAudio(): Promise<void> {
  stopAudio(true);
  if (!inputNotes) {
    showMessage("Attention", "Veuillez d'abord sélectionner un fichier MIDI valide.");
    return;
  }
  if (!inputNotes.length) {
    showMessage("Attention", "Aucune piste n'est cochée : il n'y a rien à jouer.");
    return;
  }

  const request = ++playRequest;
  const status = lblStatus.textContent;
  starting = true;
  setButton(btnPlay, "stop", "Arrêter");
  lblStatus.textContent = "Chargement du son...";
  try {
    audio ??= new AudioOutput(volume());
    await audio.prepare(INSTRUMENTS[cbInstrument.value]);
    if (request !== playRequest) return; // arrêtée pendant le chargement
    // La lecture part de la position choisie à l'arrêt (du début, si c'est la fin du morceau)
    playback = new Playback(inputNotes, readLiveParams, audio, cursor < songDuration ? cursor : 0.0, songDuration);
  } catch (e) {
    if (request !== playRequest) return;
    starting = false;
    resetDisplay();
    lblStatus.textContent = status;
    showMessage("Erreur Audio", `Échec de la lecture audio : ${errorText(e)}`);
    return;
  }
  starting = false;
  updateTransport();
  frameId = requestAnimationFrame(pollPlayer);
}

function pollPlayer(): void {
  frameId = 0;
  if (!playback) return;
  const view = playback.view();
  if (view.finished) {
    lblStatus.textContent = "Lecture terminée.";
    playback = null;
    resetDisplay();
    return;
  }
  const p = readLiveParams();
  const modeName = p.mode === "accord" ? "Accord 6 cordes" : "Simple corde";
  const state = `${modeName} | x${p.speed.toFixed(2)} | ${p.style ? p.style.label : `${p.strums} strums`}`;
  lblStatus.textContent = playback.paused ? `En pause | ${state}` : state;
  showPosition(view.position);
  // En pause, la frise ne suit la tête de lecture que si elle bouge : on peut la parcourir librement
  if (!playback.paused || view.position !== shownPosition) timeline.movePlayhead(view.position);
  shownPosition = view.position;
  updateNowPlaying(view);
  frameId = requestAnimationFrame(pollPlayer);
}

function stopAudio(silent = false): void {
  if (frameId) {
    cancelAnimationFrame(frameId);
    frameId = 0;
  }
  playRequest++; // annule une lecture encore en chargement
  if (playback || starting) {
    playback?.stop();
    playback = null;
    starting = false;
    resetDisplay();
    if (!silent) lblStatus.textContent = "Lecture arrêtée.";
  }
}

function exportMidi(): void {
  if (!inputNotes || !inputFileName) {
    showMessage("Attention", "Veuillez d'abord sélectionner un fichier MIDI valide.");
    return;
  }
  if (!inputNotes.length) {
    showMessage("Attention", "Aucune piste n'est cochée : il n'y a rien à exporter.");
    return;
  }
  const { midi } = generateProcessedMidi(chkMelody.checked ? keepHighestNotes(inputNotes) : inputNotes, {
    mode: mode(),
    scaleKey: scaleKey(),
    strumsCount: getStrums(),
    speedFactor: Number(scaleSpeed.value),
    strumDelayMs: Number(scaleStrumSpeed.value),
    transpose,
    keyShift: keyShift(),
    program: INSTRUMENTS[cbInstrument.value],
    mono: chkMono.checked,
    chromatic: chkChromatic.checked,
    style: activeStyle(),
    beats: styleBeats(),
    beatsPerBar,
  });

  const name = `${inputFileName.replace(/\.[^.]*$/, "")}_strum.mid`;
  download(new Blob([midi], { type: "audio/midi" }), name);
  showMessage("Succès", `Fichier MIDI exporté avec succès :\n${name}`);
}

/** Le navigateur enregistre le fichier dans son dossier de téléchargements. */
function download(blob: Blob, name: string): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

/** Télécharge le fichier MIDICSV ouvert avec les accords écrits ; le reste du fichier est inchangé. */
function saveCsv(): void {
  if (!inputNotes || !inputFileName) {
    showMessage("Attention", "Veuillez d'abord sélectionner un fichier MIDI valide.");
    return;
  }
  if (sourceText === null) {
    showMessage(
      "Attention",
      "Les accords ne s'enregistrent que dans un fichier MIDICSV (.csv, .txt) : le fichier ouvert est un fichier MIDI.",
    );
    return;
  }
  const text = writeMidicsvChords(sourceText, chordMarks, ([root, suffix]) => noteName(root, notation()) + suffix);
  download(new Blob([text], { type: "text/csv" }), inputFileName);
  chordsDirty = false;
  if (!playback && !starting) lblStatus.textContent = fileStatus();
  showMessage("Succès", `Accords enregistrés dans le fichier :\n${inputFileName}`);
}

// --- Réglages retenus d'une visite à l'autre ---------------------------------

const volume = () => Number(scaleVolume.value) / 100;
const browse = () => fileInput.click();

/** Les réglages affichés, sous la forme retenue d'une visite à l'autre. */
function readSettings(): Record<string, unknown> {
  return {
    scale: scaleKey(),
    transpose,
    mode: mode(),
    melody: melodySaved ?? chkMelody.checked, // en Simple Corde, la case est cochée d'office
    mono: chkMono.checked,
    chromatic: chkChromatic.checked,
    notation: notation(),
    instrument: cbInstrument.value,
    style: cbStyle.value,
    strums: getStrums(),
    speed: Number(scaleSpeed.value),
    delayMs: Number(scaleStrumSpeed.value),
    volume: Number(scaleVolume.value),
  };
}

function saveSettings(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(readSettings()));
  } catch {
    // stockage refusé (navigation privée, réglage du navigateur) : les réglages ne sont pas retenus
  }
}

function pickRadio(name: string, value: unknown): void {
  for (const radio of document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)) {
    if (radio.value === value) radio.checked = true;
  }
}

let defaultSettings: Record<string, unknown> = {}; // réglages d'origine, relevés dans la page au démarrage

/** Remplit la liste des tonalités et applique les réglages donnés, pour ceux qui sont lisibles. */
function applySettings(saved: Record<string, unknown>): void {
  const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const check = (box: HTMLInputElement, value: unknown) => {
    if (typeof value === "boolean") box.checked = value;
  };
  // Un curseur ramène de lui-même une valeur hors de ses bornes
  const slide = (input: HTMLInputElement, value: unknown) => {
    if (number(value) !== null) input.value = String(value);
  };

  pickRadio("notation", saved.notation);
  fillScales();
  const scale = SCALES.indexOf(saved.scale as string);
  if (scale >= 0) cbScale.selectedIndex = scale;
  transpose = Math.max(-MAX_TRANSPOSE, Math.min(MAX_TRANSPOSE, Math.trunc(number(saved.transpose) ?? 0)));
  pickRadio("mode", saved.mode);
  check(chkMelody, saved.melody);
  check(chkMono, saved.mono);
  check(chkChromatic, saved.chromatic);
  if (typeof saved.instrument === "string" && saved.instrument in INSTRUMENTS) cbInstrument.value = saved.instrument;
  // "" : le style « Classique », qui n'est pas dans STYLES
  if (typeof saved.style === "string" && (saved.style === "" || saved.style in STYLES)) cbStyle.value = saved.style;
  const strums = number(saved.strums);
  if (strums !== null) spinStrums.value = String(Math.max(1, Math.min(MAX_STRUMS, Math.trunc(strums))));
  slide(scaleSpeed, saved.speed);
  slide(scaleStrumSpeed, saved.delayMs);
  slide(scaleVolume, saved.volume);
}

/** Reprend les réglages de la dernière visite, s'ils sont lisibles. */
function restoreSettings(): void {
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (typeof parsed === "object" && parsed !== null) saved = parsed as Record<string, unknown>;
  } catch {
    // stockage refusé ou contenu illisible : réglages par défaut
  }
  applySettings(saved);
}

/** Valeur des curseurs, écrite à côté. */
function showSliders(): void {
  $("out-speed").textContent = `x${Number(scaleSpeed.value).toFixed(2)}`;
  $("out-strum-speed").textContent = scaleStrumSpeed.value;
  $("out-volume").textContent = `${scaleVolume.value} %`;
}

/** Tout revient aux réglages d'origine, thème compris ; le fichier ouvert et la lecture restent. */
async function resetSettings(): Promise<void> {
  const confirmed = await confirmMessage(
    "Réinitialiser les réglages",
    "Tous les réglages reprennent leur valeur d'origine. Le fichier ouvert est conservé.",
  );
  if (!confirmed) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // stockage refusé : aucun réglage n'était retenu
  }
  melodySaved = null;
  applySettings(defaultSettings);
  setTheme("system");
  showSliders();
  audio?.setVolume(volume());
  onModeChange();
  onNotationChange();
}

// --- Clavier -----------------------------------------------------------------

// Espace garde son rôle sur une case, une liste, le titre d'une rubrique, et sur les boutons de la
// barre et de l'accueil, qui n'ont rien à voir avec la lecture
const KEEPS_SPACE = 'input[type="checkbox"], input[type="radio"], select, summary, .bar, .welcome';

/** Espace : écouter, puis pause et reprise. Flèches : reculer et avancer. Début : retour au début. */
function onKeyDown(event: KeyboardEvent): void {
  if (event.ctrlKey || event.altKey || event.metaKey || shellBusy()) return;
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (event.key === " ") {
    if (target?.closest(KEEPS_SPACE)) return;
    event.preventDefault(); // ni défilement de la page, ni clic sur le bouton qui a le focus
    if (event.repeat) return;
    if (playback) togglePause();
    else if (inputNotes && !starting) void playAudio();
    return;
  }
  // Les flèches gardent leur rôle dans un champ, un curseur ou une liste
  if (!inputNotes || target?.closest("input, select")) return;
  if (event.key === "ArrowLeft") seekBy(-SEEK_STEP);
  else if (event.key === "ArrowRight") seekBy(SEEK_STEP);
  else if (event.key === "Home") seekTo(0.0);
  else return;
  event.preventDefault();
}

// --- Mise en place -----------------------------------------------------------

function setupUi(): void {
  cbInstrument.replaceChildren(...Object.keys(INSTRUMENTS).map((name) => new Option(name)));
  cbInstrument.value = DEFAULT_INSTRUMENT;
  cbStyle.replaceChildren(
    new Option("Classique (strums par note)", ""),
    ...Object.entries(STYLES).map(([id, style]) => new Option(style.label, id)),
  );
  fillScales();
  defaultSettings = readSettings(); // ceux de index.html, avant de reprendre ceux de la dernière visite
  restoreSettings();
  fillFileKeys();
  setupShell({
    open: browse,
    exportMidi,
    saveCsv,
    loadExample: (index) => void loadExample(index),
    reset: () => void resetSettings(),
    // Les canevas sont redessinés aux couleurs du thème ; en lecture, `pollPlayer` redessine l'accord
    onTheme: () => {
      refreshColors();
      timeline.redraw();
      if (!playback) clearNowPlaying();
    },
  });
  // Tout réglage modifié est retenu pour la prochaine visite
  document.querySelector(".settings")!.addEventListener("change", saveSettings);

  cbScale.addEventListener("change", onHarmonyChange);
  cbFileKey.addEventListener("change", onHarmonyChange);
  cbStyle.addEventListener("change", updateStyleControls);
  chkChromatic.addEventListener("change", drawTimeline);
  tracksList.addEventListener("change", () => {
    enabledParts = new Set([...tracksList.querySelectorAll("input")].filter((b) => b.checked).map((b) => b.value));
    onTracksChange();
  });
  $("btn-tracks-melody").addEventListener("click", () => setTracks(melodyPart ? [melodyPart] : parts));
  $("btn-tracks-all").addEventListener("click", () => setTracks(parts));
  $("btn-tracks-none").addEventListener("click", () => setTracks([]));
  $("btn-transpose-down").addEventListener("click", () => changeTranspose(-1));
  $("btn-transpose-up").addEventListener("click", () => changeTranspose(1));
  for (const radio of document.querySelectorAll('input[name="mode"]')) {
    radio.addEventListener("change", onModeChange);
  }
  chkMelody.addEventListener("change", drawTimeline);
  for (const radio of document.querySelectorAll('input[name="notation"]')) {
    radio.addEventListener("change", onNotationChange);
  }

  scaleSpeed.addEventListener("input", showSliders);
  // La vitesse est sous la frise, hors du panneau des réglages dont les changements sont retenus
  scaleSpeed.addEventListener("change", saveSettings);
  spinStrums.addEventListener("change", saveSettings);
  $("btn-speed-reset").addEventListener("click", () => {
    scaleSpeed.value = "1";
    showSliders();
    saveSettings();
  });
  scaleStrumSpeed.addEventListener("input", showSliders);
  scaleVolume.addEventListener("input", () => {
    showSliders();
    audio?.setVolume(volume());
  });
  showSliders();

  $("btn-browse").addEventListener("click", browse);
  $("btn-welcome-open").addEventListener("click", browse);
  $("btn-welcome-example").addEventListener("click", () => void loadExample(0));
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = ""; // le même fichier peut être rechoisi
    if (file) void loadFile(file);
  });
  // Un fichier peut aussi être déposé sur la page
  window.addEventListener("dragover", (event) => {
    event.preventDefault();
    document.body.classList.add("dropping");
  });
  window.addEventListener("dragleave", () => document.body.classList.remove("dropping"));
  window.addEventListener("drop", (event) => {
    event.preventDefault();
    document.body.classList.remove("dropping");
    const file = event.dataTransfer?.files[0];
    if (file) void loadFile(file);
  });

  setButton(btnBack, "back", `-${SEEK_STEP} s`);
  setButton(btnForward, "forward", `+${SEEK_STEP} s`);
  btnStart.addEventListener("click", () => seekTo(0.0));
  btnBack.addEventListener("click", () => seekBy(-SEEK_STEP));
  btnForward.addEventListener("click", () => seekBy(SEEK_STEP));
  btnLoopStart.addEventListener("click", () => setLoopBound(false));
  btnLoopEnd.addEventListener("click", () => setLoopBound(true));
  btnLoopClear.addEventListener("click", clearLoop);
  // Un seul bouton : « Écouter » à l'arrêt, « Arrêter » pendant la lecture
  btnPlay.addEventListener("click", toggleAudio);
  btnPause.addEventListener("click", togglePause);
  $("btn-export").addEventListener("click", exportMidi);
  window.addEventListener("keydown", onKeyDown);
  // Firefox clique le bouton qui a le focus au relâchement d'Espace
  window.addEventListener("keyup", (event) => {
    if (event.key !== " " || !(event.target instanceof HTMLButtonElement) || shellBusy()) return;
    if (!event.target.closest(KEEPS_SPACE)) event.preventDefault();
  });

  updateTransport();
  updateLoop();
  showPosition(0.0);
  onModeChange(); // Simple Corde au démarrage : « Mélodie seule » cochée et grisée
  onHarmonyChange();
  clearNowPlaying();
}

setupUi();
