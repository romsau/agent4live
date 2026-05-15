# Prototype HTTP-in-Live — Design

> Date : 2026-05-15
> Statut : design validé, prêt pour planning d'implémentation
> Pré-requis de : migration backend Node → Python (item roadmap)

## 1. Mission

Le prototype répond à une question binaire :

> Peut-on faire tourner un serveur MCP HTTP (SDK Python officiel + asyncio) dans le process Live, exposant des outils LOM, sans dégrader l'audio ni la stabilité, avec une latence sensiblement meilleure que le pont JS↔Max actuel ?

Trois sorties possibles :

| Verdict    | Critère                                                          | Suite                                                                                                        |
| ---------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **YES**    | Tous les scénarios passent leurs critères stricts                | Migration backend Node→Python est verte. Spec d'implémentation suit.                                         |
| **NO**     | ≥1 hard fail reproductible (audio dropouts, leak >100 MB, crash) | Migration mise en pause, l'item roadmap réécrit avec les contraintes découvertes (split process ou abandon). |
| **MIDDLE** | Stabilité partielle non-attribuable à un hard fail               | Bascule sur Fallback A (JSON-RPC manuel sans SDK) puis re-run. Si A passe : YES avec note. Sinon : NO.       |

**Pas de timebox** — la certitude prime sur la vitesse. Le proto continue jusqu'à un verdict robuste.

## 2. Hors-scope explicite

- Port des 232 outils LOM existants. Le proto en expose 3 + 1 outil diagnostic.
- Auth Bearer, rate-limit, audit log, Origin check. Stub-out.
- jweb UI. Le proto se teste uniquement via Claude Code en client MCP direct.
- Modifications de `app/` ou `app/python_scripts/` en prod. Le proto cohabite sans aucun import.

## 3. Architecture

### Layout fichier

Branche `proto/http-in-live` (jamais mergée). Dossier root :

```
proto/http-in-live/
├── README.md                    # mission, install, exécution
├── remote_script/
│   └── agent4live_proto/
│       ├── __init__.py          # entry point ControlSurface
│       ├── server.py            # asyncio thread + FastMCP + Starlette/uvicorn
│       ├── bridge.py            # queue thread-safe ↔ update_display()
│       └── tools.py             # 3 outils LOM (lom_get/set/call) + proto_diag
├── test_project/
│   └── reference.als            # projet Live de référence pour S2/S3
├── load_test/
│   ├── synthetic.py             # httpx : latence + burst soutenu
│   ├── stability.py             # endurance 12h, sampling RSS/fd/CPU
│   ├── detect_dropouts.py       # analyse offline du .wav rendu
│   └── claude_code_session.md   # script de prompts pour S5
├── results/
│   ├── run_NNN.json             # métriques brutes par run
│   └── REPORT.md                # rapport final, alimente la décision GO/NO-GO
└── install.sh                   # symlink → ~/Music/Ableton/User Library/Remote Scripts/agent4live_proto/
```

### Cohabitation prod / proto

Live a 6 slots Control Surface dans Preferences → Link/Tempo/MIDI. Le proto utilise un **slot différent** de la prod (`agent4live` reste sur son slot, `agent4live_proto` sur un autre). Les deux Remote Scripts tournent en parallèle sur des ports différents : prod sur `:19845`, proto sur `:19846`. Bascule entre les deux = changement de dropdown dans Live, pas de réinstall.

### Threading model

| Thread    | Rôle                                                                  | Outils                                                  |
| --------- | --------------------------------------------------------------------- | ------------------------------------------------------- |
| Main Live | Exécute les LOM ops, draine la queue depuis `update_display()` ~30 Hz | Live API native                                         |
| Asyncio   | Tourne uvicorn + FastMCP, handle les requêtes HTTP MCP                | `asyncio`, `mcp.server.fastmcp`, `starlette`, `uvicorn` |
| Bridge    | `queue.Queue` thread-safe + rendez-vous via `asyncio.Future`          | `threading.Event` wrappé en `loop.run_in_executor`      |

