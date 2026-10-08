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
2. Si le fichier a plusieurs pistes, la liste **Pistes jouées** s'ouvre avec une seule piste
   cochée : celle qui porte probablement la mélodie. Cocher une autre piste si le choix est mauvais
   (**Mélodie probable** y revient, **Toutes** les joue toutes). Jouées ensemble, les pistes d'un
   arrangement donnent chacune leurs accords et tout se superpose. Les notes des pistes décochées
   restent dessinées en gris sur la frise.
3. Régler la tonalité, le mode, le strumming, la vitesse et le volume (modifiables aussi en cours
   de lecture). Les réglages sont retenus par le navigateur d'une visite à l'autre.
4. Cliquer sur **Écouter**. À la première écoute, le son de l'instrument est chargé depuis le site.
5. Se déplacer avec **Début**, **-5 s**, **+5 s** ou en cliquant sur la frise, pendant la lecture
   comme à l'arrêt : à l'arrêt, on choisit ainsi l'endroit d'où partira la lecture.
6. **Pause** suspend la lecture et coupe le son ; **Reprendre** repart du même endroit. En pause,
   l'accord reste affiché, les réglages et les déplacements restent possibles et s'entendent à la
   reprise.
7. **Arrêter** stoppe la lecture et revient à la position de départ. **Exporter le MIDI...**
   télécharge le morceau entier (pistes cochées) avec les réglages affichés.

### Réglages propres à la version web

- **Tonalité du morceau** : la tonalité détectée est proposée ; si elle est fausse, en choisir une
  autre dans la liste. Le morceau est transposé de cette tonalité vers la **Tonalité globale**.
- **Une seule note ou un seul accord à la fois** (coché au départ) : une nouvelle note coupe la
  précédente, ce qui évite que les accords de notes qui se chevauchent sonnent ensemble.
- **Mélodie seule** est cochée au départ, contrairement à l'application de bureau.
- **Accord adapté aux notes hors tonalité** : une note étrangère à la gamme reçoit un accord qui
  la contient, au lieu de l'accord de repli (La mineur).
- **Boucle** : **A** pose le début et **B** la fin à la position courante ; la lecture répète ce
  passage. **Effacer** retire la boucle.

### Clavier

| Touche | Effet |
|---|---|
| Espace | Écouter, puis pause et reprise. |
| ← et → | Reculer et avancer de 5 s. |
| Début (Home) | Revenir au début. |

Les flèches gardent leur rôle habituel quand un curseur, un champ ou une liste a le focus.

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
| Échantillons | Aucun téléchargement. | Servis avec le site (`public/soundfonts`) et chargés à la première écoute de chaque instrument. |
| Réglages en lecture | Relus toutes les 50 ms. | Entendus environ 80 ms après le changement : le moteur programme les notes avec 80 ms d'avance pour les placer à leur heure exacte. |
| Fichiers | Boîtes de dialogue de Windows. | Sélecteur de fichier du navigateur ou dépôt sur la page ; l'export est téléchargé sous le nom `<fichier>_strum.mid`. |
| Fenêtre | Taille fixe. | Page qui s'adapte à la largeur de l'écran. |
| Curseurs | Sans valeur affichée. | La valeur est écrite à côté du curseur. |
| Fichiers MIDI à division SMPTE | Lus avec des temps faux. | Refusés avec un message. |
| Pause | Absente : Arrêter puis Écouter repart du début. | Bouton **Pause / Reprendre**. |
| Tonalités | Quatre. | Les 24 tonalités majeures et mineures. |
| Déplacement | Seulement pendant la lecture. | Aussi à l'arrêt : la lecture part de la position choisie. |
| Pistes | Toutes les pistes sont jouées ensemble. | Choix des pistes jouées ; au chargement, seule la mélodie probable. |
| Réglages de départ | « Mélodie seule » décochée. | « Mélodie seule » et « Une seule note ou un seul accord à la fois » cochées. |
| Fichier sans note | Remplacé par une note de secours. | Refusé avec un message. |
| Boucle, volume, raccourcis clavier, réglages retenus | Absents. | Présents. |

Les autres limites connues de l'application de bureau sont conservées : export avec un seul jeu de
réglages, fichiers de type 2 non pris en charge.

## Sons : origine et licence

Les échantillons de `public/soundfonts/MusyngKite` (guitare nylon, guitare acier, piano) viennent
de <https://github.com/gleitz/midi-js-soundfonts>, qui les a produits à partir de la banque de sons
Musyng Kite. Ils sont distribués sous licence
[Creative Commons Attribution - Partage dans les mêmes conditions 3.0](https://creativecommons.org/licenses/by-sa/3.0/deed.fr)
(CC BY-SA 3.0), sans modification. Cette licence ne couvre que ces fichiers, pas le code de
l'application.
