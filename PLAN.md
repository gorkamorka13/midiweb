# Guitar MIDI Strummer: plan and status

Source: `C:\www\midi\midi.py` (Python, Tkinter, mido, pygame.midi).
Target: this repository, a static web app (HTML, CSS, TypeScript bundled by Vite).

Status legend: `[ ]` to do, `[~]` partly done (code exists, not finished or not wired to the page),
`[x]` done. Updated 2026-10-08.

## Decisions

| Topic | Decision |
|---|---|
| Stack | Static site. HTML + CSS + TypeScript modules, bundled by Vite. No React, no server. |
| Scope | Port of `midi.py` first (done). Improvements come after, in the phases below. |
| Language | French for the interface, same texts as the desktop app. |
| Git | Commits per phase. Remote `origin` = `github.com/gorkamorka13/midiweb`. |
| MIDI read/write | Own small module modelled on mido 1.3.3, so results match the Python version exactly. |
| Sound | `smplr` 1.1.0 `Soundfont` instruments on Web Audio, samples served from `public/soundfonts`. |
| Tests | Vitest, against reference data produced by the real `midi.py`. |
| Deployment | GitHub Pages, built by `.github/workflows/deploy.yml` on push to `main`. |

## What changes compared with the desktop app

These are forced by the browser, not design choices.

1. **Sound.** The Microsoft GS Wavetable synth is replaced by sampled instruments. The timbre is
   different. The samples are served with the site, so no network request is needed for sound.
2. **Timing.** The 5 ms thread loop becomes a 10 ms tick that schedules notes 80 ms ahead on the
   audio clock. A setting changed during playback is heard about 80 ms later.
3. **Files.** "Parcourir..." opens the browser file picker, and a file can also be dropped on the
   page. "Exporter le MIDI..." downloads the file instead of opening a save dialog.
4. **Window.** The fixed 752 x 665 window becomes a responsive page. The timeline takes the
   available width.
5. **Message boxes.** Tk dialogs become an in-page dialog. The export success box names the
   downloaded file instead of its full path, which the browser does not give to the page.
6. **SMPTE-timed MIDI files** are rejected with a clear message (mido reads them with negative
   times, which is not worth reproducing).

## Target layout

```
index.html            page structure (3 setting groups, now-playing panel, timeline)
src/guitar.ts         tables and naming helpers (section 1 of midi.py)
src/midifile.ts       Standard MIDI File reader and writer (mido-compatible)
src/midicsv.ts        read_midicsv
src/logic.ts          analyze_input_midi, detect_key, keep_highest_notes, strum_layout,
                      sweep_delay, note_events, generate_processed_midi
src/player.ts         LivePlayer, driven by an injected clock (testable without audio)
src/audio.ts          AudioContext, smplr instruments, worker tick
src/ui/timeline.ts    timeline drawing, playhead, scrolling, seek
src/ui/chord.ts       chord diagram
src/main.ts           GuitarMidiApp: wiring of controls, status, file loading, export
src/style.css
public/soundfonts/    instrument samples (MusyngKite, mp3 and ogg)
tools/make_fixtures.py   builds test MIDI files and reference outputs with the real midi.py
tests/                   Vitest suites and fixtures
.github/workflows/deploy.yml   build and GitHub Pages deployment
```

## Completed work

### Migration (phases 0 to 7): done
- [x] Repository, tooling, reference fixtures from `midi.py`, pure logic, playback engine,
      audio adapter, interface, browser verification, README (French).
- [x] Pause / Reprendre button (`LivePlayer.pause` / `resume`, `tests/pause.test.ts`).
- [x] Key dropdown lists all 24 keys (12 major, 12 minor), not four.
- [x] Sample files committed under `public/soundfonts` and loaded from the site's own base URL
      (`src/audio.ts`), so sound no longer depends on `gleitz.github.io` at run time.
- [x] GitHub Pages workflow (`.github/workflows/deploy.yml`): `npm ci`, `npm run build`, publish
      `dist/`. Published at <https://gorkamorka13.github.io/midiweb/>; the owner confirmed it works.

### Improvements, first batch (2026-10-08): done

All wired in `src/main.ts` and `index.html`; the engine parts already existed.

- [x] **Choose the tracks.** A "Pistes jouées" list (one box per track and channel, from
      `listParts`) appears when a file has several. Only ticked tracks are played and exported;
      the others stay on the timeline in grey. Changing the choice acts on the running playback.
      The key is detected on the whole file, so it does not move with the choice.
