# Gesture Deck

Present slides with your hands. Swipe to change slides, point to get a laser pointer, pinch to zoom. Everything runs in the browser using your webcam, and no video ever leaves your device.

<!-- Add a demo GIF here: ![Gesture Deck demo](demo.gif) -->

**Live demo:** https://anshikaaaasingh-afk.github.io/gesture-deck

## Gestures

| Gesture | Action |
|---|---|
| Open palm, swipe left | Next slide |
| Open palm, swipe right | Previous slide |
| Index finger pointing | Laser pointer follows your fingertip |
| Pinch and hold | Zoom into the spot you pinched |
| Fist held for 1 second | Lock or unlock gestures (so you can talk with your hands) |

Keyboard fallback: arrow keys or space to navigate, `C` for calibration view, `L` to load your own slides, `F` for fullscreen.

## Run it

The camera needs a secure context, so open it from `localhost` or GitHub Pages (not a plain `file://` URL).

```bash
python -m http.server 8000
# then open http://localhost:8000
```

No dependencies and no build step. It uses vanilla JS and [MediaPipe Hands](https://developers.google.com/mediapipe/solutions/vision/hand_landmarker) loaded from a CDN.

## Writing slides

Slides are Markdown. Separate slides with a line containing `---`. Supported: `#` and `##` headings, `-` bullet lists, paragraphs, `**bold**`, and `inline code`. Press `L` in the app to load your own `.md` file.

## How it works

1. **Landmarks:** MediaPipe returns 21 hand landmarks per frame.
2. **Classification:** a finger counts as extended if its tip is farther from the wrist than its middle joint. Pinch is the thumb-to-index distance divided by palm size, which makes it scale-independent. From these, each frame is labelled `point`, `pinch`, `open`, `fist` or `none`.
3. **Debouncing:** a pose must hold for 3 consecutive frames before it counts, which removes flicker.
4. **Swipe detection:** the palm's horizontal position is tracked over a 350 ms window. A move of more than 25% of the frame width triggers a slide change, followed by a 900 ms cooldown so a single swipe can't fire twice.
5. **Lock gesture:** holding a fist for 1 second toggles lock, and the fist must be released before it can toggle again.
6. **Laser smoothing:** exponential smoothing on the fingertip position removes jitter.

## Project structure

```
index.html   page and layout
style.css    styling
app.js       slides, gesture logic, camera
```

## Roadmap

- [ ] Optional Claude API step that turns pasted notes into slide Markdown
- [ ] Record the session
- [ ] Per-user gesture sensitivity settings
- [ ] Two-hand zoom
# Gester-deck
