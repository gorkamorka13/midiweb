"""Données de référence pour les tests : fait tourner le vrai midi.py (application de bureau)
sur des fichiers de test et enregistre ce qu'il produit.

    python tools/make_fixtures.py [--app C:/www/midi] [--local fichier.mid ...]

Sans --local : écrit les fichiers de test dans tests/fixtures/files et tests/fixtures/expected.json.
Avec --local : traite les fichiers donnés vers tests/fixtures/local (dossier non versionné).
"""
import argparse
import base64
import io
import json
import os
import random
import shutil
import sys

import mido
from mido import Message, MetaMessage, MidiFile, MidiTrack

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURES = os.path.join(ROOT, "tests", "fixtures")

parser = argparse.ArgumentParser()
parser.add_argument("--app", default=os.path.join(os.path.dirname(ROOT), "midi"),
                    help="dossier qui contient midi.py")
parser.add_argument("--local", nargs="*", help="fichiers MIDI réels à traiter (non versionnés)")
args = parser.parse_args()

sys.path.insert(0, args.app)
import midi as app  # noqa: E402  (l'application de bureau)

SCALES = list(app.SCALE_HARMONY)


# ------------------------------------------------------------------------------
# Fichiers de test synthétiques
# ------------------------------------------------------------------------------

def track_from(events):
    """[(tick absolu, message)] -> MidiTrack en temps relatifs (tri stable par tick)."""
    track = MidiTrack()
    last = 0
    for tick, msg in sorted(events, key=lambda e: e[0]):
        track.append(msg.copy(time=tick - last))
        last = tick
    return track


def note(events, start, length, pitch, velocity=90, channel=0, off_as_on=False):
    events.append((start, Message("note_on", note=pitch, velocity=velocity, channel=channel)))
    if off_as_on:
        events.append((start + length, Message("note_on", note=pitch, velocity=0, channel=channel)))
    else:
        events.append((start + length, Message("note_off", note=pitch, velocity=64, channel=channel)))


def make_melody():
    mid = MidiFile(type=0, ticks_per_beat=480)
    ev = []
    tune = [60, 60, 60, 62, 64, 62, 60, 64, 62, 62, 60]
    lengths = [480, 480, 480, 480, 960, 960, 480, 480, 480, 480, 1920]
    t = 0
    for pitch, length in zip(tune, lengths):
        note(ev, t, length - 20, pitch)
        t += length
    mid.tracks.append(track_from(ev))
    return mid


def make_multitrack():
    mid = MidiFile(type=1, ticks_per_beat=384)
    tempo = [
        (0, MetaMessage("track_name", name="Tempo")),
        (0, MetaMessage("time_signature", numerator=3, denominator=4)),
        (0, MetaMessage("set_tempo", tempo=600000)),
        (1536, MetaMessage("set_tempo", tempo=400000)),
        (3072, MetaMessage("set_tempo", tempo=750000)),
    ]
    lead = [(0, MetaMessage("track_name", name="Lead")), (0, Message("program_change", program=25, channel=0))]
    t = 0
    for i, pitch in enumerate([69, 72, 76, 74, 72, 71, 69, 64, 65, 67, 69, 71, 72, 76]):
        note(lead, t, 300, pitch, off_as_on=(i % 3 == 0))
        if i % 4 == 0:  # accord : trois notes simultanées
            note(lead, t, 300, pitch - 4)
            note(lead, t + 3, 300, pitch - 9)  # quasi simultanée (quelques ms)
        t += 384
    # Même hauteur réattaquée avant son note_off : seul le premier note_on compte
    lead.append((t, Message("note_on", note=60, velocity=80, channel=0)))
    lead.append((t + 100, Message("note_on", note=60, velocity=100, channel=0)))
    lead.append((t + 200, Message("note_off", note=60, velocity=0, channel=0)))
    lead.append((t + 300, Message("note_off", note=60, velocity=0, channel=0)))
    note(lead, t + 400, 10, 62)  # note très courte, allongée à 0,2 s
    lead.append((t + 800, Message("note_on", note=57, velocity=70, channel=0)))  # jamais relâchée

    bass = [(0, MetaMessage("track_name", name="Bass")), (0, Message("program_change", program=32, channel=1)),
            (0, Message("control_change", control=7, value=100, channel=1)),
            (10, Message("sysex", data=[0x7e, 0x7f, 0x09, 0x01])),
            (500, Message("pitchwheel", pitch=-2000, channel=1)),
            (900, Message("aftertouch", value=40, channel=1))]
    for i, pitch in enumerate([45, 45, 40, 41, 43, 45, 47, 48]):
        note(bass, i * 768, 700, pitch, velocity=75, channel=1)

    drums = [(0, MetaMessage("track_name", name="Drums"))]
    for i in range(24):
        note(drums, i * 192, 60, 36 if i % 2 == 0 else 38, channel=9)

    for events in (tempo, lead, bass, drums):
        mid.tracks.append(track_from(events))
    return mid


