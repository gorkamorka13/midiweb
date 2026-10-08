"""Écrit les fichiers MIDI d'exemple du dossier examples/ (nécessite mido).

    python tools/make_examples.py

Le morceau est « Au clair de la lune » (domaine public), en Do Majeur, à 100 noires par minute :
des noires et des blanches, une note à la fois. C'est un fichier simple et sûr pour vérifier
l'application à l'oreille.
"""

from pathlib import Path

import mido

TICKS = 480  # par noire
BPM = 100
OUT = Path(__file__).resolve().parent.parent / "examples"

C4, D4, E4 = 60, 62, 64
G3, A3, B3 = 55, 57, 59

# (hauteur, durée en noires), mesure par mesure
PHRASE_A = [(C4, 1), (C4, 1), (C4, 1), (D4, 1), (E4, 2), (D4, 2), (C4, 1), (E4, 1), (D4, 1), (D4, 1), (C4, 4)]
PHRASE_B = [(D4, 1), (D4, 1), (D4, 1), (D4, 1), (A3, 2), (A3, 2), (D4, 1), (C4, 1), (B3, 1), (A3, 1), (G3, 4)]
MELODY = PHRASE_A + PHRASE_A + PHRASE_B + PHRASE_A

# Un accord par mesure : fondamentale (pour la basse) et les trois notes de l'accord
C_MAJOR, G_MAJOR, D_MINOR, A_MINOR = (36, (48, 52, 55)), (43, (47, 50, 55)), (38, (50, 53, 57)), (45, (48, 52, 57))
BARS_A = [C_MAJOR, G_MAJOR, C_MAJOR, C_MAJOR]
BARS_B = [D_MINOR, A_MINOR, D_MINOR, G_MAJOR]
BARS = BARS_A + BARS_A + BARS_B + BARS_A


def note_track(name, channel, program, notes):
    """Piste de notes jouées l'une après l'autre : [(hauteurs simultanées, durée en noires)]."""
    track = mido.MidiTrack()
    track.append(mido.MetaMessage("track_name", name=name, time=0))
    track.append(mido.Message("program_change", channel=channel, program=program, time=0))
    gap = TICKS // 16  # court silence entre deux notes
    wait = 0
    for pitches, beats in notes:
        for i, pitch in enumerate(pitches):
            track.append(mido.Message("note_on", channel=channel, note=pitch, velocity=90, time=wait if i == 0 else 0))
        length = beats * TICKS - gap
        for i, pitch in enumerate(pitches):
            track.append(mido.Message("note_off", channel=channel, note=pitch, velocity=0, time=length if i == 0 else 0))
        wait = gap
    return track


def tempo_messages():
    return [
        mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(BPM), time=0),
        mido.MetaMessage("time_signature", numerator=4, denominator=4, time=0),
    ]


def main():
    OUT.mkdir(exist_ok=True)
    melody = [((pitch,), beats) for pitch, beats in MELODY]

    # 1. Une seule piste : la mélodie
    single = mido.MidiFile(type=0, ticks_per_beat=TICKS)
    track = note_track("Mélodie", 0, 25, melody)
    track[0:0] = tempo_messages()
    single.tracks.append(track)
    single.save(OUT / "au_clair_de_la_lune.mid")

    # 2. Trois pistes : mélodie, basse (une ronde par mesure), accords (trois notes par mesure)
    multi = mido.MidiFile(type=1, ticks_per_beat=TICKS)
    conductor = mido.MidiTrack(tempo_messages())
    multi.tracks.append(conductor)
    multi.tracks.append(note_track("Mélodie", 0, 25, melody))
    multi.tracks.append(note_track("Basse", 1, 32, [((root,), 4) for root, _ in BARS]))
    multi.tracks.append(note_track("Accords", 2, 0, [(chord, 4) for _, chord in BARS]))
    multi.save(OUT / "au_clair_de_la_lune_3_pistes.mid")

    for path in sorted(OUT.glob("*.mid")):
        print(f"{path.name} : {mido.MidiFile(path).length:.1f} s")


if __name__ == "__main__":
    main()
