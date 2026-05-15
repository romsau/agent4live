# Architecture & développement

Architecture interne, structure du projet, workflow dev et patterns importants.
Pour les bugs courants voir [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

---

## Architecture

```
Claude Code / Gemini CLI / OpenCode
        │  HTTP POST :19845/mcp  (Bearer token + Origin check)
        ▼
┌─────────────────────────────────────────────────────┐
│  node.script — app/index.js → app/server/index.js   │
│  • HTTP server + transport MCP Streamable HTTP      │
│  • 232 outils en 14 familles, file LOM séquentielle │
│  • Auto-discovery 3 clients (Claude/Gemini/OpenCode)│
│  • SSE streaming via MCP resources                  │
│  • Sert /ui (jweb) + /ui/state                      │
└──────────────┬──────────────────────────────────────┘
               │  Max.outlet / Max.addHandler (id-matched)
               ▼
┌─────────────────────────────────────────────────────┐
│  Patch Max — agent4live.amxd                        │
│  • js app/lom_router.js  : LiveAPI synchrone        │
│  • route ui_status / ui_log / ui_liveapi            │
└─────────────────────────────────────────────────────┘
               │
               ▼
         Ableton Live (LOM)
```

---

## Structure du projet

```
agent4live/                (repo root)
  README.md, LICENSE, package.json, eslint.config.js, .prettierrc, .gitignore
  node_modules/            (gitignoré)

  app/                     bundle inviolable Max + Node-for-Max
    agent4live.amxd        device source (Max for Live)
    index.js               trampoline — `require('./server')`
    lom_router.js          routeur LOM en Max [js] — AUTO-GÉNÉRÉ par concat
    lom_router/            sources du routeur (1 fichier par domaine)
      00_helpers.js        helpers cross-domain (paths, _byId, _unwrap…)
      10_dispatch.js       lom_request, lom_scan_peers, lom_session_state
      20_clips.js          notes, warp markers, audio info, envelopes
      30_devices.js        devices, params, IO routing, move
      40_racks.js          racks, drum pads, chains, macros, variations
      50_observers.js      push notifications via LiveAPI observers
      60_routing.js        track input/output routing
      70_session.js        cues, scenes, selection, scale, control surfaces
    server/                code Node.js
      index.js, config.js, discovery.js
      lom/{queue,transport,index}.js
      mcp/{server,sse}.js
      ui/{state.js, active.html, passive.html}
      tools/{define.js, index.js, raw, session, transport, tracks,
             clips, scenes, arrangement, application, racks, instruments}.js

  tools/                   tooling dev (plain Node.js, hors device-runtime)
    build/{build,concat-lom,watch-lom,gen-docs,jest-html-transformer}.js
    dev-server/{server.js, fixtures.js, wrapper.html}

  __mocks__/               Jest mocks (max-api stub etc.)
  app/server/**/*.test.js  Tests Jest co-localisés à côté des sources

  docs/                    cette doc + LOM_NOTES + TROUBLESHOOTING + api/ (généré)
  dist/                    artefacts de build (staging + agent4live.amxd frozen)
  coverage/                rapports Jest (gitignored)
```

**Inventaire des 232 outils** : la source de vérité est `grep "defineTool" app/server/tools/*.js`. Pas de listing dupliqué dans la doc — il dériverait à chaque ajout.

---

## Pourquoi un trampoline `app/index.js` ?

Max for Live charge `node.script` et `[js]` via un **file finder à plat** : aucun ne descend dans les sous-dossiers du patch. Si on disait `node.script server/index.js`, Max ne trouverait pas le fichier.

Solution : le trampoline `app/index.js` reste à plat à côté du `.amxd`, installe un hook `require.extensions['.html']` (pour le dev mode) et fait `require('./server')`. Une fois dans `app/server/`, Node résout les sous-dossiers normalement.

`esbuild` part de `app/index.js` et inline tout le `require()` chain (server/\* + SDK MCP + active/passive.html via le text loader) dans un bundle CJS unique.

**Conséquence** : `app/agent4live.amxd`, `app/index.js`, `app/lom_router.js` doivent rester **ensemble dans le même dossier**. C'est pour ça qu'on les a groupés dans `app/`.

---

## Structure du patch Max

| Objet                                           | Rôle                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| `node.script app/index.js @autostart 1`         | Entry Node-for-Max (trampoline)                                        |
| `js app/lom_router.js @autowatch 1`             | Routeur LOM en Max [js], hot-reload                                    |
| `route ui_status ui_log ui_liveapi`             | Dispatcher messages Node → patch                                       |
| `jweb`                                          | UI WebKit 360×170, contrôlée via `Max.outlet('ui_status', 'url', ...)` |
| `live.numbox` (varname `__agent4live_marker__`) | Marker invisible — sert au scan multi-device                           |

---

## Workflow de développement

**Drag-and-drop direct depuis le repo cloné** (zero sync) :

1. Ouvrir le dossier du repo dans Finder
2. Drag-drop `app/agent4live.amxd` vers une piste Ableton
3. Modifier les fichiers dans `app/server/` ou `app/lom_router/`
4. Retirer le device et le re-drag-dropper

> Si tu touches à `app/lom_router/`, lance `npm run dev:lom` en parallèle —
> il watch le dossier et regénère `app/lom_router.js` à chaque save (Max
> hot-reload via `[js @autowatch 1]`).

**Itérer l'UI dans Chrome** (plus rapide que redrop) :

```bash
npm run dev    # http://127.0.0.1:19846/
```

Watch sur `app/server/ui/{state.js, active.html, passive.html}` et `tools/dev-server/{wrapper.html, fixtures.js}`. Source de vérité unique : on édite **toujours** dans `app/server/ui/`, jamais dans `tools/dev-server/`.

> Limite : jweb tourne sur une vieille WebKit. Certains CSS modernes (container queries, `:has()`) passent en preview Chrome et cassent dans le device. Valider dans le vrai jweb pour les designs sensibles.

**Générer le `.amxd` distribué** :

```bash
npm run build    # → dist/staging/{agent4live.amxd, index.js, lom_router.js}
```

Puis manuellement dans Max : ouvrir `dist/staging/agent4live.amxd` → **Freeze Device** (icône flocon) → **File > Save As** → `dist/agent4live.amxd`.

> Pourquoi le Freeze manuel ? Dans Max 9 / Node for Max 2.1.3, `embed: 1` via `textfile.content` ne marche **ni pour `js` ni pour `node.script`**. La fonction officielle "Freeze Device" utilise un format binaire différent qui, lui, fonctionne.

**Modifier le patch `.amxd`** : Edit dans Live → modifier dans Max → `Cmd+S`. Ne **jamais** éditer le `.amxd` manuellement (le header binaire stocke la taille du JSON, mismatch = device cassé).

**Générer la doc API** :

```bash
npm run docs    # → docs/api/{lom_router,server-core,tools-*,…}.md + README.md
```

Sortie en Markdown (gitignorée), une fichier par domaine pour éviter le TOC plein de `register()` qui collisionnent. Régénérer après chaque modif de JSDoc.

---

## Patterns importants

### File LOM séquentielle

Tous les appels LOM passent par `enqueue(fn)` (`app/server/lom/queue.js`). **Un seul appel en vol à la fois**. Évite que des chaînes "delete puis add" interleavent. Pas de `Max.outlet('lom_*', ...)` direct depuis Node ailleurs que dans `app/server/lom/transport.js`.

### Pont Node ↔ Max

Pour `lom_get` / `lom_set` / `lom_call` (op générique) :

```
Node:    Max.outlet('lom_request', id, op, nParts, ...path, prop, ...values)
Max [js]: lom_request(id, op, ...) { ... }
          outlet(0, 'lom_response', id, 'ok'|'error', value)
Node:    Max.addHandler('lom_response', (id, status, value) => ...)
```

Pour les handlers dédiés (Dict-passing, Dict-return, parsing custom) chacun a son propre nom d'outlet : `lom_add_clip`, `lom_get_clip_notes`, etc. Helper côté Node : `lomCustomCall(opName, ...args)`.

Matching par `id` entier auto-incrémenté. Timeout 10s (`LOM_TIMEOUT_MS` dans `app/server/config.js`).

### Auth Bearer + Origin check

`/mcp` exige un Bearer token 16-bytes hex généré au boot, persisté dans `~/.agent4live-ableton-mcp/endpoint.json` (chmod 600). Survit aux restarts du device — sinon les configs MCP des CLIs casseraient à chaque relaunch.

```
boot →  loadOrGenerateToken()       ← lit endpoint.json existant ou crypto.randomBytes(16)
        writeFileSync(endpoint.json, ...)
        bootstrapPreferences(url)   ← migration silencieuse (Claude/OpenCode flat-JSON) + env var
        setupConsentedClients(prefs, url, token)
                                    ← register UNIQUEMENT les agents au consent persisté

handleMCP(req, res) →
  isLocalOrigin(req.headers.origin) ?  ← 403 sinon (CSRF defense)
  Bearer X = uiState.token ?           ← 401 sinon
  → MCP server normal
```

`token` n'est **jamais exposé via `/ui/state`** (le handler le strip avant sérialisation).

**Pourquoi pas mTLS** : trop lourd pour un device local (com 127.0.0.1 uniquement). Bearer + Origin couvre les vecteurs réalistes (page web malveillante, process tiers, extension navigateur compromise) sans demander à l'utilisateur de gérer des certificats.

### Consentement opt-in (single-agent)

Le device ne touche **jamais** une config CLI sans consentement explicite. Au 1er boot, un modal non-skippable (UI 360×170) propose de cocher **un seul** agent — la mutex est gérée côté UI (cocher l'un décoche les autres) et le serveur applique la bascule via `POST /preferences` (batch atomique).

```
~/.agent4live-ableton-mcp/preferences.json (chmod 600, schema v1) :
  {
    "version": 1,
    "agents": {
      "claudeCode": { "consented": true,
                      "consented_at": "2026-05-03T14:20:00.000Z",
                      "url_at_consent": "http://127.0.0.1:19845/mcp" },
      "gemini":   { "consented": false },
      ...
    }
  }
```

Endpoints HTTP exposés (tous derrière le check Origin) :

- `GET /preferences`
- `POST /preferences` (batch — utilisé par le modal pour la mutex)
- `POST /preferences/agent/:name` (toggle d'un seul agent)
- `POST /preferences/reset`

UI : la card AGENT dans le header est cliquable et **rouvre** le modal post-consent (re-clic ferme = "miss click"). Chaque ouverture rend les checkboxes **toutes décochées** ; cocher un agent persiste immédiatement et ferme le modal.

**Migration silencieuse** au tout 1er boot (`preferences.json` absent) : on scanne les 3 configs CLI à la recherche d'une entrée `agent4live-ableton` pointant sur localhost, et on adopte ces consents implicites pour ne pas casser un user qui upgrade depuis l'ancien auto-register.

| CLI         | Fichier                            | Format | Champ URL                  |
| ----------- | ---------------------------------- | ------ | -------------------------- |
| Claude Code | `~/.claude.json`                   | JSON   | `mcpServers[name].url`     |
| OpenCode    | `~/.config/opencode/opencode.json` | JSON   | `mcp[name].url`            |
| Gemini      | `~/.gemini/settings.json`          | JSON   | `mcpServers[name].httpUrl` |

Toutes les branches de migration sont défensives (`try { } catch (_) {}`) : un fichier malformé retombe sur le modal, pas de régression.

**Var env `AGENT4LIVE_AUTO_REGISTER=claude,gemini,opencode`** : court-circuit pour CI / headless. Marque les agents listés comme consentis avant l'affichage du modal.

### Multi-device — mode passif

Plusieurs devices dans le même Live → un seul peut bind `:19845`. Les autres détectent l'`EADDRINUSE` et passent en **mode passif** :

```
boot →  httpServer.listen(19845)
          ├─ success     → activeBoot()  (discovery + boot ping + UI normale)
          └─ EADDRINUSE  → enterPassiveMode()
                          • setInterval(5s) → passiveTick()

passiveTick() :
  httpServer.listen(19845)   ← retry-bind (auto-takeover si l'actif meurt)
  lomScanPeers()             ← cherche le marker dans les devices de toutes les tracks
                                → si peer trouvé : émet data URL passive.html avec son trackName
```

**Ce que fait le passif** : retry-bind, scan, refresh UI. **Ce qu'il ne fait pas** : aucun MCP, aucune discovery (pas de `mcp add`), aucune écriture `endpoint.json` (sinon écraserait l'actif).

**Marker** : chaque device contient un `live.numbox` caché avec scripting name `__agent4live_marker__`. `lom_scan_peers` itère devices/parameters et reconnaît un agent4live à la présence de ce paramètre. Robuste au rename du device par l'utilisateur.

### UI (jweb) + uiState

Polling : la page sert `GET /ui` (HTML statique inliné dans `app/server/ui/active.html`), poll `GET /ui/state` toutes les 500ms et update le DOM. Pas de WebSocket, pas de SSE pour l'UI.

`uiState` est un **singleton in-memory** partagé via le cache CommonJS (chaque `require('../ui/state')` retourne la même référence). Forme :

```js
{ mode, activePeer, connected, port, liveApiOk, latencyMs, logs[],
  agents: { claudeCode, gemini, opencode } }
```

`logs[]` = max 50 entrées `{ts, tool, result, isError}`, FIFO via `uiLog()`.

### SSE streaming via MCP resources

Le serveur expose `resources/{subscribe,unsubscribe,read}`. URI scheme : `live:///<path>?prop=<prop>[&throttle_ms=N]` où le path utilise `/` comme séparateur (devient des espaces côté LOM). Map `uri → {sessions, observerId}` avec **ref-counting** : 1er sub crée l'observer côté Max [js], dernier unsub le libère. `Max.addHandler('lom_event', ...)` fan-out à tous les sessions abonnés via `sendResourceUpdated`.

---

## Ajouter un nouvel outil LOM

**Cas A — wrapper fin** (la majorité) : la primitive existe (`lomGet/Set/Call`). Un seul fichier à toucher : ajouter `defineTool(server, {name, description, schema, handler, successText})` dans le bon `app/server/tools/<famille>.js`. Si la famille n'existe pas, créer le fichier + l'enregistrer dans `tools/index.js` ET dans `mcp/server.js#registerTools()`.

**Cas B — handler dédié** (méthode prend un Dict, parsing custom) : 4 emplacements dans l'ordre :

1. `function lom_<name>(id, ...args)` dans le bon fichier de `app/lom_router/` (par domaine — voir la table dans la structure du projet plus haut)
2. Helper Promise dans `app/server/lom/transport.js` ou wrapper one-liner via `lomCustomCall`
3. Export dans `app/server/lom/index.js`
4. `defineTool` dans la famille pertinente

La description du tool est cruciale (les agents matchent les prompts via). Voir le skill user-level `lom-tool-author` pour le workflow complet et les pièges.

---

## Pattern : LOM functions qui prennent un Dict

Live 11+ : certaines méthodes (ex. `add_new_notes`) attendent un objet `Dict`, **pas son nom string** :

```js
// dans app/lom_router/20_clips.js
var d = new Dict();
d.parse(JSON.stringify({ notes: [...] }));
clip.call('add_new_notes', d);          // ✓
// PAS clip.call('add_new_notes', d.name);            // ✗ silent no-op
// PAS clip.call('add_new_notes', JSON.stringify(...)); // ✗ idem
```

Ces calls retournent `ok` sans rien faire si le format est mauvais → **toujours read-back** (`get_notes_extended` etc.) avant de croire au "ok".

## Pattern : LOM functions qui retournent un Dict

Symétrique. Live 12+ retourne directement une **string JSON** ; Live ≤ 11 retournait un nom de Dict à binder via `new Dict(name)`. Le helper `_dictReturnToJson(raw)` dans `app/lom_router/00_helpers.js` gère les deux cas :

```js
function _dictReturnToJson(raw) {
  if (typeof raw === 'string' && raw.charAt(0) === '{') return raw; // Live 12+
  var dictName = Array.isArray(raw) ? raw[raw.length - 1] : raw;
  return new Dict(dictName).stringify(); // Live ≤ 11
}
```

**Piège** : si on bind directement `new Dict(raw)` sur Live 12+ sans le helper, Live crée un Dict vide avec la string JSON comme nom → `get_clip_notes` retourne `{}` même quand le clip a des notes.
