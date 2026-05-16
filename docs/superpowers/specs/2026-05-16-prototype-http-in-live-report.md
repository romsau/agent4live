# Prototype HTTP-in-Live — Rapport

**Date :** 2026-05-16
**Branche :** `proto/http-in-live` (archivée sous le tag `proto-archive-2026-05-16`, supprimée).
**Spec de design :** [`2026-05-15-prototype-http-in-live-design.md`](2026-05-15-prototype-http-in-live-design.md)
**Plan d'implémentation :** [`2026-05-15-prototype-http-in-live.md`](../plans/2026-05-15-prototype-http-in-live.md)

---

## Verdict : **NO** (pour la migration telle que spécifiée) — **MIDDLE** (pour une migration repensée autour de tools composites)

L'architecture _est_ techniquement viable — on a un serveur MCP HTTP qui tourne dans le process de Live et qui répond à Claude Code. Mais le bénéfice perf central promis par la roadmap (« 3-5× plus rapide que le pont JS↔Max actuel, 10-15 ms → 2-4 ms ») est **impossible** : la plateforme Live Python a un plancher de tick main-thread de **~100 ms** structurel.

**⚠️ Correction post-recherche (voir « Mise à jour — patterns de référence » plus bas) :** notre mesure de 500-600 ms n'est PAS le plancher plateforme — c'est le plancher de **notre pattern** (socket thread + queue + drain `update_display`), partagé par notre prod `agent4live` et par `Ziforge/ableton-liveapi-tools` qui font la même chose. AbletonOSC (5 ans de production, paper NIME 2023) atteint **~100 ms** en abandonnant le thread serveur et en faisant tout sur le main thread via `schedule_message(1, tick)`. Le verdict NO tient (100 ms reste 6-10× plus lent que le pont JS↔Max actuel), mais l'écart est plus serré que mesuré, et notre prod extension pourrait être 6× plus rapide en refactorant.

---

## Résultats par scénario

| Scénario                                                         | Critère                                                                       | Résultat                                                                                                                                                | Pass         |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **R1 — asyncio compatible avec Live main thread**                | Le ControlSurface tourne sans crash avec asyncio                              | Non testé directement                                                                                                                                   | ⚠️ moot      |
| **R2 — Deps SDK MCP chargeables par le Python embarqué de Live** | Import du SDK depuis `_vendor/`                                               | **Échec dur** : `ImportError: dlopen pydantic_core/_pydantic_core.cpython-311-darwin.so : symbol not found '_PyBaseObject_Type'`                        | ✗            |
| **S0a — Smoke FastMCP hors Live**                                | Serveur démarre, `tools/list` et `tools/call` répondent, p50 latence          | OK, **p50 = 2,99 ms / max = 4,32 ms** (5 calls)                                                                                                         | ✓            |
| **S0b — Chargement Fallback A dans Live**                        | Le ControlSurface boot et l'HTTP server répond aux 4 outils                   | OK : `agent4live_proto v1 started on 127.0.0.1:19846`, `tools/list` retourne les 4 outils, `lom_get('live_set tempo')` retourne 120.0 (vrai tempo Live) | ✓            |
| **S1 — Latence isolée (in-Live, 200 calls `lom_get`)**           | p50 < 4 ms, p99 < 15 ms                                                       | **p50 = 500 ms, p99 = 800 ms**                                                                                                                          | ✗            |
| **S1' — Comparatif prod extension (TCP :54321, 100 `ping`)**     | Si proto et prod ont le même plancher, la cause est structurelle              | **prod p50 = 600 ms, proto p50 = 500 ms** — pattern identique                                                                                           | (diagnostic) |
| **S2, S2-bis, S3, S4, S5, S6**                                   | Audio dropouts, endurance 12h, cycle Live, Claude Code real-client, observers | **Non exécutés** — S1 a fait sauter la prémisse                                                                                                         | —            |

---

## Métriques détaillées

### Latence host-only (Tâche 9 — smoke FastMCP avant chargement Live)

Stack complète SDK MCP + uvicorn + asyncio + FastBridge fictif, dans un Python host (hors Live). Validait R1 partiellement et l'intégrité du câblage.

```
Calls    : 5
p50_ms   : 2.99
mean_ms  : 3.26
max_ms   : 4.32
```

Baseline pour ce que le transport HTTP + MCP coûte « hors plateforme Live ». ~3 ms. C'est la cible théorique.

### Latence in-Live (S1, 1ère mesure post-Fallback A)

```
=== lom_get (200 calls, avec bridge) ===
min  = 200.01 ms
p50  = 499.79 ms
p95  = 699.69 ms
p99  = 799.99 ms
max  = 800.74 ms
mean = 480.56 ms
```

