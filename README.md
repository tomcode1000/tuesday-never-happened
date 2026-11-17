# TUESDAY NEVER HAPPENED

> Someone inside Envydia leaked the chip. The computer you're investigating on is rewriting the evidence.

An AI social-deduction game for the **€1,000 AI Game Challenge: Operation Leather Jacket** (Slush 2026). One 15-minute round: walk Envydia HQ at 3 AM, interrogate three AI suspects who answer in their own voices, and find the leaker — while ARIA, the company's helpful AI, quietly edits every record you've already read.

- **Rules:** [RULES.md](RULES.md)
- **AI stack:** [AI_STACK.md](AI_STACK.md)
- **Credits & licenses:** [CREDITS.md](CREDITS.md)

## Run locally
Requires Node 18+. No `npm install` needed (zero dependencies).

```bash
# .env in the project root
DEEPSEEK_API_KEY=your_key
FISH_AUDIO_API_KEY=your_key   # optional — without it, characters "speak" in blips
PORT=5177

npm start   # → http://localhost:5177
```

Optional limits (`.env`): `LLM_PER_HOUR` (150), `TTS_PER_HOUR` (120), `DAILY_CAP` (6000).

## Deploy (existing Lightsail + Caddy box)
See `deploy/lightsail-add.sh` (adds the app on its own port/service and appends a Caddy site) and `deploy/update.sh`.

## Layout
```
server.js            zero-dep server: static files + DeepSeek/Fish proxies + rate limits
voices.json          character → Fish Audio library voice
public/js/world.js   top-down world, CCTV dither renderer, movement, interaction
public/js/game.js    windows, interviews, ARIA, tampering engine, integrity checks, ending
public/js/casegen.js AI case generator + validator      public/js/case00.js  hand-written case
public/js/sfx.js     audio engine (recorded SFX + music)  public/js/voice.js   TTS playback
```

*Satire. All people, companies and products are fictional.*
