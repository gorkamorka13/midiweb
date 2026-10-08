# Migration plan: Guitar MIDI Strummer, desktop to web

Source: `C:\www\midi\midi.py` (Python, Tkinter, mido, pygame.midi).
Target: this repository, a static web app (HTML, CSS, TypeScript bundled by Vite).

Status legend: `[ ]` to do, `[x]` done. This file is updated as the work advances.

## Decisions

| Topic | Decision |
|---|---|
| Stack | Static site. HTML + CSS + TypeScript modules, bundled by Vite. No React, no server. |
| Scope | Strict port of `midi.py`: same features, same rules, same labels. Improvements come later. |
| Language | French only, same texts as the desktop app. |
| Git | Local commits after each phase. Remote `origin` is set, nothing is pushed. |
| MIDI read/write | Own small module modelled on mido 1.3.3, so results match the Python version exactly. |
| Sound | `smplr` 1.1.0 `Soundfont` instruments on Web Audio (nylon guitar, steel guitar, grand piano). |
| Tests | Vitest, against reference data produced by the real `midi.py`. |

## What changes compared with the desktop app

These are forced by the browser, not design choices.

1. **Sound.** The Microsoft GS Wavetable synth is replaced by sampled instruments. The timbre is
   different. Samples are downloaded on first play from `gleitz.github.io` (smplr default), so
   the first play needs a network connection.
2. **Timing.** The 5 ms thread loop becomes a 10 ms tick that schedules notes 80 ms ahead on the
   audio clock. Notes land at their exact time; a setting changed during playback is heard about
   80 ms later.
3. **Files.** "Parcourir..." opens the browser file picker, and a file can also be dropped on the
   page. "Exporter le MIDI..." downloads the file instead of opening a save dialog.
4. **Window.** The fixed 752 x 665 window becomes a responsive page. The timeline takes the
   available width.
5. **Message boxes.** Tk dialogs become an in-page dialog. The export success box becomes a
   status line message, since the browser does not tell the page where the file was saved.
6. **SMPTE-timed MIDI files** are rejected with a clear message (mido reads them with negative
   times, which is not worth reproducing).

## Target layout

```
index.html            page structure (same 3 setting groups, now-playing panel, timeline)
src/guitar.ts         section 1 of midi.py: tables and naming helpers
src/midifile.ts       Standard MIDI File reader and writer (mido-compatible)
src/midicsv.ts        read_midicsv
src/logic.ts          analyze_input_midi, detect_key, keep_highest_notes, strum_layout,
                      sweep_delay, note_events, generate_processed_midi
src/player.ts         LivePlayer, driven by an injected clock (testable without audio)
src/audio.ts          AudioContext, smplr instruments, worker tick
src/ui/timeline.ts    draw_timeline, playhead, scrolling, click to seek
src/ui/chord.ts       draw_chord
src/main.ts           GuitarMidiApp: wiring of controls, status, file loading, export
src/style.css
tools/make_fixtures.py   builds test MIDI files and reference outputs with the real midi.py
tests/                   Vitest suites and fixtures
```

## Phases

### Phase 0: repository and tooling
- [x] Create `C:\www\midiweb`, `git init`, remote `origin` = `github.com/gorkamorka13/midiweb`.
- [x] `package.json` with Vite, TypeScript, Vitest, smplr.
- [x] Check the smplr API in the installed package (load, scheduled start, stop).
- [x] `tsconfig.json`, `vite.config.ts`, `.gitignore`. Commit.

### Phase 1: reference data from the Python app
- [x] `tools/make_fixtures.py`: imports `midi.py`, writes synthetic test files (multi-track, tempo
      changes, drums, overlapping and unterminated notes, chords, MIDICSV, invalid files).
- [x] For each file, dump: notes, detected key, "Mélodie seule" result, exported MIDI bytes for
      several setting combinations.
- [x] Dump `LivePlayer` runs under a simulated clock (scripted setting changes and seeks) as the
      exact sequence of note-on / note-off messages.
- [x] Optional local-only fixtures from real MIDI files (not committed).

### Phase 2: pure logic
- [x] `guitar.ts`, `midifile.ts`, `midicsv.ts`, `logic.ts`.
- [x] Tests: notes, key, melody filter and exported bytes identical to the Python references.
      Commit.

### Phase 3: playback engine
- [ ] `player.ts`: port of `LivePlayer._run` as a `tick(now)` step function.
- [ ] Test: same message sequence as the Python engine under the simulated clock. Commit.

### Phase 4: audio
- [ ] `audio.ts`: output adapter on smplr (one voice per sounding pitch, scheduled start/stop),
      instrument loading with status feedback, worker-driven tick.

### Phase 5: interface
- [ ] `index.html`, `style.css`: the three setting groups, now-playing panel, timeline,
      transport, status line and export button.
- [ ] `ui/chord.ts`, `ui/timeline.ts` on canvas.
- [ ] `main.ts`: all handlers of `GuitarMidiApp` (file, key, transpose, mode, melody, notation,
      instrument, strums, speed, sweep, play/stop, seek, export). Commit.

### Phase 6: verification in the browser
- [ ] `npm run build` and `npm test` pass.
- [ ] Load a file, play, change every setting during playback, seek, export, and re-import the
      export in the Python app's reader to confirm it is valid.
- [ ] Fix what the run shows. Commit.

### Phase 7: documentation
- [ ] `README.md` (French): usage, development commands, differences with the desktop app.
- [ ] Final state of this plan. Commit.

## Out of scope for this migration

Known limits of the desktop app that are kept as they are: four keys only, no pause, seeking
only during playback, export does not record live changes, empty file replaced by a fallback
note, type 2 files rejected. Publishing (push, GitHub Pages) is left to the repository owner.