→ **125× au-dessus du bar p50 = 4 ms**. Quantization par paliers de 200 ms suggère un mécanisme de scheduling sous-jacent.

### Latence in-Live après `sys.setswitchinterval(0.001)`

Tentative de mitigation R3 — forcer le GIL à switcher 1000×/s au lieu de 200×/s par défaut. Recharge complète du process Live.

```
=== proto_diag (200 calls, sans bridge) ===
min=99.91 p50=400.39 p95=699.06 p99=799.15 max=809.49 ms
=== lom_get (200 calls, avec bridge) ===
min=199.92 p50=499.83 p95=700.00 p99=799.72 max=799.97 ms
Bridge overhead (p50) : 99.44 ms
```

→ Aucun changement significatif (~10 ms de mieux dans le bruit). **Le GIL n'est pas le coupable.**

Observation notable : `proto_diag` (qui ne passe **pas** par le bridge — retour direct depuis le thread handler) est lui aussi à 100-800 ms. C'est donc l'écriture de la réponse HTTP depuis le thread serveur qui est lente, pas le bridge.

### Latence comparée prod vs proto (test décisif)

Le prod extension actuel `agent4live` (`:54321`, TCP single-line JSON, pattern bridge identique) bench contre `ping` (qui passe lui aussi par `_submit_to_main` → queue → `update_display` drain).

```
=== PROD extension (TCP :54321, ping, same bridge pattern) — 100 calls ===
min=199.12 p50=599.75 p95=799.61 p99=900.41 max=900.41 ms

=== PROTO (HTTP :19846, lom_get, same bridge pattern) — 100 calls ===
min=299.09 p50=500.54 p95=702.01 p99=920.46 max=920.46 ms

Ratio p50 proto/prod : 0.8×
```

→ Le **prod extension a le même plancher**, voire un peu plus haut. Le proto HTTP est même **20 % plus rapide que prod**, ce qui élimine définitivement « notre transport HTTP est lent » comme hypothèse.

### `proto_diag` runtime

Snapshot du proto en cours d'exécution dans Live 12.4 :

```json
{
  "python_version": "3.11.6 (main, Apr 30 2026, 11:16:37) [Clang 17.0.0]",
  "asyncio_loop_running": false,
  "queue_depth": 0,
  "main_thread_drain_count": 1,
  "uptime_s": 33.37
}
```

Python 3.11.6 embarqué dans Live 12.4 (compilé Avril 2026 avec Clang 17). `asyncio_loop_running: false` car on est sur Fallback A.

---

## Surprises / faits saillants

### 1. Le SDK MCP officiel n'est pas chargeable par Live Python

R2 du plan était listé « probabilité faible ». **C'est sorti dur** au premier `Reload`.

```
ImportError: dlopen(/Users/.../agent4live_proto/_vendor/pydantic_core/_pydantic_core.cpython-311-darwin.so, 0x0002):
symbol not found in flat namespace '_PyBaseObject_Type'
```

Le wheel `pydantic_core` compilé contre la macOS Python 3.11 standard n'expose pas les mêmes symboles que le CPython embarqué de Live 12.4 (linker statique différent). Conséquence : **pydantic est inutilisable**, donc le SDK MCP officiel aussi (il en dépend), donc FastMCP, donc tout le mainstack asyncio prévu par le plan.

Le Fallback A prévu pour R1/R2 a été activé directement. **Implication migration** : tout SDK MCP basé sur pydantic est exclu pour Live. Le hand-roll JSON-RPC n'est pas une fallback de dernier recours — c'est la **seule** voie viable.

### 2. Le plancher latence est structurel, pas spécifique au proto

C'est la découverte clé du rapport. Le ratio proto/prod = 0,8× **élimine** :

- Notre design HTTP/MCP
- Le SDK MCP (puisqu'on est sur Fallback A stdlib)
- L'asyncio (puisqu'on est sur threading sync)
- Le GIL switch interval (validé via setswitchinterval)

Ce qui reste : **le scheduling de l'interpréteur Python embarqué dans Live**. Le main thread Live tient le GIL en bursts longs (~100-200 ms) et ne le libère qu'à intervalles fixes. Pour un thread serveur qui doit lire-traiter-écrire chaque requête, ces bursts deviennent le facteur dominant.

Comparaison de référence : un serveur identique tournant dans un Python host (hors Live) atteint p50 = 2,99 ms. **L'environnement Live ajoute ~500 ms de latence à toute opération depuis un thread serveur, indépendamment du transport ou du SDK.**

