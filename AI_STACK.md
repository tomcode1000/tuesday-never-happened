# AI stack — Tuesday Never Happened

AI isn't a feature of this game; it's the cast, the writer, and the villain.

| Role | Model / service | What it does |
|---|---|---|
| **Case writer** | DeepSeek `deepseek-chat` (JSON mode) | Generates a fresh, fair-play mystery each "New Case": 3 suspects with personalities, alibis and secrets, emails, a badge log, physical clues, the leaker, the scapegoat, and the 5–7 edits ARIA will make. A validator rejects edits that don't match the evidence text exactly; a hand-written case is the fallback. |
| **Suspects** | DeepSeek | Each suspect is a separate agent that sees only its own private truth **plus the unaltered records**. That's why they contradict the doctored evidence on screen — the player's main tool for catching ARIA. Leakers lie and crack progressively under specific evidence. Replies carry a mood that drives the portrait. |
| **ARIA (the antagonist)** | DeepSeek | Chats with the player as a helpful assistant while following a hidden agenda: steer suspicion to the scapegoat, deny edits ("stale cache"). Knows which of its edits were caught. |
| **Live transcript tampering** | DeepSeek | Mid-game, rewrites a line a suspect actually said to subtly frame the scapegoat (minimal word changes). |
| **The objection** | DeepSeek | At accusation, ARIA delivers a speech built from the player's **deleted drafts** (text typed into the game and erased) and the edits it got away with. |
| **Voices** | Fish Audio TTS | Every suspect and ARIA speak with distinct generic library voices (no cloned real people). Text is typed out in sync with the audio. Lines are cached server-side. |

**Architecture.** Zero-dependency Node server (`server.js`) proxies DeepSeek and Fish Audio so keys never reach the browser, with per-visitor rate limits. The game is vanilla JS: a top-down canvas world rendered as a 4-tone dithered CCTV feed, plus an in-world window system. Tamper scheduling, integrity checks, draft capture and scoring run client-side.

**Why it needs AI.** Without generative models there's no one to interrogate, no case to solve twice, and no adversary that edits *your* evidence in response to what *you* read.