- [x] **Play only the likely melody track by default.** `guessMelodyPart` (in `logic.ts`) scores
      each track: single notes, long presence, medium or high pitch, at least one note per second;
      a track name such as "Lead" or "Mélodie" wins. Reason: a 10-track arrangement played whole
      sent about 200 string hits per second in chord mode (measured on a real file), which the
      owner reported as superimposed and too fast. With the melody track alone it is about 22.
      The same file gave the same 200 before the track list existed, and in the first web version.
- [x] **Shorter fade-out of a cut note** (`RELEASE` in `src/audio.ts`, 0.1 s instead of the
      library's 0.3 s linear fade), so a chord no longer sounds under the next two strums. Not
      checked by ear.
- [x] **Example files** in `examples/`, written by `tools/make_examples.py`: a slow one-track
      melody and the same tune on three tracks.
- [x] **Cleaner defaults.** "Mélodie seule" and "Une seule note ou un seul accord à la fois" are
      ticked on a first visit (the desktop app starts with "Mélodie seule" unticked).
- [x] **Correct the detected key by hand.** "Tonalité du morceau" is a list: the detected key first,
      then the 24 keys. Reset to the detected key when a new file is loaded.
- [x] **Seek and start from any position while stopped.** The seek buttons and the timeline move a
      start cursor; Écouter starts there, Arrêter returns there.
- [x] **Loop a section.** A and B set the bounds at the current position, Effacer removes them.
- [x] **Better chord for out-of-key notes.** Checkbox, applied to playback, timeline and export.
- [x] **One note or one chord at a time.** Checkbox wired to `mono`, which applies in both modes
      (the earlier note here saying it only covered single notes was wrong). Applied to export too.
- [x] **Volume control.** Slider, 0 to 100 %.
- [x] **Keyboard shortcuts.** Space: play, then pause / resume. Left / right: seek 5 s. Home: start.
- [x] **Remember settings between visits.** `localStorage`, key `midiweb.settings.v2`; blocked or
      unreadable storage falls back to the defaults. The file, the track choice, the corrected key
      and the loop are not stored.
- [x] **Report an empty file.** The page shows a message and loads nothing. `analyzeInputMidi`
      keeps the desktop fallback note because the reference tests compare it with `midi.py`; the
      page now calls `readMidiInput` instead.
- [x] **Licence of the samples.** MusyngKite is CC BY-SA 3.0 (stated in the README of
      `gleitz/midi-js-soundfonts`); recorded in the README, section "Sons : origine et licence".
- [x] **Docs in step.** README updated for the samples' origin, the 24 keys and the new controls.

### Status on 2026-10-08
- `npm test`: 134 tests pass (12 new ones in `tests/options.test.ts`: loop, one note at a time,
  out-of-key chords, track change, melody track guess). `npm run build`: passes.
- Headless Chrome run against the dev server: every item above exercised, no console error.
- Not covered by a unit test: the wiring in `src/main.ts` (it is only checked in the browser).

## Next: check

- [ ] **Other browsers.** Test Firefox, Safari and a phone. iOS is the strict one for audio: check
      that the first Écouter press unlocks sound and that the timeline works with touch.
- [ ] **Sound quality.** Timbre and volume balance need a listening test by the owner. The new
      options (one chord at a time, out-of-key chords, loop) were checked for behaviour, not by ear.

## Next: ideas

- [ ] **Set the loop by dragging on the timeline**, instead of A / B at the current position.
- [ ] **Fewer strums on short notes.** Every note gets the chosen number of strums, so a 0.2 s
      note with 2 strums is hit twice in 0.2 s. A minimum strum length would calm fast passages.
      It changes the engine away from `midi.py`, so it needs an option or new reference data.

## Out of scope for this migration

Known limits of the desktop app that are kept as they are for now: export does not record live
changes (nor the loop), type 2 MIDI files are rejected, and SMPTE-timed files are rejected.

## Result of the migration checks (2026-10-08)

- Notes, detected key, melody filter, exported MIDI bytes and the playback engine's message
  sequence are identical to the Python app, on the synthetic fixtures and on three real MIDI files
  (local fixtures, not committed).
- Headless Chrome run against the dev server and the production build: file loading, error dialogs,
  playback, every setting changed during playback, seek buttons, click on the timeline, stop, play to
  the end, export, narrow screen. No console error. The file exported from the page is byte-identical
  to the Python export with the same settings.
- The sound itself was not listened to (the run was headless).