def make_gmajor():
    mid = MidiFile(type=1, ticks_per_beat=480)
    ev = [(0, MetaMessage("set_tempo", tempo=450000))]
    tune = [67, 69, 71, 72, 74, 76, 78, 79, 78, 76, 74, 71, 67, 62, 66, 67]
    t = 0
    for i, pitch in enumerate(tune):
        length = 480 if i % 4 else 960
        note(ev, t, length, pitch)
        t += length
    mid.tracks.append(track_from(ev))
    return mid


def make_range():
    mid = MidiFile(type=1, ticks_per_beat=96)
    ev = []
    for i, pitch in enumerate(range(12, 109, 3)):
        note(ev, i * 96, 90, pitch)
    mid.tracks.append(track_from(ev))
    return mid


def make_random():
    rng = random.Random(20261008)
    mid = MidiFile(type=1, ticks_per_beat=240)
    tempo = [(0, MetaMessage("set_tempo", tempo=500000))]
    for i in range(1, 12):
        tempo.append((i * 2000 + rng.randrange(500), MetaMessage("set_tempo", tempo=rng.randrange(250000, 900000))))
    mid.tracks.append(track_from(tempo))
    for channel in (0, 3):
        ev = []
        t = 0
        for _ in range(150):
            t += rng.choice([0, 0, 30, 60, 120, 240, 480])
            note(ev, t, rng.choice([5, 60, 120, 240, 700]), rng.randrange(30, 96),
                 velocity=rng.randrange(1, 128), channel=channel, off_as_on=rng.random() < 0.3)
        mid.tracks.append(track_from(ev))
    return mid


def make_empty():
    mid = MidiFile(type=1, ticks_per_beat=480)
    mid.tracks.append(track_from([(0, MetaMessage("track_name", name="Vide")),
                                  (0, MetaMessage("set_tempo", tempo=500000))]))
    return mid


def make_type2():
    mid = MidiFile(type=2, ticks_per_beat=480)
    for _ in range(2):
        ev = []
        note(ev, 0, 400, 60)
        mid.tracks.append(track_from(ev))
    return mid


CSV_SONG = '''\ufeff0, 0, Header, 1, 2, 480
1, 0, Start_track
1, 0, Title_t, "Test, avec ""virgule"""
1, 0, Tempo, 500000
1, 960, Tempo, 400000
1, 1920, End_track
2, 0, Start_track
# commentaire
   ; autre commentaire

2, 0, Note_on_c, 0, 60, 90
2, 1440, Note_on_c, 0, 67, 80
2, 480, Note_off_c, 0, 60, 0
2,480,Note_on_c,0,64,85
2, 960, Note_on_c, 0, 64, 0
2, 960, NOTE_ON_C, 9, 36, 100
2, 1000, Note_off_c, 9, 36, 0
2, 1920, Note_off_c, 0, 67, 0
2, 1920, Note_on_c, 1, 72, 70
2, 2400, Control_c, 1, 7, 100
2, 2400, End_track
0, 0, End_of_file
'''

