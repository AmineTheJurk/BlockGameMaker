# 🧱 Block Game Maker

Make your own games on Android — with **blocks** or with **Lua** (like Castle).

* **Blocks**: 70 simply-named blocks in 9 colors. Every one is explained in `BlockGuide.html`.
* **Lua mode**: switch any object to Lua. The 🧩→📝 button turns your blocks into Lua so you can learn from them.
* **Template items**: Hero (jumper / top-down), Catcher, Platform, Rock, Coin, Walking enemy, Chasing ghost, Spikes, Goal flag, Falling star, Star maker, Bouncy ball, Score text, Restart button, Text label… plus 4 starter games.
* **Projects** are saved automatically and can be **exported as `.ckl`** (a JSON text file) and opened again (also by tapping a `.ckl` file).
* **Build Android app**: Game tab → "Build Android app (.apk)". It builds a real installable APK on the phone, with its own app name and package id.

## Build the maker app

Needs Android Studio (Koala or newer) or JDK 17 + the Android SDK (platform 34).

1. Open this folder in Android Studio and let Gradle sync (internet needed once).
2. Run the `app` configuration (or `./gradlew :app:assembleDebug`). Gradle first builds `:player` (the empty game shell), embeds it in the maker app, and copies `web/` into the app's assets.
3. The APK is in `app/build/outputs/apk/debug/`.

## Build with GitHub (no Android Studio needed)

Put the contents of this folder at the root of a GitHub repository and push. The workflow in
`.github/workflows/build.yml` builds the app, and attaches `app-debug.apk` to the run:
repo → **Actions** → latest run → **Artifacts** → `BlockGameMaker-apk`. You can also start it by hand with "Run workflow".

## Folder map

| Folder | What |
|---|---|
| `web/` | The whole app: `editor.*` (UI), `blocks.js` (every block + block→Lua), `engine.js` (game runtime), `lua.js` (Lua interpreter), `templates.js`, `player.html`, `docs/blocks.html` |
| `app/` | Android maker app (Kotlin): WebView host, project storage, `.ckl` import/export, `ApkBuilder.kt` |
| `player/` | Android game shell that becomes your game's APK |
| `tools/` | `gen_docs.js` (builds the block guide), `test_lua.js`, `test_all.js` |

## Add or change a block

Edit `web/blocks.js` (one `B({...})` entry: label, Lua generator, plain-words explanation, example), then run:

```
node tools/test_lua.js && node tools/test_all.js && node tools/gen_docs.js
```
`gen_docs.js` refuses to build if a block has no explanation, so the guide always covers every block.

## How "Build APK" works

`ApkBuilder.kt` copies the embedded player APK, adds your game as `assets/web/game.js`, swaps the package id
(`com.ckl.game.pppppppp` → `com.ckl.game.g<hash of project id>`) and app name (32-character placeholder) with
same-length byte replacement in the binary manifest, keeps `resources.arsc` uncompressed and 4-byte aligned, and
signs it with `apksig` (v1 + v2). The same game always gets the same package id, so installing again updates it.
The signing key in `app/src/main/assets/ckl_key.pk8` is for hobby use; generate your own before publishing anywhere.
App names are limited to letters, digits and `space _ . ! -` (max 32).

## Notes

* The Lua interpreter supports Lua 5.1-style code (tables, closures, metatables, pcall…). Not included: `goto`, coroutines, Lua patterns (`string.match/gmatch`; `find`/`gsub` work on plain text).
* Endless loops are stopped with a friendly message instead of freezing the game.
