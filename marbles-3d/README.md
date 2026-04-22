# marbles-3d

3D marble race overlay for Twitch / Kick streams. Viewers `!join` the lobby, a random track is generated, and marbles race down it with chat-driven boosts and jumps.

## Chat commands

| Command | Who | When | What |
|---|---|---|---|
| `!lobby` | mod | idle | Open the lobby and generate a track |
| `!join` | anyone | lobby | Spawn a marble in the start pen |
| `!skin <name>` | anyone | lobby | Pick a skin (see list below); camera snaps to the viewer |
| `!start` | mod | lobby | Begin the countdown |
| `!boost` | anyone | racing | One-time speed boost (cooldown) |
| `!jump` | anyone | racing | Short vertical impulse (cooldown) |
| `!endrace` | mod | countdown / racing | Force-end the race |
| `!camera <target>` | mod | countdown / racing / finished | `auto` / `all` / `<username>` — switch spectator view |
| `!cam <target>`, `!spectate <username>` | mod | same | Aliases for `!camera` |

## Skins

A viewer's skin persists in the overlay's `localStorage` (key `marbles-3d:viewer-skins`). Same username → same skin across races in the same browser / OBS browser source. Clearing storage or switching machines resets it. Unknown skin names are silently ignored.

Skin changes are only accepted during the `lobby` state. Once the countdown starts, a viewer is locked into whatever they last chose. If they change their skin while already joined, the live marble's material updates instantly and the camera cuts to them so they can see it.

### Available skins

**Solid** — `ruby`, `sapphire`, `emerald`, `amethyst`, `jade`, `pearl`, `obsidian`, `gold`, `silver`, `copper`

**Glow** — `neon-pink`, `neon-green`, `neon-cyan`

**Patterned** — `soccer`, `baseball`, `8ball`, `earth`, `galaxy`, `wood`, `rainbow-stripes`, `cow`

Example: `!skin galaxy`

Patterned skins use procedural canvas textures generated at runtime. To swap in hand-authored PNGs, drop a file at `marbles-3d/assets/skins/<id>.png` and change the corresponding entry in [skins.js](skins.js) from `procedural: '<name>'` to `texture: 'assets/skins/<id>.png'`.

## Query parameters

Pass via the overlay URL: `index.html?twitch=channelname&debug=true&marbleRadius=0.4`

- `twitch=<channel>` / `kick=<channel>` — chat source
- `debug=true` — show the overlay stats panel
- `demo=true` — demo mode
- `seed=<int>` — deterministic track
- `gravity`, `startSpeed`, `boostDeltaV`, `boostCooldownMs`, `jumpDeltaV`, `jumpCooldownMs`, `marbleRadius`, `raceTimeoutMs`, `resultsDurationMs`, `countdownMs`, `showNames` — physics / timing tuning
