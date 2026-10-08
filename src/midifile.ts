// Lecture et écriture des fichiers MIDI standard. Le comportement suit celui de mido 1.3.3,
// la bibliothèque de l'application de bureau, pour donner exactement les mêmes notes et les
// mêmes fichiers exportés.

export type MidiEvent =
  | { delta: number; kind: "noteOn" | "noteOff"; channel: number; note: number; velocity: number }
  | { delta: number; kind: "tempo"; tempo: number }
  | { delta: number; kind: "endOfTrack" | "other" };

export interface MidiData {
  type: number;
  /** Ticks par noire (négatif : division SMPTE, non prise en charge). */
  ticksPerBeat: number;
  /** Une liste d'événements par piste, en temps relatifs (ticks). */
  tracks: MidiEvent[][];
}

/** Tempo par défaut : 120 BPM (500 000 microsecondes par noire). */
export const DEFAULT_TEMPO = 500000;

// Nombre d'octets de données des messages, par octet de statut (hors méta et sysex)
function dataLength(status: number): number {
  if (status < 0xf0) return (status & 0xf0) === 0xc0 || (status & 0xf0) === 0xd0 ? 1 : 2;
  switch (status) {
    case 0xf1:
    case 0xf3:
      return 1;
    case 0xf2:
      return 2;
    case 0xf6:
    case 0xf8:
    case 0xfa:
    case 0xfb:
    case 0xfc:
    case 0xfe:
      return 0;
    default:
      throw new Error(`octet de statut 0x${status.toString(16).padStart(2, "0")} non défini`);
  }
}

class Reader {
  pos = 0;
  constructor(private readonly bytes: Uint8Array) {}

  byte(): number {
    if (this.pos >= this.bytes.length) throw new Error("fin de fichier inattendue");
    return this.bytes[this.pos++];
  }

  /** Jusqu'à `size` octets : moins s'il n'en reste pas assez, comme la lecture d'un fichier. */
  take(size: number): Uint8Array {
    const chunk = this.bytes.subarray(this.pos, this.pos + size);
    this.pos += chunk.length;
    return chunk;
  }

  chunkHeader(): [name: string, size: number] {
    const header = this.take(8);
    if (header.length < 8) throw new Error("fin de fichier inattendue");
    const name = String.fromCharCode(header[0], header[1], header[2], header[3]);
    const size = header[4] * 0x1000000 + header[5] * 0x10000 + header[6] * 0x100 + header[7];
    return [name, size];
  }

  variableInt(): number {
    let value = 0;
    for (;;) {
      const byte = this.byte();
      value = value * 128 + (byte & 0x7f);
      if (byte < 0x80) return value;
    }
  }
}

function int16(bytes: Uint8Array, offset: number): number {
  const value = (bytes[offset] << 8) | bytes[offset + 1];
  return value >= 0x8000 ? value - 0x10000 : value;
}

function readTrack(reader: Reader): MidiEvent[] {
  const track: MidiEvent[] = [];
  const [name, size] = reader.chunkHeader();
  if (name !== "MTrk") throw new Error("en-tête MTrk absent au début d'une piste");

  const start = reader.pos;
  let lastStatus: number | null = null;
  while (reader.pos - start !== size) {
    const delta = reader.variableInt();
    let status = reader.byte();
    let peek: number[] = [];
    if (status < 0x80) {
      // Statut courant (running status) : l'octet lu est déjà une donnée
      if (lastStatus === null) throw new Error("statut courant sans statut précédent");
      peek = [status];
      status = lastStatus;
    } else if (status !== 0xff) {
      lastStatus = status; // les méta-messages ne changent pas le statut courant
    }

    if (status === 0xff) {
      const metaType = reader.byte();
      const length = reader.variableInt();
      const data: number[] = [];
      for (let i = 0; i < length; i++) data.push(reader.byte());
      if (metaType === 0x51) {
        if (data.length < 3) throw new Error("méta-message de tempo invalide");
        track.push({ delta, kind: "tempo", tempo: (data[0] << 16) | (data[1] << 8) | data[2] });
      } else {
        track.push({ delta, kind: metaType === 0x2f ? "endOfTrack" : "other" });
      }
    } else if (status === 0xf0 || status === 0xf7) {
      const length = reader.variableInt();
      for (let i = 0; i < length; i++) reader.byte();
      track.push({ delta, kind: "other" });
    } else {
      const data = peek;
      const length = dataLength(status);
      if (data.length > length) throw new Error("message MIDI invalide");
      while (data.length < length) data.push(reader.byte());
      if (data.some((b) => b > 127)) throw new Error("un octet de donnée doit être compris entre 0 et 127");
      const high = status & 0xf0;
      if (high === 0x80 || high === 0x90) {
        track.push({
          delta,
          kind: high === 0x90 ? "noteOn" : "noteOff",
          channel: status & 0x0f,
          note: data[0],
          velocity: data[1],
        });
      } else {
        track.push({ delta, kind: "other" });
      }
    }
  }
  return track;
}

