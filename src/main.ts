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
  SCALE_HARMONY,
  SEEK_STEP,
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
import { analyzeInputMidi, detectKey, generateProcessedMidi, keepHighestNotes, type Note } from "./logic";
import type { LiveParams } from "./player";
import { drawChord } from "./ui/chord";
import { Timeline } from "./ui/timeline";

function $<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const lblFile = $("lbl-file");
const fileInput = $<HTMLInputElement>("file-input");
const cbScale = $<HTMLSelectElement>("cb-scale");
const lblFileKey = $("lbl-file-key");
const lblTranspose = $("lbl-transpose");
const chkMelody = $<HTMLInputElement>("chk-melody");
const cbInstrument = $<HTMLSelectElement>("cb-instrument");
const spinStrums = $<HTMLInputElement>("spin-strums");
const scaleSpeed = $<HTMLInputElement>("scale-speed");
const scaleStrumSpeed = $<HTMLInputElement>("scale-strum-speed");
const lblChord = $("lbl-chord");
const lblChordSub = $("lbl-chord-sub");
const cvChord = $<HTMLCanvasElement>("cv-chord");
const lblStroke = $("lbl-stroke");
const btnPlay = $<HTMLButtonElement>("btn-play");
const btnPause = $<HTMLButtonElement>("btn-pause");
const btnStart = $<HTMLButtonElement>("btn-start");
const btnBack = $<HTMLButtonElement>("btn-back");
const btnForward = $<HTMLButtonElement>("btn-forward");
const seekButtons = [btnStart, btnBack, btnForward]; // grisés à l'arrêt : sans effet hors lecture
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
let inputNotes: Note[] | null = null;
let fileKey: Key | null = null; // tonalité détectée dans le fichier
let melodySaved: boolean | null = null; // état de « Mélodie seule » avant le passage en Simple Corde
let lastStrums = 2;
let shownPosition = -1; // dernière position donnée à la frise

const timeline = new Timeline($("tl-scroll"), $("tl-spacer"), $<HTMLCanvasElement>("cv-timeline"), (seconds) =>
  playback?.seekTo(seconds),
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
}

function updateTransposeLabel(): void {
  const level = transpose ? signed(transpose) : "0";
  lblTranspose.textContent = `${level}  (${transposedKeyName(scaleKey(), transpose, notation())})`;
}

/** Demi-tons ajoutés aux notes du fichier pour le jouer dans la tonalité choisie. */
function keyShift(): number {
  return fileKey ? shiftToKey(fileKey, scaleKey()) : 0;
}

function updateFileKeyLabel(): void {
  if (fileKey === null) {
    lblFileKey.textContent = "aucun fichier";
    return;
  }
  const shift = keyShift();
  const moved = shift ? `transposé de ${signed(shift)} demi-tons` : "non transposé";
  lblFileKey.textContent = `${keyName(fileKey[0], fileKey[1], notation())} (${moved})`;
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
  drawTimeline();
}

function fillScales(): void {
  const selected = Math.max(0, cbScale.selectedIndex);
  cbScale.replaceChildren(...SCALES.map((k) => new Option(scaleLabel(k, notation()))));
  cbScale.selectedIndex = selected;
}