CSV_FILES = {
    "song.csv": CSV_SONG,
    "song.txt": CSV_SONG.replace("\ufeff", "").replace("\n", "\r\n"),
    "bad_line.csv": "0, 0, Header, 1, 1, 480\n1, 0, Note_on_c, 0, soixante, 90\n",
    "short_line.csv": "0, 0, Header, 1, 1, 480\n\n1, 12\n",
    "negative_tick.csv": "0, 0, Header, 1, 1, 480\n1, -5, Note_on_c, 0, 60, 90\n",
    "bad_pitch.csv": "0, 0, Header, 1, 1, 480\n1, 0, Note_on_c, 0, 200, 90\n",
    "bad_channel.csv": "0, 0, Header, 1, 1, 480\n1, 0, Note_off_c, 16, 60, 0\n",
    "bad_tempo.csv": "0, 0, Header, 1, 1, 480\n1, 0, Tempo, 16777216\n",
    "short_header.csv": "0, 0, Header, 1, 1\n",
    "no_header.txt": "1, 0, Note_on_c, 0, 60, 90\n1, 480, Note_off_c, 0, 60, 0\n",
    "bad_division.csv": "0, 0, Header, 1, 1, 0\n1, 0, Note_on_c, 0, 60, 90\n",
    "bad_type.csv": "0, 0, Header, 3, 1, 480\n1, 0, Note_on_c, 0, 60, 90\n",
    "type2.csv": "0, 0, Header, 2, 1, 480\n1, 0, Note_on_c, 0, 60, 90\n1, 480, Note_off_c, 0, 60, 0\n",
    "notes_only_header.csv": "0, 0, Header, 0, 1, 96\n",
}


def write_synthetic(folder):
    os.makedirs(folder, exist_ok=True)
    for name, build in [("melody.mid", make_melody), ("multitrack.mid", make_multitrack),
                        ("gmajor.mid", make_gmajor), ("range.mid", make_range), ("random.mid", make_random),
                        ("empty.mid", make_empty), ("type2.mid", make_type2)]:
        build().save(os.path.join(folder, name))
    with open(os.path.join(folder, "melody.mid"), "rb") as f:
        melody = f.read()
    with open(os.path.join(folder, "truncated.mid"), "wb") as f:
        f.write(melody[:-9])
    with open(os.path.join(folder, "garbage.mid"), "wb") as f:
        f.write(b"ceci n'est pas un fichier MIDI")
    for name, text in CSV_FILES.items():
        with open(os.path.join(folder, name), "w", encoding="utf-8", newline="") as f:
            f.write(text)
    return sorted(os.listdir(folder))


# ------------------------------------------------------------------------------
# Sorties de référence
# ------------------------------------------------------------------------------

EXPORT_SETTINGS = [
    dict(mode="corde", scale=SCALES[0], strums=2, speed=1.0, delay_ms=15.0, transpose=0, melody=True, program=25),
    dict(mode="accord", scale=SCALES[1], strums=4, speed=1.37, delay_ms=40.0, transpose=3, melody=False, program=24),
    dict(mode="accord", scale=SCALES[2], strums=1, speed=0.5, delay_ms=5.0, transpose=-12, melody=True, program=0),
    dict(mode="corde", scale=SCALES[3], strums=16, speed=2.0, delay_ms=27.5, transpose=12, melody=True, program=25),
    dict(mode="accord", scale=SCALES[3], strums=3, speed=0.83, delay_ms=15.0, transpose=0, melody=False, program=25),
]


def export_bytes(notes, key, s):
    used = app.keep_highest_notes(notes) if s["melody"] else notes
    mid, chords = app.generate_processed_midi(
        input_notes=used, mode=s["mode"], scale_key=s["scale"], strums_count=s["strums"],
        speed_factor=s["speed"], strum_delay_ms=s["delay_ms"], transpose=s["transpose"],
        key_shift=app.shift_to_key(key, s["scale"]), program=s["program"])
    buf = io.BytesIO()
    mid.save(file=buf)
    return {"settings": s, "chords": chords, "midi": base64.b64encode(buf.getvalue()).decode("ascii")}


def describe_file(path):
    entry = {"name": os.path.basename(path)}
    try:
        notes = app.analyze_input_midi(path)
    except Exception as e:  # même filet que browse_file
        entry["error"] = str(e)
        return entry, None
    key = app.detect_key(notes)
    index = {id(n): i for i, n in enumerate(notes)}
    entry.update({
        "error": None,
        "notes": [[n["pitch"], n["start"], n["duration"], n["velocity"]] for n in notes],
        "key": list(key),
        "melody": [index[id(n)] for n in app.keep_highest_notes(notes)],
        "duration": max(n["start"] + n["duration"] for n in notes),
        "shifts": {scale: app.shift_to_key(key, scale) for scale in SCALES},
        "exports": [export_bytes(notes, key, s) for s in EXPORT_SETTINGS],
    })
    return entry, (notes, key)


# ------------------------------------------------------------------------------
# LivePlayer sous horloge simulée
# ------------------------------------------------------------------------------

class FakeClock:
    """Remplace le module time vu par midi.py : le temps n'avance que par pas de TICK."""
    def __init__(self, start):
        self.now = start

    def perf_counter(self):
        return self.now