export function parseMidi(bytes: Uint8Array): MidiData {
  const reader = new Reader(bytes);
  const [name, size] = reader.chunkHeader();
  if (name !== "MThd") throw new Error("en-tête MThd introuvable : ce n'est probablement pas un fichier MIDI");
  const header = reader.take(size);
  if (header.length < 6) throw new Error("fin de fichier inattendue");

  const mid: MidiData = { type: int16(header, 0), ticksPerBeat: int16(header, 4), tracks: [] };
  const trackCount = int16(header, 2);
  for (let i = 0; i < trackCount; i++) mid.tracks.push(readTrack(reader));
  return mid;
}

/**
 * Tous les messages de toutes les pistes dans l'ordre de lecture, chacun avec le temps écoulé
 * depuis le précédent en secondes, changements de tempo pris en compte (c'est l'itération d'un
 * MidiFile de mido).
 */
export function playbackMessages(mid: MidiData): { seconds: number; event: MidiEvent }[] {
  // Les pistes d'un fichier de type 2 ne sont pas synchrones : elles ne peuvent pas être fusionnées
  if (mid.type === 2) throw new Error("fichier MIDI de type 2 (pistes asynchrones) non pris en charge");
  if (mid.ticksPerBeat < 0) throw new Error("fichier MIDI à division SMPTE non pris en charge");

  const merged: { tick: number; event: MidiEvent }[] = [];
  for (const track of mid.tracks) {
    let now = 0;
    for (const event of track) {
      now += event.delta;
      merged.push({ tick: now, event });
    }
  }
  merged.sort((a, b) => a.tick - b.tick); // tri stable : à temps égal, l'ordre des pistes est conservé

  const messages: { seconds: number; event: MidiEvent }[] = [];
  let tempo = DEFAULT_TEMPO;
  let lastTick = 0;
  for (const { tick, event } of merged) {
    if (event.kind === "endOfTrack") continue; // sa durée est reportée sur le message suivant
    const delta = tick - lastTick;
    lastTick = tick;
    let seconds = 0;
    if (delta > 0) {
      if (mid.ticksPerBeat === 0) throw new Error("division nulle dans l'en-tête du fichier");
      seconds = delta * ((tempo * 1e-6) / mid.ticksPerBeat);
    }
    messages.push({ seconds, event });
    if (event.kind === "tempo") tempo = event.tempo;
  }
  return messages;
}

// ------------------------------------------------------------------------------
// Écriture
// ------------------------------------------------------------------------------

/** Message à écrire : temps relatif en ticks et octets du message (statut 0xff = méta). */
export interface RawMessage {
  delta: number;
  bytes: number[];
}

function encodeVariableInt(value: number): number[] {
  if (value < 0) throw new Error("un temps doit être positif ou nul dans un fichier MIDI");
  const bytes = [value % 128];
  value = Math.floor(value / 128);
  while (value > 0) {
    bytes.unshift((value % 128) | 0x80);
    value = Math.floor(value / 128);
  }
  return bytes;
}

function chunk(name: string, data: number[]): number[] {
  const size = data.length;
  return [
    ...[...name].map((c) => c.charCodeAt(0)),
    (size >>> 24) & 0xff,
    (size >>> 16) & 0xff,
    (size >>> 8) & 0xff,
    size & 0xff,
    ...data,
  ];
}

/**
 * Fichier MIDI standard. Chaque piste reçoit son méta-message de fin de piste ; le statut
 * courant est utilisé entre deux messages de même statut, comme le fait mido.
 */
export function writeMidi(type: number, ticksPerBeat: number, tracks: RawMessage[][]): Uint8Array {
  const chunks = [
    chunk("MThd", [
      (type >> 8) & 0xff,
      type & 0xff,
      (tracks.length >> 8) & 0xff,
      tracks.length & 0xff,
      (ticksPerBeat >> 8) & 0xff,
      ticksPerBeat & 0xff,
    ]),
  ];
  for (const track of tracks) {
    const data: number[] = [];
    let runningStatus: number | null = null;
    for (const { delta, bytes } of [...track, { delta: 0, bytes: [0xff, 0x2f, 0x00] }]) {
      data.push(...encodeVariableInt(delta));
      const status = bytes[0];
      if (status === 0xff) {
        data.push(...bytes);
        runningStatus = null;
      } else {
        data.push(...(status === runningStatus ? bytes.slice(1) : bytes));
        runningStatus = status < 0xf0 ? status : null;
      }
    }
    chunks.push(chunk("MTrk", data));
  }
  return Uint8Array.from(chunks.flat());
}
