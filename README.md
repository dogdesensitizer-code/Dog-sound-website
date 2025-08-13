# Dog Sensitivity App — Starter (MVP Skeleton)

This is a **simple, static** (no backend) starter you can open locally and later host on GitHub Pages. It matches the MVP from the blueprint: mobile-first, preloaded sounds (you can add later), adjustable playback, and simple mode presets.

## What's inside
- `index.html` — basic mobile-first UI
- `styles.css` — clean styles
- `app.js` — audio engine (volume, fade in/out, randomized delay), presets
- `ads-placeholder.html` — where to paste Google AdSense when approved
- `analytics-placeholder.js` — optional lightweight analytics stub
- `sounds/` — put your MP3/WAV files here (see below)
- `LICENSE` — MIT License
- `.gitignore` — common ignores
- `README.md` — this file

## Run locally
1. Double-click **index.html** (it will open in your browser).
2. If your browser blocks local audio due to autoplay, click once anywhere in the page, then press Play.

> Tip: In VS Code you can also use the "Live Server" extension for easy reloads.

## Add sounds
Put your audio files in the **sounds/** folder. Update the names in `index.html` under the "Sound Library" list or keep the existing names and replace the files:
- fireworks_distant.mp3
- thunder_rumble.mp3
- crowd_murmur.mp3

## Deploy (GitHub Pages)
1. Create a **new GitHub repo** (public is fine for Pages).
2. Upload all files (drag-and-drop in the GitHub web UI or push via git).
3. In the repo, go to **Settings → Pages**. Choose:
   - **Source**: Deploy from a branch
   - **Branch**: `main` / root
4. Wait a minute; your site will appear at: `https://<your-username>.github.io/<repo-name>/`

## Next steps (later)
- Replace `ads-placeholder.html` with your AdSense script
- Add real audio files into `sounds/`
- Add a service worker for offline (PWA) — we can do this when you're ready
- Hook up real analytics if desired

---

© 2025 — MIT License (see `LICENSE`)