### Flux d'un appel `lom_get('live_set tempo')`

1. Claude Code → POST `/mcp` → uvicorn (asyncio thread).
2. FastMCP route vers handler `lom_get` (async).
3. Handler : `await bridge.submit({op:'get', path:'live_set tempo'})`.
4. Bridge : `loop.run_in_executor(...)` → thread pool worker.
5. Worker : `queue.put((msg, slot))` + `slot.event.wait(timeout=30s)`.
6. Main thread Live (~33 ms plus tard max) : `update_display()` → `queue.get_nowait()` → `live_set.tempo` → `slot.event.set()`.
7. Worker débloque → renvoie le résultat à l'asyncio handler.
8. FastMCP encode la réponse MCP → uvicorn → Claude Code.

### Fallback A (swap drop-in)

Si l'asyncio loop pose un problème non-contournable (R1 ou R2 ci-dessous), on swap `server.py` pour un `http.server.ThreadingHTTPServer` qui parse JSON-RPC à la main. `bridge.py`, `tools.py`, et la pattern queue/main-thread restent identiques. Le fallback est conçu d'emblée comme un drop-in remplacement.

## 4. Outils LOM exposés

| Outil        | Type                                             | Pourquoi celui-là                                                                                                                              |
| ------------ | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `lom_get`    | Lecture pure                                     | Le call le plus chaud (~90 % du trafic agent). Test : `lom_get('live_set tempo')` 1000× pour mesurer p50/p99.                                  |
| `lom_set`    | Écriture pure                                    | Détecte un cas "read OK, write KO". Test : `lom_set('live_set tempo', 124.5)` alterné avec `lom_get`.                                          |
| `lom_call`   | Méthode avec effet de bord (déclenche observers) | Catégorie séparée car peut être lent. Test : `lom_call('live_set', 'create_audio_track', -1)` puis cleanup.                                    |
| `proto_diag` | Diagnostic interne du proto                      | Retourne `{python_version, asyncio_loop_running, queue_depth, main_thread_drain_count, uptime_s}`. Pas un outil LOM, instrumentation du proto. |

Schema MCP minimum : `name`, `description`, `inputSchema` (Pydantic via FastMCP). Pas de `intent`, pas de `successText` custom — cosmétique production hors-scope.

## 5. Méthodologie de test

Six scénarios. **Tous** doivent passer pour déclarer YES.

### S1 — Latence isolée

- Live ouvert, projet vide, transport stoppé, aucun observer.
- `synthetic.py` : 1000 × `lom_get('live_set tempo')` séquentiels.
- **Mesure** : p50, p95, p99, p99.9, max.
- **Pass** : p50 < 4 ms, p99 < 15 ms.

### S2 — Burst soutenu pendant Live qui joue (test audio canonique)

- Projet de référence : 15 tracks audio jouant en boucle (samples 4 mesures à 124 BPM, pas de plugins lourds). Le `.als` est commit dans `proto/http-in-live/test_project/reference.als`.
- `synthetic.py` : 50 req/s sustained pendant 5 min, mix 70 % `lom_get` / 25 % `lom_set` / 5 % `lom_call` avec cleanup.
- **Mesure** :
  - Audio : enregistrement de la sortie maître en `.wav` 48 k / 24-bit + analyse offline par `detect_dropouts.py` (cherche les discontinuités > 1 sample). Doublé par écoute humaine au casque.
  - CPU Live : screenshot du Performance Impact view (Options → Performance Impact) à t = 0, 1, 2, 3, 4, 5 min.
  - Latence MCP : p50/p99 calculés en parallèle pour détecter une dégradation.
- **Pass** :
  - Zéro dropout audible.
  - Zéro discontinuité détectée par le script.
  - CPU Live < 100 % sur toute la durée (pic et steady).
  - Latence p50 ne dégrade pas de plus de 2× vs S1.

