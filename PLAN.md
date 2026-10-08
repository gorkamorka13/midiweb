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
| Git | Commits per phase. Remote `origin` = `github.com/gorkamorka13/midiweb`. Nothing pushed yet. |
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
      `dist/`. Added on branch `add-pages-workflow`; not yet merged to `main`, so it has not run.

### Status on 2026-10-08
- `npm test`: 122 tests pass.
- `npm run build`: was failing (three type errors: `Timeline.setSeekable` renamed, `LiveParams`
  missing `mono` / `chromatic` / `loop`, `Playback` missing its position and duration). Fixed in
  `src/main.ts` with defaults for the three new settings. Not committed yet.

## Next: publish and check

- [ ] **Licence of the samples.** The repo has no licence file for `public/soundfonts`. Find the
      terms of the MusyngKite set from `gleitz/midi-js-soundfonts` and record them in the README
      (attribution, or a NOTICE file) before the site goes public.
- [ ] **Merge and publish.** Merge `add-pages-workflow` into `main`, check the run in GitHub
      Actions, enable Pages (source: GitHub Actions), open the published URL and load a file.
- [ ] **Check the published site.** Confirm the samples load from the published URL (not only
      locally) and that the README's description of the samples is correct.
- [ ] **Other browsers.** Test Firefox, Safari and a phone. iOS is the strict one for audio: check
      that the first Écouter press unlocks sound and that the timeline works with touch.
- [ ] **Sound quality.** Timbre and volume balance need a listening test by the owner.
- [ ] **Keep the docs in step.** `README.md` (line 83 says samples come from `gleitz.github.io`,
      line 91 says four keys) and this file must match the code.

## Next: finish the features already in the code

These have an engine or drawing part but no control on the page yet.

- [~] **Loop a section.** `LivePlayer` loops, `Timeline.setLoop` draws the bounds. Missing: a way
      to set the start and end on the timeline, and a clear button. Wire `loop` in `readLiveParams`.
- [~] **Better chord for out-of-key notes.** `harmonyMap(scale, chromatic)` and `FULL_HARMONY`
      exist. Missing: a checkbox in the page; `chromatic` is `false` for now.
- [~] **Volume control.** `AudioOutput.setVolume` exists. Missing: a slider in the page.
- [~] **Choose the melody track.** `listParts` (in `logic.ts`) lists the tracks. Not used by the
      page. Missing: a track picker after a file is loaded, and the melody filter applied to the
      chosen track only. This is the biggest gain for multi-track files.
- [~] **Correct the detected key by hand.** The target key can already be chosen (dropdown), and
      the shift is computed from the detected key. Missing: a way to set the source key when the
      detection is wrong.
- [ ] **Seek and start from any position while stopped.** Seeking is only enabled during playback
      or pause (`setSeekEnabled` in `src/main.ts`). `Playback` takes a start position, but the page
      always passes 0.
- [ ] **One chord at a time in "Accord 6 Cordes".** Simultaneous notes each trigger their own chord
      and overlap. `mono` only covers single-note playback, so this needs a separate rule.

## Next: new improvements

- [ ] **Keyboard shortcuts.** Space for pause, arrows for seek.
- [ ] **Remember settings between visits.** Notation, instrument, speed and the other controls
      reset on every load. Store them in `localStorage`, with a fallback if storage is blocked.
- [ ] **Report an empty file.** An empty file is replaced by a fallback note, as in the desktop app
      (`src/logic.ts`, around line 97). Show a message instead, and keep the fallback behaviour
      only if a test requires it.

## Out of scope for this migration

Known limits of the desktop app that are kept as they are for now: export does not record live
changes, type 2 MIDI files are rejected, and SMPTE-timed files are rejected.

## Result of the migration checks (2026-10-08)

- Notes, detected key, melody filter, exported MIDI bytes and the playback engine's message
  sequence are identical to the Python app, on the synthetic fixtures and on three real MIDI files
  (local fixtures, not committed).
- Headless Chrome run against the dev server and the production build: file loading, error dialogs,
  playback, every setting changed during playback, seek buttons, click on the timeline, stop, play to
  the end, export, narrow screen. No console error. The file exported from the page is byte-identical
  to the Python export with the same settings.
- The sound itself was not listened to (the run was headless).
