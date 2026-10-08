// ==============================================================================
// 3. INTERFACE (page web)
// ==============================================================================

import "./style.css";
import { AudioOutput, Playback, type PlaybackView } from "./audio";
import {
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
  detectKey,
  generateProcessedMidi,
  guessMelodyPart,
  keepHighestNotes,
  listParts,
  readMidiInput,
  uniformBeats,
  type MidiInput,
  type Note,
  type Part,
} from "./logic";
import type { LiveParams } from "./player";
import { STYLES, type StrumStyle } from "./styles";
import { drawChord } from "./ui/chord";
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
const dialog = $<HTMLDialogElement>("dlg");

let playback: Playback | null = null;
let audio: AudioOutput | null = null; // sortie sonore ouverte au premier usage, puis réutilisée
let starting = false; // lecture demandée, échantillons de l'instrument en cours de chargement
let playRequest = 0;
let fileRequest = 0;
let frameId = 0;
let transpose = 0;
let songDuration = 0.0;
let inputFileName: string | null = null;
let fileNotes: Note[] = []; // toutes les notes du fichier
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

const timeline = new Timeline(tlScroll, $("tl-spacer"), $<HTMLCanvasElement>("cv-timeline"), (seconds) =>
  seekTo(seconds, false),
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

function showMessage(title: string, message: string): void {
  $("dlg-title").textContent = title;
  $("dlg-text").textContent = message;
  if (dialog.open) dialog.close();
  dialog.showModal();
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
  return `${inputNotes?.length ?? 0} notes détectées | Durée totale : ${songDuration.toFixed(2)}s`;
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
  const labels = used.map((n) => {
    const pitch = n.pitch + shift;
    const chord: string | undefined = harmony[mod(pitch, 12)];
    const name =
      chord || chords
        ? transposedChordName(chord ?? "Lam", transpose, notation())
        : noteName(pitch + transpose, notation());
    return { start: n.start, name };
  });
  // Les notes des pistes décochées restent dessinées, grisées
  timeline.setModel({ notes: fileNotes, used: new Set(used), labels, chords, duration: songDuration });
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
  btnPlay.textContent = "▶ Écouter";
  btnPause.textContent = "⏸ Pause";
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

async function loadFile(file: File): Promise<void> {
  const request = ++fileRequest;
  stopAudio(true);
  timeline.scrollToStart();
  let input: MidiInput;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (request !== fileRequest) return; // un autre fichier a été choisi entre-temps
    input = readMidiInput(file.name, bytes);
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
  fileNotes = input.notes;
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
  btnPause.textContent = playback.paused ? "▶ Reprendre" : "⏸ Pause";
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
  btnPlay.textContent = "⏹ Arrêter";
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

  // Le navigateur enregistre le fichier dans son dossier de téléchargements
  const name = `${inputFileName.replace(/\.[^.]*$/, "")}_strum.mid`;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([midi], { type: "audio/midi" }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  showMessage("Succès", `Fichier MIDI exporté avec succès :\n${name}`);
}

// --- Réglages retenus d'une visite à l'autre ---------------------------------

const volume = () => Number(scaleVolume.value) / 100;

function saveSettings(): void {
  const settings = {
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // stockage refusé (navigation privée, réglage du navigateur) : les réglages ne sont pas retenus
  }
}

function pickRadio(name: string, value: unknown): void {
  for (const radio of document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)) {
    if (radio.value === value) radio.checked = true;
  }
}

/** Remplit la liste des tonalités et reprend les réglages de la dernière visite, s'ils sont lisibles. */
function restoreSettings(): void {
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (typeof parsed === "object" && parsed !== null) saved = parsed as Record<string, unknown>;
  } catch {
    // stockage refusé ou contenu illisible : réglages par défaut
  }
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
  if (typeof saved.style === "string" && saved.style in STYLES) cbStyle.value = saved.style;
  const strums = number(saved.strums);
  if (strums !== null) spinStrums.value = String(Math.max(1, Math.min(MAX_STRUMS, Math.trunc(strums))));
  slide(scaleSpeed, saved.speed);
  slide(scaleStrumSpeed, saved.delayMs);
  slide(scaleVolume, saved.volume);
}

// --- Clavier -----------------------------------------------------------------

/** Espace : écouter, puis pause et reprise. Flèches : reculer et avancer. Début : retour au début. */
function onKeyDown(event: KeyboardEvent): void {
  if (event.ctrlKey || event.altKey || event.metaKey || dialog.open) return;
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (event.key === " ") {
    // Espace garde son rôle sur une case, une liste ou le titre des pistes
    if (target?.closest('input[type="checkbox"], input[type="radio"], select, summary')) return;
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
  restoreSettings();
  fillFileKeys();
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

  // Valeur des curseurs, écrite à côté
  const showSliders = () => {
    $("out-speed").textContent = `x${Number(scaleSpeed.value).toFixed(2)}`;
    $("out-strum-speed").textContent = scaleStrumSpeed.value;
    $("out-volume").textContent = `${scaleVolume.value} %`;
  };
  scaleSpeed.addEventListener("input", showSliders);
  scaleStrumSpeed.addEventListener("input", showSliders);
  scaleVolume.addEventListener("input", () => {
    showSliders();
    audio?.setVolume(volume());
  });
  showSliders();

  $("btn-browse").addEventListener("click", () => fileInput.click());
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

  btnBack.textContent = `⏪ -${SEEK_STEP} s`;
  btnForward.textContent = `+${SEEK_STEP} s ⏩`;
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
    if (event.key === " " && event.target instanceof HTMLButtonElement && !dialog.open) event.preventDefault();
  });

  updateTransport();
  updateLoop();
  showPosition(0.0);
  onModeChange(); // Simple Corde au démarrage : « Mélodie seule » cochée et grisée
  onHarmonyChange();
  clearNowPlaying();
}

setupUi();