### S2-bis — Variante "projet lourd"

- Même charge réseau que S2.
- Projet modifié : ajout de 2 instances de Diva + 1 IR Reverb avec buffer 4096 samples.
- **Pass** : mêmes critères que S2. Couvre R6.

### S3 — Endurance 12h

- Même projet que S2, charge réduite à 5 req/s sustained pendant 12h.
- **Mesure** toutes les 15 min : RSS du process Live (`ps -o rss`), `lsof -p <pid> | wc -l`, p50 latence sur 100 calls échantillon, `proto_diag.queue_depth`, `proto_diag.uptime_s`.
- **Pass** :
  - RSS croît < 20 MB sur les 12h.
  - fd count steady (oscille, pas de croissance monotone).
  - p50 latence < 1.5× la valeur initiale après 12h.
  - `queue_depth` reste < 5 en steady-state.

### S4 — Cycle de vie Live

Séquence manuelle (~30 min). À chaque étape : Live ne crashe pas, le proto se rétablit ou se relance proprement, les calls MCP reprennent.

1. Live ouvert + proto loaded + tempo set via MCP.
2. Stop transport, vérifier proto répond.
3. Charge un autre projet, vérifier proto se ré-attache au nouveau `live_set`.
4. Save projet.
5. Switch d'un autre Control Surface dans Preferences (désactive le proto), puis ré-active.
6. Quitte Live, relance Live.

### S5 — Client MCP réel (Claude Code)

- Claude Code configuré sur `http://127.0.0.1:19846/mcp`.
- Script de prompts dans `claude_code_session.md` :
  1. "Quel est le tempo actuel ?" → `lom_get`.
  2. "Mets le tempo à 128 BPM." → `lom_set`.
  3. "Crée une nouvelle piste audio." → `lom_call`.
  4. "Supprime la piste que tu viens de créer." → `lom_call` avec contexte conversationnel.
  5. "Refais ça 10 fois en alternant 124 et 128 BPM." → burst séquentiel.
- **Pass** : Claude Code se connecte, voit les 3 outils, les appelle correctement, la session ne timeout ni ne renvoie d'erreur MCP malformée.

### S6 — Observer LOM thread-safe

- Registrer un observer sur `live_set.tempo` depuis le main thread.
- Déclencher via `lom_set('live_set tempo', 128)` depuis HTTP.
- Vérifier que l'observer fire dans le main thread sans bloquer l'asyncio loop.
- **Pass** : observer callback exécuté, asyncio loop continue à servir d'autres requêtes en parallèle.
- **Sert à** : couvrir R5, indispensable car la prod utilise massivement les observers pour les SSE notifications.

### Instrumentation transverse

Chaque scénario écrit son output dans `proto/http-in-live/results/run_NNN.json` (timestamp + métriques + pass/fail par critère). Le rapport final `REPORT.md` est une table compacte : scénarios × critères × résultats, avec liens vers les runs détaillés.

## 6. Risques anticipés & contingences

| ID  | Risque                                                        | Probabilité | Signal                                                 | Contingence                                                                                                                               |
| --- | ------------------------------------------------------------- | ----------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | asyncio loop incompatible avec le main thread Live            | Moyenne     | Live freeze au load, stacktrace asyncio dans `Log.txt` | Bascule Fallback A                                                                                                                        |
| R2  | Deps du SDK MCP incompatibles avec le Python embarqué Live 12 | Faible      | `ImportError` au load                                  | Vendoring des wheels pure-Python, sinon Fallback A                                                                                        |
| R3  | `update_display()` est drop sous charge audio                 | Moyenne     | `queue_depth` qui grossit, p99 explose en S2/S3        | Mesure `main_thread_drain_count` sous charge ; ajuster `DRAIN_BATCH_SIZE` ; investiguer `scheduler.schedule_message` (pattern Push 3 SDK) |
| R4  | Memory leak côté Python                                       | Moyenne     | S3 RSS > 20 MB de croissance                           | Diag → fix code proto si attribuable, sinon Fallback A, sinon NO si bug Ableton                                                           |
| R5  | Observers LOM cassent avec asyncio                            | Moyenne     | S6 échoue                                              | Couvert par S6 : si le proto échoue, on documente, Fallback A peut le résoudre                                                            |
| R6  | Le `.als` de référence ne reproduit pas la charge réelle      | Faible      | Découvert après migration                              | Couvert par S2-bis (variante projet lourd)                                                                                                |