class RecordingOut:
    def __init__(self, clock, log):
        self.clock, self.log = clock, log

    def note_on(self, pitch, velocity):
        self.log.append(["on", self.clock.now, pitch, velocity])

    def note_off(self, pitch, velocity):
        self.log.append(["off", self.clock.now, pitch])

    def set_instrument(self, program):
        self.log.append(["prog", self.clock.now, program])


class ScriptedStop:
    """Tient lieu de threading.Event : `wait` fait avancer l'horloge et joue le scénario."""
    def __init__(self, clock, apply_actions, stop_at, on_tick):
        self.clock, self.apply_actions, self.stop_at, self.on_tick = clock, apply_actions, stop_at, on_tick

    def is_set(self):
        return self.stop_at is not None and self.clock.now >= self.stop_at

    def wait(self, timeout):
        self.on_tick()
        self.clock.now += timeout
        self.apply_actions()
        return False

    def set(self):
        pass


CLOCK_START = 100.0


def run_live(notes, key, initial, actions, stop_at=None):
    """actions : [(instant en s depuis le départ, type, valeur)], type parmi les réglages,
    'seek' ou 'seek_to'. Les actions échues sont appliquées avant chaque pas."""
    clock = FakeClock(CLOCK_START)
    params = dict(initial)
    params["key_shift"] = app.shift_to_key(key, params["scale"])
    log, displays, positions = [], [], []
    pending = sorted(actions, key=lambda a: a[0])
    player = app.LivePlayer(notes=notes, get_params=lambda: params, out=RecordingOut(clock, log))
    state = {"display": None, "ticks": 0}

    def apply_actions():
        while pending and CLOCK_START + pending[0][0] <= clock.now:
            _, kind, value = pending.pop(0)
            if kind == "seek":
                player.seek(value)
            elif kind == "seek_to":
                player.seek_to(value)
            else:
                params[kind] = value
                if kind == "scale":
                    params["key_shift"] = app.shift_to_key(key, value)

    def on_tick():
        d = player.display
        if d is not state["display"]:
            state["display"] = d
            displays.append([clock.now, None if d is None else
                             [d["mode"], d["chord"], d["frets"], d["up"], d["transpose"], d["pitch"]]])
        if state["ticks"] % 100 == 0:
            positions.append([clock.now, player.position])
        state["ticks"] += 1

    player._stop = ScriptedStop(clock, apply_actions, None if stop_at is None else CLOCK_START + stop_at, on_tick)
    real_time = app.time
    app.time = clock
    try:
        apply_actions()
        player._run()
    finally:
        app.time = real_time
    return {"initial": initial, "actions": [list(a) for a in actions], "stopAt": stop_at,
            "clockStart": CLOCK_START, "tick": app.LivePlayer.TICK, "ticks": state["ticks"],
            "events": log, "displays": displays, "positions": positions,
            "finalPosition": player.position, "finalClock": clock.now, "finished": player.finished,
            "stringHits": player.string_hits}


def base_params(**changes):
    p = dict(mode="corde", scale=SCALES[0], speed=1.0, delay_ms=15.0, strums=2, melody=True, transpose=0, program=25)
    p.update(changes)
    return p


LIVE_SCENARIOS = {
    "defaut_simple_corde": (base_params(), [], None),
    "accord_4_strums": (base_params(mode="accord", melody=False, strums=4), [], None),
    "accord_rapide_balayage_large": (base_params(mode="accord", melody=False, strums=3, speed=1.7, delay_ms=40.0), [], None),
    "reglages_en_cours": (base_params(mode="accord", melody=False), [
        (0.4, "speed", 2.0), (0.9, "mode", "corde"), (1.3, "transpose", 2), (1.7, "mode", "accord"),
        (2.1, "scale", SCALES[2]), (2.6, "strums", 5), (3.0, "melody", True), (3.3, "delay_ms", 40.0),
        (3.6, "program", 0), (3.9, "speed", 0.5), (4.6, "scale", SCALES[1]), (5.0, "transpose", -7),
        (5.5, "melody", False), (6.0, "strums", 1), (6.4, "speed", 1.25), (7.0, "program", 24),
    ], None),
    "deplacements": (base_params(mode="accord", melody=False, strums=2), [
        (0.5, "seek", 5.0), (1.0, "seek", -100.0), (1.6, "seek_to", 3.21), (2.0, "seek", 5.0),
        (2.0, "seek", -1.0), (2.5, "seek_to", 0.0), (3.2, "seek_to", 1.0), (4.0, "seek", 1000.0),
    ], None),
    "arret_en_cours": (base_params(mode="accord", melody=False, strums=4), [(0.7, "seek_to", 2.0)], 2.345),
}


