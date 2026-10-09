# Guitar MIDI Strummer - Harmoniseur (version web)

Application web qui lit un fichier MIDI, harmonise chaque note avec un accord de guitare, le joue
en strumming en temps réel dans le navigateur, et exporte le résultat dans un nouveau fichier MIDI.

C'est le portage de l'application de bureau `midi.py` (Python + Tkinter,
<https://github.com/gorkamorka13/midi>). Les fonctions, les règles musicales et les noms des
réglages sont les mêmes ; le README de l'application de bureau reste la référence pour le détail
des réglages, de l'harmonisation et du strumming.

Tout se passe dans le navigateur : il n'y a pas de serveur, et le fichier choisi ne quitte pas la
machine.

## Utilisation

1. Cliquer sur **Ouvrir** (ou déposer un fichier sur la page) et choisir un fichier MIDI
   (`.mid`, `.midi`) ou MIDICSV (`.csv`, `.txt`). Sans fichier sous la main, **Essayer un exemple**
   charge « Au clair de la lune ».
2. Si le fichier a plusieurs pistes, la liste **Pistes jouées** s'ouvre avec une seule piste
   cochée : celle qui porte probablement la mélodie. Cocher une autre piste si le choix est mauvais
   (**Mélodie probable** y revient, **Toutes** les joue toutes). Jouées ensemble, les pistes d'un
   arrangement donnent chacune leurs accords et tout se superpose. Les notes des pistes décochées
   restent dessinées en gris sur la frise.
3. Régler la tonalité, le mode, le strumming et le volume dans le panneau des réglages, et la
   **Vitesse** avec le curseur placé sous la frise (**x1** revient à la vitesse du fichier). Tout
   est modifiable aussi en cours de lecture, et retenu par le navigateur d'une visite à l'autre.
4. Cliquer sur **Écouter**. À la première écoute, le son de l'instrument est chargé depuis le site.
5. Se déplacer avec **Début**, **-5 s**, **+5 s** ou en cliquant sur la frise, pendant la lecture
   comme à l'arrêt : à l'arrêt, on choisit ainsi l'endroit d'où partira la lecture.
6. **Pause** suspend la lecture et coupe le son ; **Reprendre** repart du même endroit. En pause,
   l'accord reste affiché, les réglages et les déplacements restent possibles et s'entendent à la
   reprise.
7. **Arrêter** stoppe la lecture et revient à la position de départ. **Exporter le MIDI...**
   télécharge le morceau entier (pistes cochées) avec les réglages affichés.

### Barre, menu et petits écrans

- La barre du haut montre le fichier ouvert, avec **Ouvrir** et **Exporter**. Le bouton à trois points ouvre
  le menu : ouvrir un fichier, charger un des deux exemples, exporter, enregistrer les accords,
  choisir le thème, voir les
  raccourcis clavier, **À propos**, et **Réinitialiser les réglages**.
- **Thème** : **Système** suit le réglage clair ou sombre de l'appareil ; **Clair** et **Sombre**
  l'imposent. Le choix est retenu par le navigateur.
- **Réinitialiser les réglages** remet tous les réglages et le thème à leur valeur d'origine, après
  confirmation. Le fichier ouvert et la lecture en cours sont conservés.
- En dessous de 960 px de large, le panneau des réglages devient un tiroir : le bouton à trois traits de la
  barre l'ouvre et le ferme, comme un clic à côté du tiroir ou la touche Échap. Le lecteur reste
  affiché, et le transport reste en bas de l'écran.
- En dessous de 600 px, **Ouvrir** et **Exporter** ne sont plus que dans le menu, et les boutons de
  déplacement ne montrent que leur icône.

### Réglages propres à la version web

- **Accords lus dans le fichier** : quand plusieurs notes sonnent ensemble dans le fichier (toutes
  pistes confondues, cochées ou non), l'accord joué est celui qu'elles forment, majeur, mineur ou
  diminué, amené dans la **Tonalité globale**. Une note qui sonne seule reçoit, comme dans
  l'application de bureau, l'accord que la gamme lui donne.
- **Tonalité du morceau** : la tonalité détectée est proposée ; si elle est fausse, en choisir une
  autre dans la liste. Le morceau est transposé de cette tonalité vers la **Tonalité globale**.
- **Une seule note ou un seul accord à la fois** (coché au départ) : une nouvelle note coupe la
  précédente, ce qui évite que les accords de notes qui se chevauchent sonnent ensemble.
- **Mélodie seule** est cochée au départ, contrairement à l'application de bureau.
- **Accord adapté aux notes hors tonalité** : une note étrangère à la gamme reçoit un accord qui
  la contient, au lieu de l'accord de repli (La mineur).
- **Lisser les accords** (cochée au départ) : parmi les accords lus dans le fichier, ceux de moins
  de trois quarts de temps qui sont encadrés par le même accord, ou qui commencent entre deux temps,
  disparaissent (accords de passage portés par la mélodie). Un changement bref sur un temps reste.
  Les accords écrits dans le fichier ou choisis sur la frise ne sont pas touchés.
- **Boucle** : **A** pose le début et **B** la fin à la position courante ; la lecture répète ce
  passage. **Effacer** retire la boucle.

### Accords écrits

Un accord calculé peut être remplacé par un accord écrit, de deux façons.

**Dans le fichier MIDICSV**, par une ligne `Text_t` dont le texte est le nom de l'accord. L'accord
vaut pour les notes qui commencent à cet instant ou après, toutes pistes confondues, jusqu'à
l'accord écrit suivant ; `auto` rend la main aux accords calculés :

```
2, 0,    Text_t, "Lam"
2, 0,    Note_on_c, 0, 67, 90
2, 720,  Note_off_c, 0, 67, 0
2, 1440, Text_t, "Fa"
2, 2880, Text_t, "auto"
```

- Les noms s'écrivent dans l'une ou l'autre notation (`Do` ou `C`, `Lam` ou `Am`, `Sib` ou `Bb`),
  avec `#` ou `b`, suivis de rien (majeur), de `m` ou de `dim` : ce sont les accords dont
  l'application connaît le doigté. Tout autre texte (`Sol7`, des paroles) reste un simple texte ;
  les lignes `Marker_t` ne sont pas lues.
- L'accord est écrit dans la tonalité du fichier, comme les notes qui l'entourent : il suit la
  **Tonalité globale** et la transposition, comme un accord calculé.
- Le texte d'un fichier MIDI (méta-message de texte) est lu de la même façon.

**Sur la frise**, en mode **Accord 6 Cordes** : cliquer sur le nom d'un accord, choisir sa
fondamentale et son type, tels qu'on veut les entendre. Le choix vaut jusqu'au changement d'accord
suivant, et s'entend tout de suite si la lecture est en cours ; **Automatique** revient à l'accord
calculé. Les accords écrits sont affichés dans la couleur d'accent.

**Enregistrer les accords (CSV)...**, dans le menu, télécharge le fichier MIDICSV ouvert avec ses
lignes `Text_t` d'accords mises à jour ; le reste du fichier est recopié tel quel. Un fichier MIDI
ne s'enregistre pas ainsi : les accords choisis y sont perdus à la fermeture de la page.

Le nom des pistes (lignes `Title_t`) est repris dans la liste des pistes. Les repères (lignes
`Marker_t`, ou repères d'un fichier MIDI) marquent le début des parties du morceau sur la frise,
par un trait et leur nom.

### Styles de strumming

En mode **Accord 6 Cordes**, la liste **Style de strumming** remplace le découpage de chaque note
en N strums (« Classique ») par un motif rythmique d'une mesure, joué en croches sur les temps du
morceau. L'accord de chaque coup est celui de la note de mélodie qui sonne à cet instant ; pendant
un silence de la mélodie, l'accord précédent continue. Un coup coupe le précédent.

| Style | Motif d'une mesure à 4 temps (B = bas, H = haut, . = silence) | Cordes |
|---|---|---|
| Feu de camp | B . B H . H B H, premier temps accentué | toutes vers le bas, les 4 aiguës vers le haut |
| Va-et-vient | B H B H B H B H, premier temps accentué, coups sans silence | toutes, vers le bas puis vers le haut |
| Rock | B B B B B B B B, temps 2 et 4 accentués, notes courtes | les 3 graves |
| Jazz | B . B . B . B h, temps 2 et 4 accentués, levée ternaire | les 4 graves, levée sur les 3 aiguës |
| Reggae | . H . H . H . H, coups très courts | les 3 aiguës |

Le **Tempo du style** est lu dans le fichier (changements de tempo compris). Si le fichier n'a pas
de tempo fiable, saisir une autre valeur : le motif suit alors une pulsation régulière à ce tempo.
La vitesse s'applique aussi au motif. L'export écrit les mêmes coups que la lecture.

Limites : les cordes étouffées sont imitées par des notes très courtes, la mélodie elle-même n'est
pas jouée par-dessus le motif, et seul le premier chiffrage de mesure du fichier est pris en compte.

### Clavier

| Touche | Effet |
|---|---|
| Espace | Écouter, puis pause et reprise. |
| ← et → | Reculer et avancer de 5 s. |
| Début (Home) | Revenir au début. |

Les flèches gardent leur rôle habituel quand un curseur, un champ ou une liste a le focus, et
Espace actionne le bouton qui a le focus dans la barre. Les raccourcis sont suspendus tant que le
menu, le tiroir des réglages ou un message est ouvert.

## Fichiers d'exemple

Le dossier `examples/` contient deux fichiers MIDI simples (« Au clair de la lune », Do Majeur,
100 noires par minute, 38 s) pour vérifier l'application à l'oreille :

- `au_clair_de_la_lune.mid` : une seule piste, la mélodie ;
- `au_clair_de_la_lune_3_pistes.mid` : mélodie, basse et accords sur trois pistes, pour essayer
  le choix des pistes.

Ils sont écrits par `python tools/make_examples.py`, et se chargent aussi depuis le menu de
l'application.

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
| `src/midicsv.ts` | Lecture des fichiers MIDICSV, écriture des accords dans leur texte. | `read_midicsv` |
| `src/logic.ts` | Notes du fichier, tonalité, mélodie seule, doigtés, strumming, export. | Section 2 |
| `src/player.ts` | Moteur de lecture temps réel. | `LivePlayer` |
| `src/audio.ts` | Sortie sonore (Web Audio) et conduite du moteur. | `pygame.midi` |
| `src/ui/timeline.ts`, `src/ui/chord.ts` | Frise du morceau et diagramme d'accord. | `draw_timeline`, `draw_chord` |
| `src/ui/canvas.ts` | Outils de dessin et couleurs des canevas, lues dans le thème affiché. | |
| `src/ui/shell.ts` | Tiroir des réglages, menu, thème, icônes des boutons. | |
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
| Fenêtre | Taille fixe. | Page qui s'adapte à la largeur de l'écran : réglages à côté du lecteur, ou en tiroir sur petit écran. |
| Thème | Clair. | Clair ou sombre, selon le système ou au choix. |
| Curseurs | Sans valeur affichée. | La valeur est écrite à côté du curseur. |
| Fichiers MIDI à division SMPTE | Lus avec des temps faux. | Refusés avec un message. |
| Pause | Absente : Arrêter puis Écouter repart du début. | Bouton **Pause / Reprendre**. |
| Tonalités | Quatre. | Les 24 tonalités majeures et mineures. |
| Déplacement | Seulement pendant la lecture. | Aussi à l'arrêt : la lecture part de la position choisie. |
| Pistes | Toutes les pistes sont jouées ensemble. | Choix des pistes jouées ; au chargement, seule la mélodie probable. |
| Accords | Un accord par note, d'après la gamme. | L'accord que forment les notes qui sonnent ensemble dans le fichier ; d'après la gamme pour une note seule. |
| Accords écrits | Absents. | Lus dans les lignes `Text_t` du fichier, modifiables sur la frise, enregistrés dans le fichier MIDICSV. |
| Réglages de départ | « Mélodie seule » décochée. | « Mélodie seule » et « Une seule note ou un seul accord à la fois » cochées. |
| Fichier sans note | Remplacé par une note de secours. | Refusé avec un message. |
| Boucle, volume, raccourcis clavier, réglages retenus | Absents. | Présents. |
| Styles de strumming | Absents : N strums par note. | Feu de camp, va-et-vient, rock, jazz, reggae, en plus du découpage par note. |

Les autres limites connues de l'application de bureau sont conservées : export avec un seul jeu de
réglages, fichiers de type 2 non pris en charge.

## Sons : origine et licence

Les échantillons de `public/soundfonts/MusyngKite` (guitare nylon, guitare acier, piano) viennent
de <https://github.com/gleitz/midi-js-soundfonts>, qui les a produits à partir de la banque de sons
Musyng Kite. Ils sont distribués sous licence
[Creative Commons Attribution - Partage dans les mêmes conditions 3.0](https://creativecommons.org/licenses/by-sa/3.0/deed.fr)
(CC BY-SA 3.0), sans modification. Cette licence ne couvre que ces fichiers, pas le code de
l'application.