## 7. Livrable & cleanup

### Le livrable unique

`proto/http-in-live/results/REPORT.md`, structuré :

```
# Prototype HTTP-in-Live — Rapport

## Verdict : YES | NO | MIDDLE

## Résultats par scénario

| S | Scénario          | Critère       | Mesure         | Pass |
| - | ----------------- | ------------- | -------------- | ---- |
| 1 | Latence isolée    | p50<4, p99<15 | x.x / x.x ms   | ✓/✗ |
| 2 | Burst+audio       | 0 dropout     | x              | ✓/✗ |
| 2 | Burst+audio       | CPU<100%      | pic x %        | ✓/✗ |
| 2-bis | Projet lourd  | mêmes que S2  | …              | ✓/✗ |
| 3 | Endurance 12h     | leak<20MB     | +x MB          | ✓/✗ |
| 4 | Cycle Live        | pas de crash  | …              | ✓/✗ |
| 5 | Claude Code       | session OK    | …              | ✓/✗ |
| 6 | Observers         | thread-safe   | …              | ✓/✗ |

## Métriques détaillées
[liens vers run_NNN.json]

## Surprises / faits saillants
[texte libre — comportements inattendus, gotchas]

## Reco pour la migration prod
[GO/NO-GO + ce qu'il faut transposer / éviter / approfondir]
```

### Cleanup post-décision

Quoi que sorte le proto :

1. `REPORT.md` est copié dans `docs/superpowers/specs/YYYY-MM-DD-prototype-http-in-live-report.md` sur `main` (référence durable).
2. Branche `proto/http-in-live` taggée `proto-archive-YYYY-MM-DD` puis supprimée localement et sur le remote.
3. Le Remote Script proto désinstallé : `rm ~/Music/Ableton/User\ Library/Remote\ Scripts/agent4live_proto` (symlink).
4. Slot Control Surface du proto remis sur `None` dans Live → Preferences.

## 8. Pré-requis avant de lancer l'implémentation

- OS cible : **macOS uniquement** (cohérent avec le scope prod actuel ; Windows est un item roadmap séparé).
- `pip` cible Python 3.11 (version bundlée par Live 12).
- Accès en écriture à `~/Music/Ableton/User Library/Remote Scripts/`.
- Live 12 ouvert avec un projet vide réservé au proto (pour S1, S4) + le projet de référence committé (pour S2, S2-bis, S3, S6).
- Dépendances `load_test/` : `httpx` (client HTTP), `numpy` (analyse `.wav` dans `detect_dropouts.py`), `mcp` (le SDK officiel, utilisé en mode client via `mcp.client.session.ClientSession` pour les tests synthétiques au-delà du HTTP brut).
- Claude Code installé et configurable sur un port custom (`127.0.0.1:19846` au lieu du prod `:19845`).

## 9. Ce que ce proto ne fait PAS

- Ne migre rien en prod.
- Ne touche pas à la couverture des 232 outils.
- Ne mesure pas le token consumption agent (concerne le design des outils composites, pas la faisabilité technique).
- Ne valide pas la migration des 1066 tests Jest vers pytest (problème de portage, pas de faisabilité).

Le proto valide uniquement la **fondation** : peut-on faire du HTTP MCP dans Live ? Si oui, le reste est de la réécriture, pas de la R&D.