### 3. Le prod extension actuel a le même plancher — mais personne ne l'a remarqué

`agent4live` (Browser API extension prod) répond à un `ping` en p50 = 600 ms. Le user vit avec depuis le déploiement de l'extension sans s'en plaindre. Raison : Browser API est utilisée environ 1 fois par session (« charge un Drum Rack »). 600 ms sur une opération ponctuelle est imperceptible.

Mais la migration prévoyait de faire passer **les 232 outils MCP** par ce même chemin. Sous burst d'agent (typique : 30 outils en 200 ms), la latence accumulée deviendrait insupportable.

### 4. Le pont JS↔Max actuel (qu'on voulait éliminer) est ce qui rend le système rapide

La roadmap visait à supprimer le pont JS↔Max comme « bottleneck dominant ». La donnée contredit cette analyse : **le pont JS↔Max est ce qui permet de rester à 10-15 ms par call**, parce que Max [js] tourne dans Max (process séparé) avec un threading modèle qui ne souffre pas du plancher Live Python.

Supprimer le pont JS↔Max = supprimer la seule couche performante de la stack.

### 5. Le split `__init__.py` + `control_surface.py` est obligatoire dès qu'on veut tester

Le plan avait un `__init__.py` qui importait `_Framework.ControlSurface` au top-level. Ça casse `pytest` (qui n'a pas `_Framework`). On a dû refactorer en `__init__.py` thin (juste `create_instance` lazy-import) + `control_surface.py` (le vrai contenu). À répercuter dans toute migration future.

### 6. Bug du plan : la formule `latency_summary.pct()`

L'implémentation verbatim du plan (`int(round(p * (n-1)))`) calcule l'index 98 pour p99 avec n=100, alors que le test attend l'index 99 (= la valeur outlier 1000). Le sous-agent a corrigé en `int(p * n)`. Si la migration reprend ce code, il faut prendre la version corrigée.

### 7. Bug du plan : `detect_dropouts.find_discontinuities` ne couvre pas les silent gaps

Le docstring promettait deux modes (sample-to-sample jump + silent gap). L'impl verbatim ne faisait que le premier. Le test 2 du plan (gap inséré sur un sinus 1 kHz aux zero-crossings) ne pouvait pas passer avec l'impl verbatim. Le sous-agent a étendu l'impl pour couvrir le silent gap mode aussi.

---

## Recommandation pour la migration prod

**NO sur la migration en l'état.** Les deux conditions de YES sont fausses :

- La perf n'est pas 3-5× meilleure — elle est ~50× pire (10-15 ms → 500-600 ms).
- Le SDK MCP officiel n'est pas utilisable, ce qui annule aussi le bénéfice « stack standard et maintenue ».

**MIDDLE possible** si la migration est repensée autour des trois changements suivants :

### 1. Hand-roll MCP (stdlib only)

Le Fallback A (`server_sync.py`) montre que c'est faisable en ~110 lignes. Pas de pydantic, pas de FastMCP, pas d'asyncio. Juste `http.server.ThreadingTCPServer` + `json`. **C'est la seule voie compatible Live Python.**

À budgétiser : implémenter Streamable HTTP MCP (handshake initialize + session-id) en stdlib si on veut la compat client maximale (Claude Code utilise déjà le simple JSON-RPC sans session-id côté Fallback A, donc à valider en pratique).

### 2. Composite tools côté serveur, obligatoire

Avec un plancher 500 ms/call, **toute logique de fan-out doit migrer côté serveur**. Exemples :

| Aujourd'hui (agent fait N calls)                      | Demain (1 call composite)            | Gain                                    |
| ----------------------------------------------------- | ------------------------------------ | --------------------------------------- |
| `lom_get` × 64 (drum pads)                            | `read_drum_rack(rack)`               | 64 × 500 ms = 32 s → 1 × 500 ms = 0,5 s |
| `lom_get` + `lom_get` + `lom_set` (read-modify-write) | `update_if_changed(path, value)`     | 1,5 s → 0,5 s                           |
| Bulk audit `lom_get` × 200                            | `get_track_state(index)` (composite) | 100 s → ~1 s                            |

Sans ce redesign, la migration **détruit** le throughput agent. Avec ce redesign, la migration **améliore** le throughput sur les fan-outs (la majorité des prompts agent en pratique) tout en régressant la latence unitaire.

### 3. Refonte de la promesse roadmap

L'item « Migration backend Node → Python » dans `.claude/ROADMAP.md` doit être réécrit. Les bénéfices listés sont à ré-évaluer :

| Bénéfice annoncé                            | Validation par le proto                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| « 3-5× plus rapide »                        | ✗ Faux. ~50× plus lent en unitaire.                                                          |
| « Couverture LOM 100% »                     | ✓ Probable (Live Python a accès à toute l'API). À confirmer mais pas testé.                  |
| « Token consumption -20-40% via composite » | ✓ Si tools composites implémentés. C'est la vraie valeur résiduelle.                         |
| « Sécurité invariante »                     | ✓ Inchangée.                                                                                 |
| « Suppression du pont JS↔Max »              | ✗ À supprimer du wording — le pont **n'est pas** le bottleneck, le supprimer **n'aide pas**. |

**Question stratégique pour le user** : la migration vaut-elle encore le coup ? Si oui, c'est pour « stabilité long terme du runtime Python officiel d'Ableton + composite tools + couverture LOM », pas pour la perf. Effort engineering reste 3-4 mois, mais le ROI change.

### 4. Si la migration est lancée : pattern de référence

Au-delà des 3 points ci-dessus, le proto fournit un squelette de référence :

- `__init__.py` thin (`_VENDOR` sys.path + lazy `create_instance`)
- `control_surface.py` séparé (Live API import isolé)
- `bridge.py` (queue.Queue + Event main-thread dispatch via `update_display()` — pattern dérivé du extension existant)
- `lom_exec.py` (path resolver synchrone, testable hors Live)
- `tools.py` (handlers async ou sync, factory pattern pour faux bridge en test)
- `server_sync.py` (Fallback A, JSON-RPC stdlib)
- `mcp_handshake.py` (utilitaire client réutilisable)

Tests unitaires : 20 tests pytest passent, couverture des modules pure-Python (bridge, lom_exec, tools, synthetic, detect_dropouts).

---

## Mise à jour — patterns de référence dans l'écosystème (2026-05-16, post-cleanup)

Recherche faite après cleanup du proto pour valider si notre 500-600 ms est inévitable ou si on a juste choisi le mauvais pattern. **Conclusion : on a choisi le mauvais pattern.**

### Plancher réel de la plateforme : ~100 ms

Confirmé multi-sources : `schedule_message`, `add_current_song_time_listener`, `update_display()` tournent tous autour de **100 ms** (60 ms pour le listener `current_song_time` dans certaines conditions, mais 100 ms en pratique reproduisable). C'est le tick le plus rapide qu'un Remote Script Python peut obtenir.

### Comparaison avec les projets de référence

| Projet                                | Archi                        | Transport                 | Pattern threading                                                             | Latence effective                                              |
| ------------------------------------- | ---------------------------- | ------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **AbletonOSC** (NIME 2023, 5+ années) | Single-process Remote Script | UDP `:11000` non-bloquant | **Aucun thread serveur** — `schedule_message(1, self.tick)` toutes les 100 ms | **~100 ms** (floor plateforme atteint)                         |
| **ableton-osc-mcp** (Go)              | Process séparé               | MCP stdio ↔ OSC UDP       | Dépend d'AbletonOSC                                                           | ~100-150 ms (floor + traduction)                               |
| **Ziforge/ableton-liveapi-tools**     | Single-process Remote Script | TCP `:9004` JSON          | Socket thread + queue + `update_display()` drain — **idem notre design**      | Claim « low latency », **pas de benchmark** (probable ~500 ms) |
| **Notre prod `agent4live`**           | Single-process Remote Script | TCP `:54321` JSON         | Idem Ziforge / Idem notre proto                                               | **600 ms p50 mesuré**                                          |
| **Notre proto (Fallback A)**          | Single-process Remote Script | HTTP `:19846` JSON-RPC    | Idem                                                                          | **500 ms p50 mesuré**                                          |

### La différence clé : où vit la boucle d'I/O

Notre design (et celui de Ziforge, et celui de notre prod) :

- Un **thread serveur background** fait `serve_forever()` sur un socket bloquant
- Quand une requête arrive, le thread la lit, la met en queue, **attend** un event signalé par le main thread (via `update_display`)
- Le main thread drain la queue et signale l'event

Conséquence : 4 transitions GIL par call (thread reçoit, main drain, thread écrit réponse). Chaque transition pèse ~100 ms parce que le main thread Live tient le GIL en bursts longs.

AbletonOSC :

- **Pas de thread serveur du tout**
- Le main thread, sur chaque tick de `schedule_message(1, callback)`, **poll le socket UDP non-bloquant**
- Si data dispo : lire, traiter, écrire — tout en une fois sur le main thread
- Pas de queue, pas d'event, pas de cross-thread synchronisation

Conséquence : 1 traversée GIL par call (le main thread fait tout dans sa fenêtre Python).

Le commentaire littéral dans le code d'AbletonOSC, qui décrit exactement notre découverte :

> _"Live's embedded Python implementation does not appear to support threading, and beachballs when a thread is started."_

Ils ont rencontré le problème 5 ans avant nous et conçu autour. **Notre prod, le proto, et Ziforge ont tous reproduit l'anti-pattern.**

### Implications corrigées

1. **Notre prod `agent4live` est sous-optimal de 5-6×.** Un refactor vers le pattern AbletonOSC (abandon du socket thread, polling UDP/TCP sur le main thread via `schedule_message`) descendrait sa latence p50 de 600 ms à ~100 ms. C'est un chantier de quelques jours, indépendant de toute migration.

2. **Le verdict NO sur la migration tient toujours**, mais avec une nuance plus précise :
   - Plancher Python Remote Script atteignable = **100 ms** (pas 500 ms comme mesuré)
   - Pont JS↔Max actuel = **10-15 ms**
   - Écart réel = **6-10×**, pas 50×
   - La migration reste perdante, mais le gap est plus serré

3. **Alternative directement opérationnelle** : `nozomi-koborinai/ableton-osc-mcp` existe et fait déjà exactement ce qu'on voulait construire — un serveur MCP qui pilote Live via AbletonOSC. Pas besoin de migrer notre stack ; il suffirait que l'utilisateur installe AbletonOSC + ableton-osc-mcp à côté du device prod. Bénéfice : moins de code à entretenir chez nous, projet déjà battle-tested. Coût : nos 232 outils LOM customs ne sont pas exposés (l'API AbletonOSC est plus restreinte).

4. **Si on garde notre stack mais qu'on veut accélérer le prod extension** : adopter le pattern AbletonOSC (`schedule_message` polling + pas de socket thread). Le pattern existe en référence dans le tag `proto-archive-2026-05-16` pour le **mauvais** pattern (à éviter) ; AbletonOSC ([github.com/ideoforms/AbletonOSC](https://github.com/ideoforms/AbletonOSC), fichier `manager.py`, fonction `tick()`) est la référence pour le **bon** pattern.

### Sources

- [GitHub — ideoforms/AbletonOSC](https://github.com/ideoforms/AbletonOSC) — pattern `schedule_message(1, self.tick)`, fonction `tick()` dans `manager.py`.
- [AbletonOSC NIME 2023 paper (Daniel Jones)](https://nime.org/proceedings/2023/nime2023_60.pdf) — design rationale, threading constraints.
- [GitHub — Ziforge/ableton-liveapi-tools](https://github.com/Ziforge/ableton-liveapi-tools) — 220 outils LiveAPI, même anti-pattern threading que nous.
- [GitHub — nozomi-koborinai/ableton-osc-mcp](https://github.com/nozomi-koborinai/ableton-osc-mcp) — serveur MCP externe Go, communication OSC/UDP avec AbletonOSC.
- [Ableton Forum — fastest clock in Max/API](https://forum.ableton.com/viewtopic.php?t=152504) — discussion des limites timing.

---

## Cleanup post-décision

Après revue de ce rapport :

1. Le rapport est copié sur `main` à `docs/superpowers/specs/2026-05-16-prototype-http-in-live-report.md` (référence durable).
2. La branche `proto/http-in-live` est taggée `proto-archive-2026-05-16` puis supprimée localement et sur le remote.
3. Le Remote Script proto est désinstallé :
   ```bash
   rm "$HOME/Music/Ableton/User Library/Remote Scripts/agent4live_proto"
   ```
4. Dans Live → Preferences → Link/Tempo/MIDI, remettre le slot où `agent4live_proto` était assigné sur `None`.
5. L'item « Migration backend Node → Python (hybride) » dans `.claude/ROADMAP.md` est à réécrire à la lumière des findings (voir « Recommandation » section 3).

---

## Annexes — runs et commits

- Commits Fallback A : `d5f60a5` (`server_sync.py` + swap import) et `544e87e` (clean shutdown + `setswitchinterval`).
- Commit du smoke FastMCP hors Live : `3eb07cf` (Tâche 9).
- 23 commits totaux sur la branche `proto/http-in-live`, de `076b8c0` (squelette) à `544e87e` (dernier fix Live).
- 20 tests pytest passent sur le code testable hors Live.
- Log Live (in-Live runs) : `~/Library/Preferences/Ableton/Live 12.4/Log.txt` à partir de `2026-05-16T03:16:42` (premier load avec SDK, échec R2), `2026-05-16T03:21:37` (premier load Fallback A, succès), `2026-05-16T03:30:25` (load après setswitchinterval).
