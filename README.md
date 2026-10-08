# Guitar MIDI Strummer - Harmoniseur (version web)

Application web qui lit un fichier MIDI, harmonise chaque note avec un accord de guitare, le joue
en strumming en temps réel dans le navigateur, et exporte le résultat dans un nouveau fichier MIDI.

C'est le portage de l'application de bureau `midi.py` (Python + Tkinter,
<https://github.com/gorkamorka13/midi>). Les fonctions, les règles musicales et les libellés sont
les mêmes ; le README de l'application de bureau reste la référence pour le détail des réglages,
de l'harmonisation et du strumming.

Tout se passe dans le navigateur : il n'y a pas de serveur, et le fichier choisi ne quitte pas la
machine.

## Utilisation

1. Cliquer sur **Parcourir...** (ou déposer un fichier sur la page) et choisir un fichier MIDI
   (`.mid`, `.midi`) ou MIDICSV (`.csv`, `.txt`).
2. Régler la tonalité, le mode, le strumming et la vitesse (modifiables aussi en cours de lecture).
3. Cliquer sur **Écouter**. À la première écoute, le son de l'instrument est téléchargé, ce qui
   demande une connexion.
4. Pendant la lecture : changer les réglages, se déplacer avec **Début**, **-5 s**, **+5 s** ou en
   cliquant sur la frise.
5. **Pause** suspend la lecture et coupe le son ; **Reprendre** repart du même endroit. En pause,
   l'accord reste affiché, les réglages et les déplacements restent possibles et s'entendent à la
   reprise.
6. **Arrêter** stoppe la lecture (la relancer repart du début). **Exporter le MIDI...** télécharge
   le morceau entier avec les réglages affichés.

## Développement

Il faut Node.js (testé avec la version 24).

```bash
npm install
npm run dev       # serveur de développement
npm test          # tests
npm run build     # site statique dans dist/
npm run preview   # sert dist/ pour vérifier le site construit
```

Le dossier `dist/` produit par `npm run build` se dépose tel quel sur n'importe quel hébergement
de fichiers statiques. Les chemins sont relatifs : il fonctionne aussi dans un sous-dossier.

## Organisation du code

| Fichier | Rôle | Équivalent dans `midi.py` |
|---|---|---|
| `src/guitar.ts` | Accordage, accords, grilles des tonalités, noms des notes. | Section 1 |
| `src/midifile.ts` | Lecture et écriture des fichiers MIDI, sur le modèle de mido. | `mido` |
| `src/midicsv.ts` | Lecture des fichiers MIDICSV. | `read_midicsv` |
| `src/logic.ts` | Notes du fichier, tonalité, mélodie seule, doigtés, strumming, export. | Section 2 |
| `src/player.ts` | Moteur de lecture temps réel. | `LivePlayer` |
| `src/audio.ts` | Sortie sonore (Web Audio) et conduite du moteur. | `pygame.midi` |
| `src/ui/timeline.ts`, `src/ui/chord.ts` | Frise du morceau et diagramme d'accord. | `draw_timeline`, `draw_chord` |
| `src/main.ts`, `index.html`, `src/style.css` | Page et réglages. | `GuitarMidiApp` |

## Tests

Les tests comparent le portage à l'application de bureau elle-même. `tools/make_fixtures.py`
fait tourner le vrai `midi.py` sur des fichiers de test et enregistre ce qu'il produit dans
`tests/fixtures/expected.json` ; les tests vérifient que la version web donne exactement la même
chose :

- notes lues, tonalité détectée, filtre « Mélodie seule » ;
- fichier MIDI exporté, à l'octet près, pour plusieurs jeux de réglages ;
- messages envoyés par le moteur de lecture, pas à pas, sous une horloge simulée, avec des
  changements de réglages, des déplacements et un arrêt en cours de lecture.

Pour régénérer les références après une modification de `midi.py` (il faut Python, `mido` et
`pygame-ce`, et le dépôt de l'application de bureau dans `../midi`) :

```bash
python tools/make_fixtures.py
# en plus, sur des fichiers MIDI réels, non versionnés :
python tools/make_fixtures.py --local chemin/vers/morceau.mid
```

## Différences avec l'application de bureau

| Sujet | Application de bureau | Version web |
|---|---|---|
| Son | Synthétiseur MIDI de Windows. | Instruments échantillonnés joués par Web Audio (bibliothèque `smplr`) : le timbre est différent. |
| Échantillons | Aucun téléchargement. | Téléchargés à la première écoute depuis `gleitz.github.io` (jeu MusyngKite de <https://github.com/gleitz/midi-js-soundfonts>). |
| Réglages en lecture | Relus toutes les 50 ms. | Entendus environ 80 ms après le changement : le moteur programme les notes avec 80 ms d'avance pour les placer à leur heure exacte. |
| Fichiers | Boîtes de dialogue de Windows. | Sélecteur de fichier du navigateur ou dépôt sur la page ; l'export est téléchargé sous le nom `<fichier>_strum.mid`. |
| Fenêtre | Taille fixe. | Page qui s'adapte à la largeur de l'écran. |
| Curseurs | Sans valeur affichée. | La valeur est écrite à côté du curseur. |
| Fichiers MIDI à division SMPTE | Lus avec des temps faux. | Refusés avec un message. |
| Pause | Absente : Arrêter puis Écouter repart du début. | Bouton **Pause / Reprendre**. |

Les autres limites connues de l'application de bureau sont conservées : quatre tonalités,
déplacement seulement pendant la lecture (ou en pause), export avec un seul jeu de réglages,
fichiers de type 2 non pris en charge.