def live_runs(name, notes, key):
    return [dict(run_live(notes, key, initial, actions, stop_at), file=name, scenario=scenario)
            for scenario, (initial, actions, stop_at) in LIVE_SCENARIOS.items()]


# ------------------------------------------------------------------------------
# Tables : noms, décalages, doigtés
# ------------------------------------------------------------------------------

def tables():
    notations = ["fr", "en"]
    layouts = []
    for mode in ("accord", "corde"):
        for scale in SCALES:
            for transpose, key_shift in ((0, 0), (5, 3), (-7, -5), (12, 6)):
                for pitch in range(0, 128):
                    chord, layout = app.strum_layout({"pitch": pitch}, mode, app.SCALE_HARMONY[scale],
                                                     transpose, key_shift)
                    layouts.append([mode, scale, transpose, key_shift, pitch, chord, [list(x) for x in layout]])
    return {
        "scales": SCALES,
        "scaleLabels": {n: [app.scale_label(s, n) for s in SCALES] for n in notations},
        "noteNames": {n: [[p, app.note_name(p, n)] for p in range(-24, 140)] for n in notations},
        "chordNames": {n: [[c, t, app.transposed_chord_name(c, t, n)]
                           for c in app.CHORDS for t in range(-12, 13)] for n in notations},
        "keyNames": {n: [[s, t, app.transposed_key_name(s, t, n)]
                         for s in SCALES for t in range(-12, 13)] for n in notations},
        "shifts": [[root, quality, s, app.shift_to_key((root, quality), s)]
                   for quality in app.KEY_PROFILES for root in range(12) for s in SCALES],
        "chordFrets": app.CHORD_FRETS,
        "chordVoicings": app.CHORD_VOICINGS,
        "layouts": layouts,
        "sweepDelays": [[ms, n, slot, app.sweep_delay(ms, n, slot)]
                        for ms in (5.0, 15.0, 27.5, 40.0) for n in (0, 1, 2, 4, 6) for slot in (0.01, 0.1, 0.37, 2.0)],
        "guitarRange": [[p, app.to_guitar_range(p)] for p in range(0, 128)],
        "formatTime": [[s, app.format_time(s)] for s in (0.0, 1.3, 9.96, 59.94, 61.07, 247.4, 3599.0)],
    }


# ------------------------------------------------------------------------------

def main():
    if args.local:
        folder = os.path.join(FIXTURES, "local")
        os.makedirs(os.path.join(folder, "files"), exist_ok=True)
        paths = []
        for src in args.local:
            dst = os.path.join(folder, "files", os.path.basename(src))
            shutil.copyfile(src, dst)
            paths.append(dst)
        live_files = [os.path.basename(p) for p in paths]
    else:
        folder = FIXTURES
        files_dir = os.path.join(folder, "files")
        paths = [os.path.join(files_dir, name) for name in write_synthetic(files_dir)]
        live_files = ["multitrack.mid", "random.mid", "song.csv"]

    out = {"mido": str(mido.version_info), "files": [], "live": []}
    if not args.local:
        out["tables"] = tables()
    for path in paths:
        entry, loaded = describe_file(path)
        out["files"].append(entry)
        if loaded and entry["name"] in live_files:
            scenarios = live_runs(entry["name"], *loaded)
            if args.local:  # fichiers longs : deux scénarios suffisent
                scenarios = [s for s in scenarios if s["scenario"] in ("reglages_en_cours", "deplacements")]
            out["live"].extend(scenarios)

    target = os.path.join(folder, "expected.json")
    with open(target, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    ok = sum(1 for e in out["files"] if e["error"] is None)
    print(f"{target} : {len(out['files'])} fichiers ({ok} lisibles), {len(out['live'])} lectures simulées, "
          f"{os.path.getsize(target) // 1024} Ko")
    for e in out["files"]:
        print(f"  {e['name']:24} " + (f"ERREUR {e['error']!r}" if e["error"] is not None else
                                      f"{len(e['notes'])} notes, tonalité {e['key']}, {e['duration']:.2f} s"))


if __name__ == "__main__":
    main()