/** Réécrit tout ce qui affiche un nom de note ; la tonalité choisie reste la même. */
function onNotationChange(): void {
  fillScales();
  onHarmonyChange();
  if (!playback) drawChord(cvChord, null, null, notation()); // noms des cordes ; en lecture, `pollPlayer` redessine
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
  const harmonyMap = SCALE_HARMONY[scaleKey()];
  const shift = keyShift();
  const labels = used.map((n) => {
    const pitch = n.pitch + shift;
    const chord: string | undefined = harmonyMap[mod(pitch, 12)];
    const name =
      chord || chords
        ? transposedChordName(chord ?? "Lam", transpose, notation())
        : noteName(pitch + transpose, notation());
    return { start: n.start, name };
  });
  timeline.setModel({ notes: inputNotes, used: new Set(used), labels, chords, duration: songDuration });
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

function setSeekEnabled(enabled: boolean): void {
  for (const button of [...seekButtons, btnPause]) button.disabled = !enabled;
  timeline.setDragSeek(enabled);
}

function resetDisplay(): void {
  btnPlay.textContent = "▶ Écouter";
  btnPause.textContent = "⏸ Pause";
  shownPosition = -1;
  setSeekEnabled(false);
  showPosition(0.0);
  clearNowPlaying();
  timeline.hidePlayhead();
}

// --- Fichier, lecture, export ------------------------------------------------

async function loadFile(file: File): Promise<void> {
  const request = ++fileRequest;
  stopAudio(true);
  timeline.scrollToStart();
  let notes: Note[];
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (request !== fileRequest) return; // un autre fichier a été choisi entre-temps
    notes = analyzeInputMidi(file.name, bytes);
  } catch (e) {
    // Fichier illisible : on ne garde pas les notes du fichier précédent
    inputFileName = null;
    inputNotes = null;
    fileKey = null;
    songDuration = 0.0;
    lblFile.textContent = "Aucun fichier sélectionné";
    lblFile.classList.add("muted");
    lblStatus.textContent = "En attente d'un fichier...";
    showPosition(0.0);
    onHarmonyChange();
    showMessage("Erreur", `Impossible de lire le fichier : ${errorText(e)}`);
    return;
  }
  inputFileName = file.name;
  inputNotes = notes;
  fileKey = detectKey(notes);
  songDuration = Math.max(...notes.map((n) => n.start + n.duration));
  lblFile.textContent = file.name;
  lblFile.classList.remove("muted");
  lblStatus.textContent = `${notes.length} notes détectées | Durée totale : ${songDuration.toFixed(2)}s`;
  showPosition(0.0);
  onHarmonyChange();
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
    // pas encore de contrôles dans l'interface : valeurs par défaut
    mono: false,
    chromatic: false,
    loop: null,
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

  const request = ++playRequest;
  const status = lblStatus.textContent;
  starting = true;
  btnPlay.textContent = "⏹ Arrêter";
  lblStatus.textContent = "Chargement du son...";
  try {
    audio ??= new AudioOutput();
    await audio.prepare(INSTRUMENTS[cbInstrument.value]);
    if (request !== playRequest) return; // arrêtée pendant le chargement
    playback = new Playback(inputNotes, readLiveParams, audio, 0, songDuration);
  } catch (e) {
    if (request !== playRequest) return;
    starting = false;
    resetDisplay();
    lblStatus.textContent = status;
    showMessage("Erreur Audio", `Échec de la lecture audio : ${errorText(e)}`);
    return;
  }
  starting = false;
  setSeekEnabled(true);
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
  const state = `${modeName} | x${p.speed.toFixed(2)} | ${p.strums} strums`;
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
  const { midi } = generateProcessedMidi(chkMelody.checked ? keepHighestNotes(inputNotes) : inputNotes, {
    mode: mode(),
    scaleKey: scaleKey(),
    strumsCount: getStrums(),
    speedFactor: Number(scaleSpeed.value),
    strumDelayMs: Number(scaleStrumSpeed.value),
    transpose,
    keyShift: keyShift(),
    program: INSTRUMENTS[cbInstrument.value],
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

// --- Mise en place -----------------------------------------------------------

function setupUi(): void {
  fillScales();
  cbScale.addEventListener("change", onHarmonyChange);
  $("btn-transpose-down").addEventListener("click", () => changeTranspose(-1));
  $("btn-transpose-up").addEventListener("click", () => changeTranspose(1));
  for (const radio of document.querySelectorAll('input[name="mode"]')) {
    radio.addEventListener("change", onModeChange);
  }
  chkMelody.addEventListener("change", drawTimeline);
  for (const radio of document.querySelectorAll('input[name="notation"]')) {
    radio.addEventListener("change", onNotationChange);
  }
  cbInstrument.replaceChildren(...Object.keys(INSTRUMENTS).map((name) => new Option(name)));
  cbInstrument.value = DEFAULT_INSTRUMENT;

  // Valeur des curseurs, écrite à côté
  const showSliders = () => {
    $("out-speed").textContent = `x${Number(scaleSpeed.value).toFixed(2)}`;
    $("out-strum-speed").textContent = scaleStrumSpeed.value;
  };
  scaleSpeed.addEventListener("input", showSliders);
  scaleStrumSpeed.addEventListener("input", showSliders);
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
  btnStart.addEventListener("click", () => playback?.seekTo(0.0));
  btnBack.addEventListener("click", () => playback?.seek(-SEEK_STEP));
  btnForward.addEventListener("click", () => playback?.seek(SEEK_STEP));
  // Un seul bouton : « Écouter » à l'arrêt, « Arrêter » pendant la lecture
  btnPlay.addEventListener("click", toggleAudio);
  btnPause.addEventListener("click", togglePause);
  $("btn-export").addEventListener("click", exportMidi);

  setSeekEnabled(false);
  showPosition(0.0);
  onModeChange(); // Simple Corde au démarrage : « Mélodie seule » cochée et grisée
  onHarmonyChange();
  clearNowPlaying();
}

setupUi();
