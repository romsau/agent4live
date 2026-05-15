# Plan d'implémentation — Prototype HTTP-in-Live

> **Pour les workers agentiques :** SOUS-SKILL REQUIS : utilise superpowers:subagent-driven-development (recommandé) ou superpowers:executing-plans pour exécuter ce plan tâche par tâche. Les étapes utilisent la syntaxe checkbox (`- [ ]`) pour le tracking.

**Objectif :** Construire un Remote Script Python jetable qui expose 3 outils LOM via un serveur MCP HTTP tournant dans le process de Live, puis le stress-tester exhaustivement pour répondre YES/NO sur la faisabilité de la migration du backend prod (Node-for-Max → Python).

**Architecture :** Le `ControlSurface` (entry point Remote Script) lance un thread asyncio qui fait tourner uvicorn + FastMCP. Les requêtes HTTP atteignent des handlers async qui appellent un bridge thread-safe (`queue.Queue` + `asyncio.Future`). Le bridge marshalle les ops LOM vers le main thread de Live via le hook `update_display()` (~30 Hz). Pattern éprouvé par l'extension existante `app/python_scripts/__init__.py`. Un Fallback A (`http.server.ThreadingHTTPServer` + JSON-RPC manuel) est gardé en réserve pour swap-in si asyncio résiste.

**Stack tech :** Python 3.11 (bundlé par Live 12), `mcp[cli]` (SDK MCP officiel Anthropic), `uvicorn`, `starlette`, `httpx` + `numpy` pour les load tests, `pytest` pour les unit tests côté host, Claude Code comme vrai client MCP.

**Spec de référence :** [`docs/superpowers/specs/2026-05-15-prototype-http-in-live-design.md`](../specs/2026-05-15-prototype-http-in-live-design.md)

**Branche :** tout le travail vit sur `proto/http-in-live`. Cette branche n'est **jamais mergée** ; elle est taggée `proto-archive-YYYY-MM-DD` puis supprimée après la Phase 10.

---

## Structure des fichiers

Fichiers créés sur la branche `proto/http-in-live`, tous sous `proto/http-in-live/` :

| Fichier                                         | Responsabilité                                                                                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `README.md`                                     | Mission, procédure d'install, procédure d'exécution, lien vers le spec.                                                                                                        |
| `install.sh`                                    | Symlinke `remote_script/agent4live_proto/` dans `~/Music/Ableton/User Library/Remote Scripts/`, pull les wheels Python vendorées.                                              |
| `pyproject.toml`                                | Deps dev-side (`mcp`, `uvicorn`, `httpx`, `numpy`, `pytest`). Ces libs sont aussi pullées dans `_vendor/` pour que le Python embarqué de Live les trouve.                      |
| `remote_script/agent4live_proto/__init__.py`    | Sous-classe `ControlSurface`. Boot le thread asyncio, hook `update_display()` pour drainer la queue. ~80 lignes.                                                               |
| `remote_script/agent4live_proto/bridge.py`      | Bridge thread-safe queue ↔ asyncio.Future. Logique pure (pas de Live API, pas de contrôle de loop asyncio). 100 % unit-testable. ~60 lignes.                                   |
| `remote_script/agent4live_proto/server.py`      | Setup FastMCP server + runner asyncio. Wire le bridge dans les handlers d'outils. ~80 lignes.                                                                                  |
| `remote_script/agent4live_proto/tools.py`       | Les 3 outils LOM + `proto_diag`. Chaque outil est un handler fin qui appelle `bridge.submit({op:..., path:...})`. ~70 lignes.                                                  |
| `remote_script/agent4live_proto/lom_exec.py`    | Côté main-thread : reçoit un message du bridge, déréférence le path LOM, exécute get/set/call, retourne la valeur. ~70 lignes.                                                 |
| `remote_script/agent4live_proto/_vendor/`       | Wheels Python vendorées (`mcp`, `pydantic`, `anyio`, `httpx`, `starlette`, `uvicorn`, `h11`, `idna`, `sniffio`, `typing_extensions`). Pullées par `install.sh`.                |
| `remote_script/agent4live_proto/server_sync.py` | **Fallback A** — créé seulement si la Phase 9 se déclenche. JSON-RPC manuel sur `http.server.ThreadingHTTPServer`. Réutilise `bridge.py`, `tools.py`, `lom_exec.py` inchangés. |
| `test_project/reference.als`                    | Projet Live 12 : 15 pistes audio loopant un sample de 4 mesures à 124 BPM, pas de plugins lourds.                                                                              |
| `test_project/reference_heavy.als`              | Variante S2-bis : idem + 2× Wavetable + 1× Hybrid Reverb (stock Live — reproductible par tout le monde).                                                                       |
| `test_project/loop_sample.wav`                  | Sample pink-noise de 4 mesures à 124 BPM, mono, 48 kHz/24-bit. Évite les questions de licence.                                                                                 |
| `load_test/synthetic.py`                        | Client MCP basé httpx. Drive S1 (1000 `lom_get` séquentiels) et S2/S2-bis (50 req/s soutenus 5 min). Écrit des métriques JSON.                                                 |
| `load_test/stability.py`                        | Sampler long-running pour S3. 5 req/s en continu + échantillonnage RSS / fd / latence du process Live toutes les 15 min pendant 12h.                                           |
| `load_test/detect_dropouts.py`                  | Analyse numpy du `.wav` enregistré, cherche les discontinuités > 1 sample.                                                                                                     |
| `load_test/claude_code_session.md`              | Scénarios de prompts pour S5 (test client réel manuel).                                                                                                                        |
| `load_test/run_scenario.py`                     | Wrapper CLI qui orchestre un scénario, écrit le résultat dans `results/run_NNN.json`.                                                                                          |
| `load_test/tests/test_bridge.py`                | Unit tests pytest pour `bridge.py` (importable depuis le host, pas besoin de Live).                                                                                            |
| `load_test/tests/test_detect_dropouts.py`       | Unit tests pytest pour `detect_dropouts.py`.                                                                                                                                   |
| `load_test/tests/test_synthetic.py`             | Unit tests pytest pour la logique de métriques de `synthetic.py`.                                                                                                              |
| `load_test/tests/test_lom_exec.py`              | Unit tests pytest pour `lom_exec.py` avec un faux objet `Song`.                                                                                                                |
| `load_test/tests/test_tools.py`                 | Unit tests pytest pour les handlers MCP avec un faux bridge.                                                                                                                   |
| `results/run_NNN.json`                          | Métriques par run, écrites par `run_scenario.py`.                                                                                                                              |
| `results/REPORT.md`                             | Rapport final agrégé ; le seul artefact qui survit au prototype.                                                                                                               |

---

## Tâches

## Phase 1 — Fondation

### Tâche 1 : Créer la branche jetable et le squelette de dossiers

**Fichiers :**

- Créer : `proto/http-in-live/.gitkeep` (et les dossiers intermédiaires)

- [ ] **Étape 1 : Créer la branche depuis main**

```bash
cd /Users/romainsauvez/dev/Ableton/agent4live/device
git checkout main
git pull --ff-only
git checkout -b proto/http-in-live
```

Attendu : `Switched to a new branch 'proto/http-in-live'`.

- [ ] **Étape 2 : Créer le squelette de dossiers**

```bash
mkdir -p proto/http-in-live/remote_script/agent4live_proto/_vendor
mkdir -p proto/http-in-live/test_project
mkdir -p proto/http-in-live/load_test/tests
mkdir -p proto/http-in-live/results
touch proto/http-in-live/results/.gitkeep
touch proto/http-in-live/remote_script/agent4live_proto/_vendor/.gitkeep
```

- [ ] **Étape 3 : Commit**

```bash
git add proto/http-in-live/
git commit -m "proto: squelette pour le prototype HTTP-in-Live jetable"
```

### Tâche 2 : Écrire le README du proto

**Fichiers :**

- Créer : `proto/http-in-live/README.md`

- [ ] **Étape 1 : Écrire le README**

```markdown
# Prototype HTTP-in-Live (jetable)

C'est un prototype jetable. Il valide si un Remote Script Python peut
héberger un serveur MCP HTTP dans le process de Live sans casser l'audio.

**Spec de design :** [`docs/superpowers/specs/2026-05-15-prototype-http-in-live-design.md`](../../docs/superpowers/specs/2026-05-15-prototype-http-in-live-design.md)

## Politique de branche

Toute l'arborescence `proto/http-in-live/` vit uniquement sur la branche
`proto/http-in-live`. La branche n'est **jamais mergée**. Une fois le verdict
écrit dans `results/REPORT.md`, le rapport est copié sur `main` dans
`docs/superpowers/specs/`, la branche est taggée `proto-archive-YYYY-MM-DD`,
puis supprimée.

## Install (macOS, Live 12)

\`\`\`bash
./install.sh
\`\`\`

Le script symlinke `remote_script/agent4live_proto/` dans
`~/Music/Ableton/User Library/Remote Scripts/agent4live_proto/`.

Ensuite dans Live : **Preferences → Link/Tempo/MIDI**, sélectionne
`agent4live_proto` dans un **slot différent** de celui du prod
`agent4live` (les deux peuvent tourner en parallèle — prod sur :19845,
proto sur :19846).

## Lancer un scénario

\`\`\`bash
cd load_test
python run_scenario.py s1 # latence isolée (1000 calls)
python run_scenario.py s2 # burst 50 req/s × 5 min, nécessite reference.als chargé
python run_scenario.py s3 # endurance 12h

# S4, S5, S6 sont partiellement manuels — voir load_test/claude_code_session.md

\`\`\`

Chaque run écrit `results/run_NNN.json`.

## Désinstall

\`\`\`bash
rm ~/Music/Ableton/User\ Library/Remote\ Scripts/agent4live_proto
\`\`\`

Puis dans Live → Preferences → Link/Tempo/MIDI, remets le slot proto sur `None`.
```

- [ ] **Étape 2 : Commit**

```bash
git add proto/http-in-live/README.md
git commit -m "proto: README avec mission, install, procédures d'exécution"
```

### Tâche 3 : Écrire le script d'installation

**Fichiers :**

- Créer : `proto/http-in-live/install.sh`

- [ ] **Étape 1 : Écrire install.sh**

```bash
#!/usr/bin/env bash
# install.sh — symlink the proto Remote Script into Live's user library,
# then pull vendored Python deps that Live's bundled Python can import.

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROTO_PKG="$SCRIPT_DIR/remote_script/agent4live_proto"
TARGET="$HOME/Music/Ableton/User Library/Remote Scripts/agent4live_proto"

if [[ -e "$TARGET" ]]; then
  echo "Target already exists: $TARGET"
  echo "Remove it first: rm \"$TARGET\""
  exit 1
fi

mkdir -p "$HOME/Music/Ableton/User Library/Remote Scripts"
ln -s "$PROTO_PKG" "$TARGET"
echo "Symlinked: $TARGET → $PROTO_PKG"

VENDOR="$PROTO_PKG/_vendor"
echo "Pulling vendored Python deps into $VENDOR ..."
python3.11 -m pip install \
  --target "$VENDOR" \
  --no-deps \
  mcp pydantic anyio httpx starlette uvicorn h11 idna sniffio typing_extensions \
  pydantic_core annotated_types
echo "Vendored deps installed."
echo ""
echo "Next step:"
echo "  Open Live → Preferences → Link/Tempo/MIDI → assign 'agent4live_proto'"
echo "  to a Control Surface slot (different from the prod 'agent4live')."
```

- [ ] **Étape 2 : Rendre exécutable et commit**

```bash
chmod +x proto/http-in-live/install.sh
git add proto/http-in-live/install.sh
git commit -m "proto: install.sh — symlink + pull des deps Python vendorées"
```

### Tâche 4 : Créer les projets Live de référence (manuel)

**Fichiers :**

- Créer : `proto/http-in-live/test_project/loop_sample.wav` (généré)
- Créer : `proto/http-in-live/test_project/reference.als` (manuel via Live)
- Créer : `proto/http-in-live/test_project/reference_heavy.als` (manuel via Live)

- [ ] **Étape 1 : Générer le sample pink-noise (4 mesures à 124 BPM ≈ 7,74 s)**

```bash
cd proto/http-in-live/test_project
python3.11 - <<'PY'
import numpy as np
from scipy.io import wavfile
sr = 48000
bars = 4
bpm = 124
seconds = (60.0 / bpm) * 4 * bars  # 4 beats/bar
n = int(sr * seconds)
# Pink-ish noise via filtered white noise (simple AR coefficient).
rng = np.random.default_rng(seed=42)
white = rng.standard_normal(n).astype(np.float32) * 0.2
pink = np.empty_like(white)
b = [0.99886, -1.99732, 0.99685]  # rough pink filter
a = [1.0, -1.99670, 0.99672]
import scipy.signal as ss
pink = ss.lfilter(b, a, white).astype(np.float32)
pink /= np.max(np.abs(pink))  # normalize
pink *= 0.5                   # -6 dBFS
# 24-bit PCM
pcm = (pink * (2**23 - 1)).astype(np.int32)
wavfile.write("loop_sample.wav", sr, pcm)
print(f"Wrote loop_sample.wav: {n/sr:.3f}s @ {sr} Hz")
PY
```

Attendu : `Wrote loop_sample.wav: 7.742s @ 48000 Hz`. Si `scipy` manque : `pip install scipy`.

- [ ] **Étape 2 : Construire `reference.als` manuellement dans Live 12**

Cette étape est manuelle — le format `.als` est binaire et propriétaire.

1. Ouvrir Live 12.
2. Nouveau Live Set.
3. Régler le tempo à **124 BPM**.
4. Créer **15 pistes audio** (Cmd+T × 15).
5. Drag `loop_sample.wav` depuis le Finder vers la première cellule de clip de la piste 1.
6. Clic droit sur le clip → **Loop** ON. Longueur de loop = 4 mesures.
7. Dupliquer le clip vers les 15 pistes (Cmd+D sur chaque cellule sélectionnée).
8. Lancer toutes les cellules en mode session (Spacebar dans la session view).
9. Vérifier que les 15 pistes jouent en sync sans distortion.
10. Sauver sous `proto/http-in-live/test_project/reference.als`.

- [ ] **Étape 3 : Construire `reference_heavy.als` manuellement**

1. Ouvrir `reference.als` qu'on vient de sauver.
2. Créer une nouvelle piste MIDI. Drop **Wavetable** dessus. Ajouter un clip MIDI simple avec un accord tenu (loop 4 mesures).
3. Dupliquer cette piste MIDI (Cmd+D) pour avoir **2 instances de Wavetable**.
4. Sur le master, ajouter **Hybrid Reverb** avec le preset **"Convolution Large Hall"** (plus lourd CPU que le mode algorithmic).
5. Sauver sous `proto/http-in-live/test_project/reference_heavy.als`.

- [ ] **Étape 4 : Commit les projets**

```bash
git add proto/http-in-live/test_project/
git commit -m "proto: projets Live de référence pour S2 (light) et S2-bis (heavy)"
```

Note : les `.als` sont des blobs binaires. Acceptable sur une branche jetable.

---

## Phase 2 — Bridge (glue queue ↔ asyncio.Future)

### Tâche 5 : Écrire le module bridge avec tests en TDD

**Fichiers :**

- Créer : `proto/http-in-live/load_test/tests/test_bridge.py`
- Créer : `proto/http-in-live/remote_script/agent4live_proto/bridge.py`
- Créer : `proto/http-in-live/pyproject.toml`

- [ ] **Étape 1 : Écrire pyproject.toml**

```toml
[project]
name = "agent4live-proto"
version = "0.0.1"
description = "Throwaway prototype — HTTP MCP server inside Live's Python Remote Script process."
requires-python = ">=3.11"
dependencies = [
  "mcp>=1.0.0",
  "httpx>=0.27.0",
  "numpy>=1.26.0",
  "scipy>=1.13.0",
  "uvicorn>=0.30.0",
  "starlette>=0.37.0",
]

[project.optional-dependencies]
dev = [
  "pytest>=8.0",
  "pytest-asyncio>=0.23",
]

[tool.pytest.ini_options]
testpaths = ["load_test/tests", "remote_script/agent4live_proto"]
asyncio_mode = "auto"
```

- [ ] **Étape 2 : Écrire le test file qui doit fail**

```python
# proto/http-in-live/load_test/tests/test_bridge.py
"""Unit tests for bridge.py — the queue ↔ asyncio.Future glue.

The bridge has two sides:
  - Background (asyncio) side: `submit(request) -> Awaitable[response]`
  - Main-thread side: `drain(handler, max_items)` processes queued messages.

We test both sides with a fake main thread (synchronous, in-test).
"""

import asyncio
import sys
from pathlib import Path
import pytest

# Make the remote_script package importable from the test
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "remote_script"))

from agent4live_proto.bridge import Bridge


@pytest.mark.asyncio
async def test_submit_returns_drained_value():
    bridge = Bridge(main_thread_timeout_s=2.0)

    async def driver():
        return await bridge.submit({"op": "get", "path": "live_set tempo"})

    task = asyncio.create_task(driver())
    # Let the worker thread put the message on the queue
    await asyncio.sleep(0.05)
    drained = bridge.drain(lambda msg: {"ok": True, "value": 124.0}, max_items=4)
    assert drained == 1
    result = await task
    assert result == {"ok": True, "value": 124.0}


@pytest.mark.asyncio
async def test_submit_times_out_when_drain_never_called():
    bridge = Bridge(main_thread_timeout_s=0.1)
    result = await bridge.submit({"op": "get", "path": "nope"})
    assert result["ok"] is False
    assert "timed out" in result["error"]


@pytest.mark.asyncio
async def test_drain_handles_handler_exception():
    bridge = Bridge(main_thread_timeout_s=2.0)

    async def driver():
        return await bridge.submit({"op": "get", "path": "boom"})

    task = asyncio.create_task(driver())
    await asyncio.sleep(0.05)
    def crashing_handler(msg):
        raise RuntimeError("simulated LOM crash")
    bridge.drain(crashing_handler, max_items=4)
    result = await task
    assert result["ok"] is False
    assert "simulated LOM crash" in result["error"]


@pytest.mark.asyncio
async def test_drain_respects_max_items():
    bridge = Bridge(main_thread_timeout_s=2.0)

    async def driver(i):
        return await bridge.submit({"op": "get", "path": str(i)})

    tasks = [asyncio.create_task(driver(i)) for i in range(10)]
    await asyncio.sleep(0.05)
    drained = bridge.drain(lambda msg: {"ok": True, "value": msg["path"]}, max_items=4)
    assert drained == 4
    # Drain again to flush the rest so the test doesn't hang
    bridge.drain(lambda msg: {"ok": True, "value": msg["path"]}, max_items=10)
    results = await asyncio.gather(*tasks)
    assert {r["value"] for r in results} == {str(i) for i in range(10)}


def test_queue_depth_property():
    bridge = Bridge(main_thread_timeout_s=2.0)
    assert bridge.queue_depth() == 0
```

- [ ] **Étape 3 : Lancer les tests pour confirmer qu'ils échouent**

```bash
cd proto/http-in-live
python3.11 -m pip install -e ".[dev]"
pytest load_test/tests/test_bridge.py -v
```

Attendu : ImportError ou ModuleNotFoundError sur `agent4live_proto.bridge`.

- [ ] **Étape 4 : Implémenter bridge.py**

```python
# proto/http-in-live/remote_script/agent4live_proto/bridge.py
"""Thread-safe handoff between the asyncio loop and Live's main thread.

The asyncio side calls `await bridge.submit(msg)` to dispatch a LOM op.
Internally:
  1. A `threading.Event` + a result slot are paired with the message and
     pushed onto a `queue.Queue` (thread-safe).
  2. The asyncio coroutine awaits a `loop.run_in_executor(...)` call that
     blocks on `event.wait(timeout)` in a thread-pool worker.
  3. Live's main thread, on its `update_display()` ~30 Hz tick, calls
     `bridge.drain(handler, max_items)` which pops messages, runs the
     handler, fills the slot, sets the event.

If the timeout fires before drain happens, the submit returns an error
response — Live may have been unresponsive (e.g. modal dialog, freeze).
"""

import asyncio
import queue
import threading
import traceback
from typing import Any, Callable, Dict


class Bridge:
    def __init__(self, main_thread_timeout_s: float = 30.0) -> None:
        self._queue: queue.Queue = queue.Queue()
        self._timeout = main_thread_timeout_s

    def queue_depth(self) -> int:
        return self._queue.qsize()

    async def submit(self, msg: Dict[str, Any]) -> Dict[str, Any]:
        slot: Dict[str, Any] = {"event": threading.Event(), "result": None}
        self._queue.put((msg, slot))
        loop = asyncio.get_running_loop()
        ok = await loop.run_in_executor(None, slot["event"].wait, self._timeout)
        if not ok:
            return {
                "ok": False,
                "error": f"main-thread dispatch timed out after {self._timeout}s",
            }
        return slot["result"]

    def drain(self, handler: Callable[[Dict[str, Any]], Dict[str, Any]], max_items: int) -> int:
        """Called from Live's main thread. Pops up to `max_items` messages,
        runs `handler(msg)` synchronously for each, fills the slot, fires
        the event. Returns the number drained.
        """
        drained = 0
        for _ in range(max_items):
            try:
                msg, slot = self._queue.get_nowait()
            except queue.Empty:
                return drained
            try:
                slot["result"] = handler(msg)
            except Exception as e:
                slot["result"] = {
                    "ok": False,
                    "error": str(e),
                    "trace": traceback.format_exc(),
                }
            slot["event"].set()
            drained += 1
        return drained
```

- [ ] **Étape 5 : Lancer les tests pour vérifier qu'ils passent**

```bash
pytest load_test/tests/test_bridge.py -v
```

Attendu : 5 passed.

- [ ] **Étape 6 : Commit**

```bash
git add proto/http-in-live/pyproject.toml \
        proto/http-in-live/remote_script/agent4live_proto/bridge.py \
        proto/http-in-live/load_test/tests/test_bridge.py
git commit -m "proto: bridge.py (queue ↔ asyncio.Future) avec unit tests"
```

---

## Phase 3 — Exécution LOM (côté main thread)

### Tâche 6 : Écrire l'exécuteur LOM main-thread avec un faux objet Song

**Fichiers :**

- Créer : `proto/http-in-live/remote_script/agent4live_proto/lom_exec.py`
- Créer : `proto/http-in-live/load_test/tests/test_lom_exec.py`

- [ ] **Étape 1 : Écrire le test qui doit fail**

```python
# proto/http-in-live/load_test/tests/test_lom_exec.py
"""Tests for lom_exec — the main-thread LOM executor.

We can't import the real Live API, so the executor takes a `song` object
as a dependency. Tests inject a fake song.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "remote_script"))

from agent4live_proto.lom_exec import execute


class FakeTrack:
    def __init__(self):
        self.name = "Track 1"


class FakeSong:
    def __init__(self):
        self.tempo = 124.0
        self.tracks = [FakeTrack()]
        self._created = []

    def create_audio_track(self, index: int) -> FakeTrack:
        t = FakeTrack()
        t.name = f"Created at {index}"
        self.tracks.append(t)
        self._created.append(t)
        return t

    def delete_track(self, index: int) -> None:
        del self.tracks[index]


def test_get_tempo():
    song = FakeSong()
    out = execute(song, {"op": "get", "path": "live_set tempo"})
    assert out == {"ok": True, "value": 124.0}


def test_set_tempo():
    song = FakeSong()
    out = execute(song, {"op": "set", "path": "live_set tempo", "value": 130.0})
    assert out["ok"] is True
    assert song.tempo == 130.0


def test_call_create_audio_track():
    song = FakeSong()
    out = execute(song, {
        "op": "call",
        "path": "live_set",
        "method": "create_audio_track",
        "args": [-1],
    })
    assert out["ok"] is True
    assert len(song.tracks) == 2


def test_unknown_path_returns_error():
    song = FakeSong()
    out = execute(song, {"op": "get", "path": "live_set foobar"})
    assert out["ok"] is False
    assert "unknown" in out["error"].lower() or "no attribute" in out["error"].lower()


def test_unknown_op_returns_error():
    song = FakeSong()
    out = execute(song, {"op": "WAT", "path": "live_set tempo"})
    assert out["ok"] is False
    assert "op" in out["error"].lower()
```

- [ ] **Étape 2 : Lancer les tests pour confirmer qu'ils échouent**

```bash
pytest load_test/tests/test_lom_exec.py -v
```

Attendu : ImportError sur `lom_exec`.

- [ ] **Étape 3 : Implémenter lom_exec.py**

```python
# proto/http-in-live/remote_script/agent4live_proto/lom_exec.py
"""LOM executor — runs on Live's main thread.

Resolves a dotted/space-separated LOM path against a root object (Live's
`song`), then performs get / set / call. Pure synchronous code, no
threading or asyncio.

Paths use the same convention as the prod LOM router:
  "live_set tempo"                      → song.tempo
  "live_set tracks 0 name"              → song.tracks[0].name
  "live_set tracks 0 devices 1 parameters 3 value" → ...

Numeric tokens are treated as list indices.
"""

from typing import Any, Dict


def _step(node, tok):
    if tok.isdigit():
        try:
            return node[int(tok)]
        except (IndexError, TypeError):
            return None
    return getattr(node, tok, None)


def _resolve_to_node(root, parts):
    """Walk parts[0..n], return the last reached node or None if a step
    yielded None. parts[0] must be 'live_set'."""
    if not parts or parts[0] != "live_set":
        return None
    node = root
    for tok in parts[1:]:
        node = _step(node, tok)
        if node is None:
            return None
    return node


def execute(song: Any, msg: Dict[str, Any]) -> Dict[str, Any]:
    op = msg.get("op")
    path = msg.get("path", "")
    parts = path.split()

    if op == "get":
        if not parts or parts[0] != "live_set":
            return {"ok": False, "error": f"path must start with 'live_set', got '{path}'"}
        if len(parts) == 1:
            return {"ok": True, "value": _serialize(song)}
        parent = _resolve_to_node(song, parts[:-1])
        if parent is None:
            return {"ok": False, "error": f"unknown path: {path}"}
        leaf = parts[-1]
        if not hasattr(parent, leaf) and not (leaf.isdigit() and isinstance(parent, (list, tuple))):
            return {"ok": False, "error": f"no attribute '{leaf}' on {type(parent).__name__}"}
        try:
            value = _step(parent, leaf)
            return {"ok": True, "value": _serialize(value)}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    if op == "set":
        if not parts or parts[0] != "live_set":
            return {"ok": False, "error": f"path must start with 'live_set', got '{path}'"}
        parent = _resolve_to_node(song, parts[:-1])
        if parent is None:
            return {"ok": False, "error": f"unknown path: {path}"}
        try:
            setattr(parent, parts[-1], msg["value"])
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    if op == "call":
        node = _resolve_to_node(song, parts)
        if node is None:
            return {"ok": False, "error": f"unknown path: {path}"}
        method = msg.get("method", "")
        fn = getattr(node, method, None)
        if not callable(fn):
            return {"ok": False, "error": f"no callable '{method}' on {type(node).__name__}"}
        try:
            result = fn(*msg.get("args", []))
            return {"ok": True, "value": _serialize(result)}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    return {"ok": False, "error": f"unknown op '{op}'"}


def _serialize(value):
    """Convert Live API objects to JSON-safe values. For primitives this
    is identity. For complex objects, return repr() — the proto only needs
    primitive returns."""
    if isinstance(value, (int, float, str, bool)) or value is None:
        return value
    if isinstance(value, (list, tuple)):
        return [_serialize(v) for v in value]
    return repr(value)
```

- [ ] **Étape 4 : Lancer les tests pour vérifier qu'ils passent**

```bash
pytest load_test/tests/test_lom_exec.py -v
```

Attendu : 5 passed.

- [ ] **Étape 5 : Commit**

```bash
git add proto/http-in-live/remote_script/agent4live_proto/lom_exec.py \
        proto/http-in-live/load_test/tests/test_lom_exec.py
git commit -m "proto: lom_exec.py (dispatcher LOM main-thread) avec unit tests"
```

---

## Phase 4 — Couche outils MCP

### Tâche 7 : Écrire les handlers d'outils FastMCP avec un faux bridge

**Fichiers :**

- Créer : `proto/http-in-live/remote_script/agent4live_proto/tools.py`
- Créer : `proto/http-in-live/load_test/tests/test_tools.py`

- [ ] **Étape 1 : Écrire le test qui doit fail**

```python
# proto/http-in-live/load_test/tests/test_tools.py
"""Tests for tools.py — the MCP tool handlers.

The handlers are async wrappers around `bridge.submit(...)`. We inject a
fake bridge that returns canned responses.
"""

import asyncio
import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "remote_script"))

from agent4live_proto.tools import build_handlers


class FakeBridge:
    def __init__(self, response):
        self.response = response
        self.submitted = []

    async def submit(self, msg):
        self.submitted.append(msg)
        return self.response

    def queue_depth(self):
        return 0


class FakeDiag:
    def __init__(self):
        self.drain_count = 42
        self.start_time = 0.0


@pytest.mark.asyncio
async def test_lom_get_dispatches_correctly():
    bridge = FakeBridge({"ok": True, "value": 124.0})
    handlers = build_handlers(bridge, FakeDiag())
    result = await handlers["lom_get"](path="live_set tempo")
    assert bridge.submitted == [{"op": "get", "path": "live_set tempo"}]
    assert result["ok"] is True
    assert result["value"] == 124.0


@pytest.mark.asyncio
async def test_lom_set_dispatches_correctly():
    bridge = FakeBridge({"ok": True})
    handlers = build_handlers(bridge, FakeDiag())
    result = await handlers["lom_set"](path="live_set tempo", value=128.0)
    assert bridge.submitted == [{"op": "set", "path": "live_set tempo", "value": 128.0}]
    assert result["ok"] is True


@pytest.mark.asyncio
async def test_lom_call_dispatches_correctly():
    bridge = FakeBridge({"ok": True, "value": "Created Track"})
    handlers = build_handlers(bridge, FakeDiag())
    result = await handlers["lom_call"](path="live_set", method="create_audio_track", args=[-1])
    assert bridge.submitted == [{
        "op": "call",
        "path": "live_set",
        "method": "create_audio_track",
        "args": [-1],
    }]
    assert result["ok"] is True


@pytest.mark.asyncio
async def test_proto_diag_returns_runtime_info():
    bridge = FakeBridge(None)
    diag = FakeDiag()
    handlers = build_handlers(bridge, diag)
    result = await handlers["proto_diag"]()
    assert "python_version" in result
    assert "queue_depth" in result
    assert result["queue_depth"] == 0
    assert result["main_thread_drain_count"] == 42
    assert "uptime_s" in result
```

- [ ] **Étape 2 : Lancer les tests pour confirmer qu'ils échouent**

```bash
pytest load_test/tests/test_tools.py -v
```

Attendu : ImportError sur `agent4live_proto.tools`.

- [ ] **Étape 3 : Implémenter tools.py**

```python
# proto/http-in-live/remote_script/agent4live_proto/tools.py
"""MCP tool handlers — async wrappers around the bridge.

build_handlers(bridge, diag) returns a dict of async functions that the
FastMCP server registers as tools. Each handler stays minimal: validate
shape, hand off to bridge, return the response.

Handlers are kept dict-returning (not pydantic models) because the proto
only validates feasibility — not response polishing.
"""

import sys
import time
from typing import Any, Dict, List, Optional


def build_handlers(bridge, diag) -> Dict[str, Any]:
    async def lom_get(path: str) -> Dict[str, Any]:
        """Read a LOM property. Example: path='live_set tempo'."""
        return await bridge.submit({"op": "get", "path": path})

    async def lom_set(path: str, value: Any) -> Dict[str, Any]:
        """Write a LOM property. Example: path='live_set tempo', value=128.0."""
        return await bridge.submit({"op": "set", "path": path, "value": value})

    async def lom_call(
        path: str, method: str, args: Optional[List[Any]] = None
    ) -> Dict[str, Any]:
        """Call a LOM method. Example: path='live_set', method='create_audio_track', args=[-1]."""
        return await bridge.submit({
            "op": "call",
            "path": path,
            "method": method,
            "args": args or [],
        })

    async def proto_diag() -> Dict[str, Any]:
        """Return runtime diagnostics for the proto itself (not a LOM tool)."""
        return {
            "python_version": sys.version,
            "asyncio_loop_running": True,
            "queue_depth": bridge.queue_depth(),
            "main_thread_drain_count": diag.drain_count,
            "uptime_s": time.time() - diag.start_time,
        }

    return {
        "lom_get": lom_get,
        "lom_set": lom_set,
        "lom_call": lom_call,
        "proto_diag": proto_diag,
    }
```

- [ ] **Étape 4 : Lancer les tests pour vérifier qu'ils passent**

```bash
pytest load_test/tests/test_tools.py -v
```

Attendu : 4 passed.

- [ ] **Étape 5 : Commit**

```bash
git add proto/http-in-live/remote_script/agent4live_proto/tools.py \
        proto/http-in-live/load_test/tests/test_tools.py
git commit -m "proto: tools.py (4 handlers MCP) avec unit tests"
```

---

## Phase 5 — Serveur MCP (FastMCP + runner asyncio)

### Tâche 8 : Écrire le runner FastMCP

**Fichiers :**

- Créer : `proto/http-in-live/remote_script/agent4live_proto/server.py`

Cette tâche n'a pas de unit test rapide (un test d'intégration FastMCP exigerait un vrai roundtrip HTTP). Validation = smoke test en Tâche 9 et S1 complet en Phase 8.

- [ ] **Étape 1 : Implémenter server.py**

```python
# proto/http-in-live/remote_script/agent4live_proto/server.py
"""FastMCP server + asyncio runner for the proto.

Started from the ControlSurface's __init__ in a background thread. The
thread owns its own asyncio event loop. Tool handlers are registered via
the FastMCP decorator API, which dispatches to bridge.submit() — that
hands the work off to Live's main thread.
"""

from __future__ import annotations
import asyncio
import threading
from typing import Any, List, Optional

from mcp.server.fastmcp import FastMCP
import uvicorn


def run_server_thread(bridge, diag, port: int = 19846) -> threading.Thread:
    """Start the FastMCP server on a daemon thread with its own asyncio loop."""

    def runner():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(_serve(bridge, diag, port))
        except Exception:
            import traceback
            traceback.print_exc()
        finally:
            loop.close()

    t = threading.Thread(target=runner, name="agent4live-proto-server", daemon=True)
    t.start()
    return t


async def _serve(bridge, diag, port: int) -> None:
    from .tools import build_handlers
    handlers = build_handlers(bridge, diag)

    mcp = FastMCP("agent4live-proto")

    @mcp.tool()
    async def lom_get(path: str) -> dict:
        """Read a Live Object Model property. Example: path='live_set tempo'."""
        return await handlers["lom_get"](path)

    @mcp.tool()
    async def lom_set(path: str, value: Any) -> dict:
        """Write a Live Object Model property. Example: path='live_set tempo', value=128.0."""
        return await handlers["lom_set"](path, value)

    @mcp.tool()
    async def lom_call(
        path: str, method: str, args: Optional[List[Any]] = None
    ) -> dict:
        """Invoke a Live Object Model method. Example: path='live_set', method='create_audio_track', args=[-1]."""
        return await handlers["lom_call"](path, method, args)

    @mcp.tool()
    async def proto_diag() -> dict:
        """Return runtime diagnostics for the prototype (not a LOM call)."""
        return await handlers["proto_diag"]()

    # FastMCP exposes a Starlette app accessible via mcp.streamable_http_app()
    # (or mcp.sse_app() depending on SDK version). The HTTP MCP transport is
    # what Claude Code expects on http://127.0.0.1:19846/mcp .
    app = mcp.streamable_http_app()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    await server.serve()
```

- [ ] **Étape 2 : Commit**

```bash
git add proto/http-in-live/remote_script/agent4live_proto/server.py
git commit -m "proto: server.py — FastMCP + uvicorn dans thread asyncio dédié"
```

### Tâche 9 : Smoke-test le serveur hors de Live

**Fichiers :**

- Créer : `proto/http-in-live/scripts/smoke_outside_live.py`

Valide que le module server.py s'importe, que le câblage FastMCP marche, et que HTTP MCP est joignable — tout ça **avant** de le plugger dans Live.

- [ ] **Étape 1 : Écrire le driver de smoke test**

```python
# proto/http-in-live/scripts/smoke_outside_live.py
"""Run server.py outside Live with a fake bridge. Verify HTTP + MCP works.

Usage:
  python smoke_outside_live.py &
  # then in another terminal:
  curl -X POST http://127.0.0.1:19846/mcp \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
"""

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "remote_script"))

from agent4live_proto.server import run_server_thread


class FakeBridge:
    async def submit(self, msg):
        # Pretend the main thread answered instantly.
        if msg["op"] == "get":
            return {"ok": True, "value": 124.0}
        if msg["op"] == "set":
            return {"ok": True}
        return {"ok": True, "value": f"called {msg.get('method')}"}

    def queue_depth(self):
        return 0


class FakeDiag:
    def __init__(self):
        self.drain_count = 0
        self.start_time = time.time()


if __name__ == "__main__":
    bridge = FakeBridge()
    diag = FakeDiag()
    t = run_server_thread(bridge, diag, port=19846)
    print(f"Server thread started, alive={t.is_alive()}")
    print("Listening on http://127.0.0.1:19846/mcp")
    print("Press Ctrl-C to stop.")
    try:
        while t.is_alive():
            time.sleep(1.0)
    except KeyboardInterrupt:
        print("\nStopping.")
        sys.exit(0)
```

- [ ] **Étape 2 : Lancer le smoke test**

```bash
cd proto/http-in-live
mkdir -p scripts
# (file already created in Step 1)
python3.11 scripts/smoke_outside_live.py &
sleep 2
# tools/list (discovery MCP)
curl -s -X POST http://127.0.0.1:19846/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
echo ""
# tools/call lom_get
curl -s -X POST http://127.0.0.1:19846/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"lom_get","arguments":{"path":"live_set tempo"}}}'
echo ""
kill %1
```

Attendu : `tools/list` retourne un JSON-RPC contenant `lom_get`, `lom_set`, `lom_call`, `proto_diag`. Le `tools/call` retourne `{"value": 124.0}` (depuis le FakeBridge).

Si la version du SDK FastMCP expose `sse_app()` au lieu de `streamable_http_app()`, adapter la ligne dans `server.py` — l'API du SDK a bougé entre releases. La méthode choisie détermine le path URL (`/mcp` vs `/sse` vs `/messages`) ; vérifier avec `curl http://127.0.0.1:19846/` pour voir les routes Starlette enregistrées.

- [ ] **Étape 3 : Commit (en supposant que le smoke passe)**

```bash
git add proto/http-in-live/scripts/smoke_outside_live.py
git commit -m "proto: smoke_outside_live.py — vérifie le câblage FastMCP hors Live"
```

**Si le smoke échoue** : c'est le premier signal. Documenter ce qui a échoué dans `results/REPORT.md` section "Surprises". Causes courantes : version FastMCP incompatible, dep manquante dans `_vendor/` (à noter : ce script utilise le Python host, donc `_vendor/` ne s'applique pas ici), erreur de bind uvicorn. Corriger et relancer avant de continuer.

---

## Phase 6 — Entry point ControlSurface (runtime Live)

### Tâche 10 : Écrire `__init__.py` ControlSurface

**Fichiers :**

- Créer : `proto/http-in-live/remote_script/agent4live_proto/__init__.py`

Cette tâche ne peut pas être unit-testée localement — `_Framework.ControlSurface` n'existe que dans le Python embarqué de Live. Validation au moment de l'install (Tâche 11) et via S1 (Tâche 17).

- [ ] **Étape 1 : Implémenter `__init__.py`**

```python
# proto/http-in-live/remote_script/agent4live_proto/__init__.py
"""ControlSurface entry point for the HTTP-in-Live prototype.

Loaded by Live when the user assigns 'agent4live_proto' to a Control
Surface slot in Preferences → Link/Tempo/MIDI.

Boot sequence:
  1. Insert _vendor/ into sys.path so Live's Python finds mcp, uvicorn, etc.
  2. Start the FastMCP server on a daemon thread (its own asyncio loop).
  3. Hook update_display() to drain the bridge queue at Live's ~30 Hz rate.

The script never blocks Live's main thread for more than DRAIN_BATCH_SIZE
LOM ops per tick. Each LOM op is a single property read/write/method call.
"""

from __future__ import absolute_import, print_function, unicode_literals

import os
import sys
import time
import traceback

_HERE = os.path.dirname(__file__)
_VENDOR = os.path.join(_HERE, "_vendor")
if _VENDOR not in sys.path:
    sys.path.insert(0, _VENDOR)

from _Framework.ControlSurface import ControlSurface

from .bridge import Bridge
from .lom_exec import execute
from .server import run_server_thread


DRAIN_BATCH_SIZE = 4   # messages per update_display tick (~30 Hz)
PORT = 19846            # different from prod :19845
PROTO_VERSION = 1


class _Diag:
    """Mutable counters that proto_diag exposes via MCP."""
    def __init__(self):
        self.drain_count = 0
        self.start_time = time.time()


class Agent4LiveProto(ControlSurface):
    def __init__(self, c_instance):
        super(Agent4LiveProto, self).__init__(c_instance)
        try:
            self._diag = _Diag()
            self._bridge = Bridge(main_thread_timeout_s=30.0)
            self._server_thread = run_server_thread(self._bridge, self._diag, port=PORT)
            self.log_message(
                "agent4live_proto v%d started on 127.0.0.1:%d (HTTP MCP)" % (PROTO_VERSION, PORT)
            )
        except Exception:
            self.log_message("agent4live_proto failed to start:\n" + traceback.format_exc())

    def disconnect(self):
        # Server thread is daemon ; it dies with the Live process. We don't
        # try to shutdown uvicorn cleanly because that requires async coord.
        super(Agent4LiveProto, self).disconnect()

    def update_display(self):
        super(Agent4LiveProto, self).update_display()
        try:
            n = self._bridge.drain(
                lambda msg: execute(self.song(), msg),
                max_items=DRAIN_BATCH_SIZE,
            )
            self._diag.drain_count += n
        except Exception:
            self.log_message("agent4live_proto drain crashed:\n" + traceback.format_exc())


def create_instance(c_instance):
    return Agent4LiveProto(c_instance)
```

- [ ] **Étape 2 : Commit**

```bash
git add proto/http-in-live/remote_script/agent4live_proto/__init__.py
git commit -m "proto: entry point ControlSurface avec drain update_display"
```

### Tâche 11 : Installer et vérifier que le Remote Script charge dans Live

**Fichiers :** aucun nouveau — procédure manuelle avec vérification

- [ ] **Étape 1 : Lancer install.sh**

```bash
cd proto/http-in-live
./install.sh
```

Sortie attendue contient :

- `Symlinked: <HOME>/Music/Ableton/User Library/Remote Scripts/agent4live_proto → <repo>/proto/http-in-live/remote_script/agent4live_proto`
- `Vendored deps installed.`

Vérifier : `ls -la ~/Music/Ableton/User\ Library/Remote\ Scripts/agent4live_proto` doit montrer un symlink.

- [ ] **Étape 2 : Assigner dans Live**

1. Ouvrir Live 12.
2. Preferences → Link/Tempo/MIDI → section Control Surface.
3. Choisir un slot qui N'EST PAS celui utilisé par le prod `agent4live`. Mettre la dropdown Control Surface sur `agent4live_proto`. Laisser Input et Output à `None`.
4. Fermer les Preferences.

- [ ] **Étape 3 : Vérifier que Live.txt confirme le chargement**

```bash
# macOS Live 12 log location
tail -n 50 "$HOME/Library/Preferences/Ableton/Live 12.0/Log.txt" | grep -i agent4live_proto
```

Attendu : `agent4live_proto v1 started on 127.0.0.1:19846 (HTTP MCP)`.

Si on voit un `ImportError` pour `mcp` ou `uvicorn` : le dossier `_vendor/` manque des wheels ou les wheels ne sont pas pure-Python compatibles avec le Python 3.11 de Live 12. Mitigation : vérifier `ls _vendor/`, s'assurer que `mcp/`, `uvicorn/`, `starlette/`, `pydantic/`, `pydantic_core/`, `anyio/`, `sniffio/`, `h11/`, `httpx/`, `idna/`, `typing_extensions.py` sont tous présents.

Si `pydantic_core` est le problème (il ship des C-extensions sur certaines plateformes) : tenter `pip install --target _vendor --no-binary :all: pydantic_core` pour forcer un build source. Si ça échoue aussi, **R2 se déclenche** — passer à la Phase 9 Fallback A.

- [ ] **Étape 4 : Sanity-test depuis le host**

```bash
curl -s -X POST http://127.0.0.1:19846/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Attendu : un JSON-RPC avec les 4 outils. Si la requête hang ou retourne connection refused, vérifier Log.txt pour des tracebacks.

- [ ] **Étape 5 : Note de checkpoint (pas de commit)**

Si tout passe, on est cleared pour le développement du load test. Si l'Étape 3 ou 4 échoue de manière reproductible, marquer comme **R1 ou R2 qui se déclenche** et sauter à la Phase 9 avant de continuer.

---

## Phase 7 — Harnais de load test

### Tâche 12 : Écrire synthetic.py (driver S1 + S2)

**Fichiers :**

- Créer : `proto/http-in-live/load_test/synthetic.py`
- Créer : `proto/http-in-live/load_test/tests/test_synthetic.py`

- [ ] **Étape 1 : Écrire le test pour le helper de métriques**

```python
# proto/http-in-live/load_test/tests/test_synthetic.py
"""Tests for the metrics summarizer in synthetic.py.

We don't test the HTTP transport here — that's covered by S1/S2 against
a live server. We test that latency_summary() computes the right
percentiles from a list of timings.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from synthetic import latency_summary


def test_basic_percentiles():
    timings = [10.0, 20.0, 30.0, 40.0, 50.0]  # ms
    s = latency_summary(timings)
    assert s["count"] == 5
    assert s["min_ms"] == 10.0
    assert s["max_ms"] == 50.0
    # Median of 5 values
    assert s["p50_ms"] == 30.0


def test_p99_with_outlier():
    timings = [1.0] * 99 + [1000.0]
    s = latency_summary(timings)
    assert s["p99_ms"] == 1000.0


def test_empty_list_returns_zeros():
    s = latency_summary([])
    assert s["count"] == 0
    assert s["p50_ms"] == 0.0
```

- [ ] **Étape 2 : Lancer les tests pour confirmer qu'ils échouent**

```bash
pytest load_test/tests/test_synthetic.py -v
```

Attendu : ImportError sur `synthetic`.

- [ ] **Étape 3 : Implémenter synthetic.py**

```python
# proto/http-in-live/load_test/synthetic.py
"""Synthetic MCP client for S1 (sequential latency) and S2 (sustained burst).

Drives the proto server over HTTP/MCP using httpx. Writes a JSON metrics
blob to stdout that run_scenario.py captures into results/run_NNN.json.

Usage:
  python synthetic.py s1 --url http://127.0.0.1:19846/mcp --calls 1000
  python synthetic.py s2 --url http://127.0.0.1:19846/mcp --rps 50 --duration 300
"""

from __future__ import annotations
import argparse
import asyncio
import json
import random
import statistics
import sys
import time
from typing import Any, Dict, List

import httpx


def latency_summary(timings_ms: List[float]) -> Dict[str, float]:
    if not timings_ms:
        return {"count": 0, "min_ms": 0.0, "max_ms": 0.0,
                "p50_ms": 0.0, "p95_ms": 0.0, "p99_ms": 0.0, "p99_9_ms": 0.0,
                "mean_ms": 0.0}
    sorted_t = sorted(timings_ms)
    def pct(p):
        k = max(0, min(len(sorted_t) - 1, int(round(p * (len(sorted_t) - 1)))))
        return sorted_t[k]
    return {
        "count": len(timings_ms),
        "min_ms": sorted_t[0],
        "max_ms": sorted_t[-1],
        "p50_ms": pct(0.50),
        "p95_ms": pct(0.95),
        "p99_ms": pct(0.99),
        "p99_9_ms": pct(0.999),
        "mean_ms": statistics.fmean(timings_ms),
    }


async def _call(client: httpx.AsyncClient, url: str, rpc_id: int, name: str, args: Dict[str, Any]) -> float:
    body = {
        "jsonrpc": "2.0",
        "id": rpc_id,
        "method": "tools/call",
        "params": {"name": name, "arguments": args},
    }
    headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
    t0 = time.perf_counter()
    r = await client.post(url, json=body, headers=headers)
    elapsed = (time.perf_counter() - t0) * 1000.0
    r.raise_for_status()
    return elapsed


async def run_s1(url: str, calls: int) -> Dict[str, Any]:
    timings: List[float] = []
    async with httpx.AsyncClient(timeout=10.0) as client:
        for i in range(calls):
            t = await _call(client, url, i, "lom_get", {"path": "live_set tempo"})
            timings.append(t)
    return {"scenario": "S1", "url": url, "calls": calls, "latency": latency_summary(timings)}


async def run_s2(url: str, rps: int, duration_s: int) -> Dict[str, Any]:
    """Sustained mix : 70% lom_get, 25% lom_set, 5% lom_call(create + delete).

    Uses asyncio.gather with a per-second batch to enforce the rate.
    """
    timings: List[float] = []
    rng = random.Random(0xC0FFEE)
    started = time.perf_counter()
    error_count = 0

    async with httpx.AsyncClient(timeout=10.0) as client:
        rpc_id = 0
        while time.perf_counter() - started < duration_s:
            tick_start = time.perf_counter()
            tasks = []
            for _ in range(rps):
                roll = rng.random()
                if roll < 0.70:
                    tasks.append(_call(client, url, rpc_id, "lom_get",
                                       {"path": "live_set tempo"}))
                elif roll < 0.95:
                    new_tempo = round(120.0 + rng.random() * 8.0, 1)
                    tasks.append(_call(client, url, rpc_id, "lom_set",
                                       {"path": "live_set tempo", "value": new_tempo}))
                else:
                    tasks.append(_call(client, url, rpc_id, "lom_call",
                                       {"path": "live_set",
                                        "method": "create_audio_track",
                                        "args": [-1]}))
                rpc_id += 1
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for r in results:
                if isinstance(r, float):
                    timings.append(r)
                else:
                    error_count += 1
            # Pace to 1 second per batch
            elapsed = time.perf_counter() - tick_start
            if elapsed < 1.0:
                await asyncio.sleep(1.0 - elapsed)

    return {
        "scenario": "S2",
        "url": url,
        "rps": rps,
        "duration_s": duration_s,
        "calls": len(timings),
        "errors": error_count,
        "latency": latency_summary(timings),
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("scenario", choices=["s1", "s2"])
    p.add_argument("--url", default="http://127.0.0.1:19846/mcp")
    p.add_argument("--calls", type=int, default=1000)
    p.add_argument("--rps", type=int, default=50)
    p.add_argument("--duration", type=int, default=300)
    args = p.parse_args()

    if args.scenario == "s1":
        result = asyncio.run(run_s1(args.url, args.calls))
    else:
        result = asyncio.run(run_s2(args.url, args.rps, args.duration))
    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
```

- [ ] **Étape 4 : Lancer les tests pour vérifier qu'ils passent**

```bash
pytest load_test/tests/test_synthetic.py -v
```

Attendu : 3 passed.

- [ ] **Étape 5 : Commit**

```bash
git add proto/http-in-live/load_test/synthetic.py \
        proto/http-in-live/load_test/tests/test_synthetic.py
git commit -m "proto: synthetic.py — driver MCP S1/S2 avec métriques"
```

### Tâche 13 : Écrire stability.py (sampler S3 endurance)

**Fichiers :**

- Créer : `proto/http-in-live/load_test/stability.py`

- [ ] **Étape 1 : Implémenter stability.py**

```python
# proto/http-in-live/load_test/stability.py
"""S3 endurance test : 5 req/s for 12 hours, with health sampling.

Every 15 minutes:
  - RSS of the Live process (ps -o rss)
  - File descriptor count (lsof -p <pid> | wc -l)
  - Latency p50 from a fresh 100-call sample
  - proto_diag (queue_depth, drain_count, uptime)

Writes one JSON line per sample to stdout. run_scenario.py captures it.
"""

from __future__ import annotations
import argparse
import asyncio
import json
import subprocess
import sys
import time
from typing import Any, Dict, List

import httpx


SAMPLE_INTERVAL_S = 15 * 60  # 15 minutes


def find_live_pid() -> int:
    """Return the macOS Ableton Live PID via pgrep. Live's process is named 'Live'."""
    out = subprocess.run(["pgrep", "-f", "Ableton Live"], capture_output=True, text=True)
    pids = [int(p) for p in out.stdout.strip().splitlines()]
    if not pids:
        raise RuntimeError("No Live process found (pgrep -f 'Ableton Live')")
    return pids[0]


def sample_rss(pid: int) -> int:
    out = subprocess.run(["ps", "-o", "rss=", "-p", str(pid)], capture_output=True, text=True)
    return int(out.stdout.strip())  # in KB


def sample_fd_count(pid: int) -> int:
    out = subprocess.run(["lsof", "-p", str(pid)], capture_output=True, text=True)
    return len(out.stdout.strip().splitlines())


async def sample_latency(url: str, calls: int = 100) -> Dict[str, Any]:
    """Run a quick latency probe against the proto. Returns p50, p99 in ms."""
    timings: List[float] = []
    async with httpx.AsyncClient(timeout=10.0) as client:
        for i in range(calls):
            t0 = time.perf_counter()
            r = await client.post(
                url,
                json={
                    "jsonrpc": "2.0",
                    "id": i,
                    "method": "tools/call",
                    "params": {"name": "lom_get", "arguments": {"path": "live_set tempo"}},
                },
                headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream"},
            )
            r.raise_for_status()
            timings.append((time.perf_counter() - t0) * 1000.0)
    timings.sort()
    return {"p50_ms": timings[len(timings) // 2], "p99_ms": timings[int(len(timings) * 0.99)]}


async def sample_proto_diag(url: str) -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.post(
            url,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "proto_diag", "arguments": {}},
            },
            headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream"},
        )
        return r.json()


async def keepalive_load(url: str, rps: int, stop_event: asyncio.Event) -> None:
    """Background task : keep 5 req/s flowing for the entire duration."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        rpc_id = 0
        while not stop_event.is_set():
            t0 = time.perf_counter()
            try:
                await client.post(
                    url,
                    json={
                        "jsonrpc": "2.0",
                        "id": rpc_id,
                        "method": "tools/call",
                        "params": {"name": "lom_get", "arguments": {"path": "live_set tempo"}},
                    },
                    headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream"},
                )
            except Exception:
                pass
            rpc_id += 1
            elapsed = time.perf_counter() - t0
            interval = 1.0 / rps
            if elapsed < interval:
                await asyncio.sleep(interval - elapsed)


async def run(url: str, duration_s: int, rps: int) -> None:
    pid = find_live_pid()
    stop = asyncio.Event()
    bg = asyncio.create_task(keepalive_load(url, rps, stop))
    start = time.time()
    try:
        while time.time() - start < duration_s:
            sample: Dict[str, Any] = {
                "t": time.time(),
                "elapsed_s": time.time() - start,
                "rss_kb": sample_rss(pid),
                "fd_count": sample_fd_count(pid),
            }
            sample["latency"] = await sample_latency(url)
            sample["proto_diag"] = await sample_proto_diag(url)
            json.dump(sample, sys.stdout)
            sys.stdout.write("\n")
            sys.stdout.flush()
            await asyncio.sleep(SAMPLE_INTERVAL_S)
    finally:
        stop.set()
        await bg


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--url", default="http://127.0.0.1:19846/mcp")
    p.add_argument("--duration", type=int, default=12 * 3600, help="seconds (default 12h)")
    p.add_argument("--rps", type=int, default=5)
    args = p.parse_args()
    asyncio.run(run(args.url, args.duration, args.rps))


if __name__ == "__main__":
    main()
```

- [ ] **Étape 2 : Commit**

```bash
git add proto/http-in-live/load_test/stability.py
git commit -m "proto: stability.py — endurance 12h S3 avec sampling RSS/fd/latence"
```

### Tâche 14 : Écrire detect_dropouts.py (analyse audio)

**Fichiers :**

- Créer : `proto/http-in-live/load_test/detect_dropouts.py`
- Créer : `proto/http-in-live/load_test/tests/test_detect_dropouts.py`

- [ ] **Étape 1 : Écrire le test qui doit fail**

```python
# proto/http-in-live/load_test/tests/test_detect_dropouts.py
import sys
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from detect_dropouts import find_discontinuities


def test_clean_signal_has_no_discontinuities():
    # A 1 kHz sine, 1 sec at 48 kHz
    sr = 48000
    t = np.arange(sr) / sr
    x = (np.sin(2 * np.pi * 1000 * t) * 0.5).astype(np.float32)
    drops = find_discontinuities(x, sr, threshold=0.5)
    assert drops == []


def test_inserted_gap_is_detected():
    sr = 48000
    t = np.arange(sr) / sr
    x = (np.sin(2 * np.pi * 1000 * t) * 0.5).astype(np.float32)
    # Insert a 5 ms gap of zeros around sample 24000
    x_gap = x.copy()
    x_gap[24000:24000 + int(0.005 * sr)] = 0.0
    drops = find_discontinuities(x_gap, sr, threshold=0.3)
    assert len(drops) >= 1
    # Drop position is within the gap window
    assert any(23900 <= d["sample"] <= 24300 for d in drops)


def test_threshold_filters_micro_jumps():
    sr = 48000
    x = np.zeros(sr, dtype=np.float32)
    x[1000] = 0.1  # tiny jump
    drops = find_discontinuities(x, sr, threshold=0.5)
    assert drops == []
```

- [ ] **Étape 2 : Lancer les tests pour confirmer qu'ils échouent**

```bash
pytest load_test/tests/test_detect_dropouts.py -v
```

Attendu : ImportError sur `detect_dropouts`.

- [ ] **Étape 3 : Implémenter detect_dropouts.py**

```python
# proto/http-in-live/load_test/detect_dropouts.py
"""Detect audio dropouts in a recorded .wav file.

A dropout is a sudden discontinuity in the audio signal — either a
sample-to-sample jump that exceeds a threshold, or a silent gap that
shouldn't be there. We use a first-difference approach : compute
|x[n] - x[n-1]| and flag samples where this exceeds `threshold`
(in normalized [-1, 1] amplitude).

For musical content, threshold=0.5 is reasonable : real audio rarely
changes by more than ±0.5 in a single sample at 48 kHz. Adjustable per
invocation.
"""

from __future__ import annotations
import argparse
import json
import sys
from typing import Any, Dict, List

import numpy as np
from scipy.io import wavfile


def find_discontinuities(samples: np.ndarray, sr: int, threshold: float = 0.5) -> List[Dict[str, Any]]:
    if samples.ndim > 1:
        # Stereo or multi-channel : take max across channels
        samples = np.max(np.abs(samples), axis=1)
    if samples.dtype.kind == "i":
        # Normalize int PCM to [-1, 1]
        max_val = float(2 ** (8 * samples.dtype.itemsize - 1))
        samples = samples.astype(np.float32) / max_val
    diffs = np.abs(np.diff(samples))
    indices = np.where(diffs > threshold)[0]
    drops: List[Dict[str, Any]] = []
    for idx in indices:
        drops.append({
            "sample": int(idx),
            "time_s": float(idx) / sr,
            "jump": float(diffs[idx]),
        })
    return drops


def main():
    p = argparse.ArgumentParser()
    p.add_argument("wav_path")
    p.add_argument("--threshold", type=float, default=0.5)
    args = p.parse_args()
    sr, samples = wavfile.read(args.wav_path)
    drops = find_discontinuities(samples, sr, args.threshold)
    out = {
        "wav_path": args.wav_path,
        "sample_rate": sr,
        "duration_s": len(samples) / sr,
        "threshold": args.threshold,
        "dropout_count": len(drops),
        "dropouts": drops[:20],  # cap at 20 in the report
    }
    json.dump(out, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
```

- [ ] **Étape 4 : Lancer les tests pour vérifier qu'ils passent**

```bash
pytest load_test/tests/test_detect_dropouts.py -v
```

Attendu : 3 passed.

- [ ] **Étape 5 : Commit**

```bash
git add proto/http-in-live/load_test/detect_dropouts.py \
        proto/http-in-live/load_test/tests/test_detect_dropouts.py
git commit -m "proto: detect_dropouts.py — scan des discontinuités via numpy"
```

### Tâche 15 : Écrire l'orchestrateur run_scenario.py

**Fichiers :**

- Créer : `proto/http-in-live/load_test/run_scenario.py`

- [ ] **Étape 1 : Implémenter run_scenario.py**

```python
# proto/http-in-live/load_test/run_scenario.py
"""Orchestrate a scenario : invoke the right driver, write run_NNN.json.

Usage:
  python run_scenario.py s1
  python run_scenario.py s2
  python run_scenario.py s3
"""

from __future__ import annotations
import argparse
import datetime
import json
import subprocess
import sys
from pathlib import Path


RESULTS_DIR = Path(__file__).resolve().parents[1] / "results"


def next_run_number() -> int:
    RESULTS_DIR.mkdir(exist_ok=True)
    existing = sorted(RESULTS_DIR.glob("run_*.json"))
    if not existing:
        return 1
    last = existing[-1].stem.split("_")[1]
    return int(last) + 1


def run_synthetic(args) -> dict:
    cmd = [sys.executable, "synthetic.py", args.scenario]
    if args.scenario == "s1":
        cmd += ["--calls", "1000"]
    else:  # s2
        cmd += ["--rps", "50", "--duration", "300"]
    out = subprocess.run(cmd, capture_output=True, text=True, check=True,
                         cwd=Path(__file__).parent)
    return json.loads(out.stdout)


def run_stability(args) -> dict:
    cmd = [sys.executable, "stability.py", "--duration", str(args.duration)]
    out = subprocess.run(cmd, capture_output=True, text=True, check=True,
                         cwd=Path(__file__).parent)
    samples = [json.loads(line) for line in out.stdout.strip().splitlines()]
    return {"scenario": "S3", "duration_s": args.duration, "samples": samples}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("scenario", choices=["s1", "s2", "s3"])
    p.add_argument("--duration", type=int, default=12 * 3600)
    args = p.parse_args()

    if args.scenario in ("s1", "s2"):
        result = run_synthetic(args)
    else:
        result = run_stability(args)

    result["timestamp"] = datetime.datetime.utcnow().isoformat() + "Z"
    n = next_run_number()
    out_path = RESULTS_DIR / f"run_{n:03d}.json"
    with open(out_path, "w") as f:
        json.dump(result, f, indent=2)
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
```

- [ ] **Étape 2 : Commit**

```bash
git add proto/http-in-live/load_test/run_scenario.py
git commit -m "proto: run_scenario.py — orchestrateur qui écrit run_NNN.json"
```

### Tâche 16 : Écrire le script de session Claude Code

**Fichiers :**

- Créer : `proto/http-in-live/load_test/claude_code_session.md`

- [ ] **Étape 1 : Écrire le script de session**

```markdown
# S5 — Script de session real-client Claude Code

## Setup

1. Vérifier que le Remote Script proto est chargé dans Live (Phase 6 Tâche 11).
2. Configurer Claude Code pour utiliser le serveur proto :
   \`\`\`bash
   claude mcp add agent4live-proto --transport http http://127.0.0.1:19846/mcp
   \`\`\`
3. Ouvrir une nouvelle conversation Claude Code dans n'importe quel dossier.
4. S'assurer que Live a un projet ouvert avec au moins une piste (pour que
   `delete_track` ait quelque chose sur quoi opérer si besoin).

## Séquence de prompts

Lancer ces prompts **un à la fois**, en attendant que la réponse de Claude
et les tool calls se stabilisent avant le suivant.

### Prompt 1 — Read

> Quel est le tempo actuel dans Ableton ?

Tool call attendu : `lom_get(path="live_set tempo")`.
Réponse attendue : Claude annonce le tempo (qui matche la valeur visible dans Live).

### Prompt 2 — Write

> Mets le tempo à 128 BPM.

Tool call attendu : `lom_set(path="live_set tempo", value=128.0)`.
Réponse attendue : l'afficheur de tempo de Live monte à 128.00.

### Prompt 3 — Appel de méthode

> Crée une nouvelle piste audio.

Tool call attendu : `lom_call(path="live_set", method="create_audio_track", args=[-1])`.
Réponse attendue : une nouvelle piste audio apparaît dans Live.

### Prompt 4 — Référence contextuelle

> Supprime la piste que tu viens de créer.

Tool call attendu : `lom_call(path="live_set", method="delete_track", args=[<index>])`.
Réponse attendue : la piste fraîchement créée disparaît.

### Prompt 5 — Session en burst

> Alterne le tempo entre 124 et 128 BPM, 10 fois de suite.

Tool calls attendus : 10 `lom_set` alternés.
Réponse attendue : le tempo de Live cycle, finit à 128 (ou 124, selon la parité).

## Critères de pass

- Claude Code se connecte sans erreur.
- `tools/list` découvre les 4 outils (visible via `claude mcp list` après
  le démarrage de la conversation).
- Chaque prompt produit le tool call attendu et l'effet attendu côté Live
  en moins de 2 secondes.
- La session ne timeout pas. Pas d'erreur MCP malformée dans la sortie de
  Claude Code.

## Enregistrer le résultat

Après avoir complété les 5 prompts, écrire le résultat manuellement dans
`results/run_NNN.json` (prendre le numéro libre suivant) :

\`\`\`json
{
"scenario": "S5",
"timestamp": "...",
"claude_code_version": "...",
"prompts_passed": 5,
"prompts_failed": 0,
"notes": "Anything surprising"
}
\`\`\`
```

- [ ] **Étape 2 : Commit**

```bash
git add proto/http-in-live/load_test/claude_code_session.md
git commit -m "proto: claude_code_session.md — procédure S5 manuelle pour test client réel"
```

---

## Phase 8 — Exécuter les scénarios

Cette phase est principalement procédurale. Le code est déjà écrit. Chaque tâche = "lance X, enregistre les résultats, vérifie les critères de pass".

### Tâche 17 : Exécuter S1 — Latence isolée

**Fichiers :**

- Touch : `proto/http-in-live/results/run_001.json` (généré)

- [ ] **Étape 1 : Préparer Live**

1. Ouvrir Live 12.
2. Nouveau Live Set (projet vide, pas de pistes).
3. Transport stoppé (pas de Play).
4. Vérifier que `agent4live_proto` est le seul Control Surface actif assigné (on peut laisser le prod `agent4live` assigné aussi — il tourne sur :19845 et n'interfère pas).

- [ ] **Étape 2 : Lancer S1**

```bash
cd proto/http-in-live/load_test
python3.11 run_scenario.py s1
```

Attendu : `Wrote .../results/run_001.json`.

- [ ] **Étape 3 : Vérifier les critères de pass**

```bash
cat ../results/run_001.json | python3.11 -m json.tool
```

Vérifier :

- `latency.p50_ms < 4.0`
- `latency.p99_ms < 15.0`

Si l'un ou l'autre échoue, **c'est un signal partiel**. Enregistrer les valeurs réelles dans la section "Surprises" de `REPORT.md`. Ne pas abort tout de suite — continuer vers S2 pour voir si le failure mode reproduit sous charge.

- [ ] **Étape 4 : Commit les résultats**

```bash
git add ../results/run_001.json
git commit -m "proto: résultats S1 — latence isolée (1000 calls)"
```

### Tâche 18 : Exécuter S2 — Burst soutenu pendant Live qui joue

**Fichiers :**

- Touch : `proto/http-in-live/results/run_002.json` (synthetic)
- Touch : `proto/http-in-live/results/run_002_audio.wav` (enregistré)
- Touch : `proto/http-in-live/results/run_002_dropouts.json` (analyse)
- Touch : `proto/http-in-live/results/run_002_cpu.png` (screenshot)

- [ ] **Étape 1 : Préparer Live**

1. Ouvrir `proto/http-in-live/test_project/reference.als` dans Live 12.
2. Appuyer sur Play. Vérifier que les 15 pistes jouent en sync sans distortion (CPU baseline doit rester confortablement sous 30 %).
3. Configurer l'enregistrement audio Live pour capturer la sortie master vers
   `proto/http-in-live/results/run_002_audio.wav` (File → Export Audio/Video, ou Record-Arm sur une piste avec routing Master).

Alternative pour un capture plus propre : enregistrer depuis le device audio par défaut via `sox` dans un autre terminal :

```bash
sox -t coreaudio default proto/http-in-live/results/run_002_audio.wav \
    rate 48000 channels 2 bits 24 trim 0 305
```

Enregistre 305 secondes (5 min + un peu de head/tail).

- [ ] **Étape 2 : Ouvrir la vue Performance Impact de Live**

Options → Performance Impact (Cmd+Alt+P). Positionner la fenêtre pour qu'elle soit visible pendant le run. Prendre un screenshot toutes les minutes (manuel : `Cmd+Shift+5` → sélection fenêtre).

- [ ] **Étape 3 : Lancer S2**

```bash
cd proto/http-in-live/load_test
python3.11 run_scenario.py s2
```

Attendu (après ~5 min) : `Wrote .../results/run_002.json`.

Pendant le run, surveiller le CPU meter de Live et écouter les dropouts audibles dans la sortie master au casque.

- [ ] **Étape 4 : Stopper l'enregistrement audio et analyser**

```bash
# Stopper sox avec Ctrl-C s'il tourne encore.
cd proto/http-in-live/load_test
python3.11 detect_dropouts.py ../results/run_002_audio.wav --threshold 0.5 > ../results/run_002_dropouts.json
cat ../results/run_002_dropouts.json
```

Vérifier :

- `latency.p50_ms` au maximum 2× la valeur de S1
- `errors == 0` (ou très proche de 0)
- `run_002_dropouts.json.dropout_count == 0`
- Les screenshots CPU montrent pic et steady tous deux < 100 %
- Subjectif : pas de glitches audibles pendant le run

Si `dropout_count > 0`, inspecter chaque drop. Faux positifs possibles si la méthode d'enregistrement elle-même a glitché (le pipeline d'export Live a des artefacts connus). Pour l'instant, traiter tout drop > 1 comme un signal NO jusqu'à investigation.

- [ ] **Étape 5 : Nettoyage des pistes créées pendant S2 dans Live**

Cmd+Z (undo) répété jusqu'à ce que la session matche à nouveau le `reference.als` sauvé. La pile d'undo de Live doit couvrir les ~750 pistes créées (5 % des ~15000 calls = 750 `lom_call create_audio_track`). Si Live freeze ou ralentit sur l'undo en masse, alternative : File → Close Without Saving puis ré-ouvrir `reference.als` (plus rapide qu'undo × 750).

- [ ] **Étape 6 : Commit les résultats**

```bash
git add ../results/run_002.json \
        ../results/run_002_dropouts.json
# .wav et screenshots = gros + binaire ; gitignore
echo "results/*.wav" >> ../../.gitignore
echo "results/*.png" >> ../../.gitignore
git add ../../.gitignore
git commit -m "proto: résultats S2 — burst 50 req/s × 5 min audio + dropouts + CPU"
```

### Tâche 19 : Exécuter S2-bis — Variante projet lourd

**Fichiers :**

- Touch : `proto/http-in-live/results/run_003.json` (et audio/dropouts/cpu)

- [ ] **Étape 1 : Ouvrir le projet de référence heavy**

Ouvrir `proto/http-in-live/test_project/reference_heavy.als`. Vérifier que les 2 instances de Wavetable sont présentes et qu'Hybrid Reverb est chargé sur le master avec le preset "Convolution Large Hall". Press Play. Confirmer que le CPU baseline est plus haut que `reference.als` (~50-70 %).

- [ ] **Étape 2 : Répéter la procédure S2**

Même procédure que la Tâche 18 mais avec `reference_heavy.als` chargé. Enregistrement audio vers `run_003_audio.wav`. Lancer :

```bash
cd proto/http-in-live/load_test
python3.11 run_scenario.py s2
# Inspecter le nom du fichier réellement écrit
ls -t ../results/run_*.json | head -1
```

Vérifier les mêmes critères de pass que S2.

- [ ] **Étape 3 : Nettoyage, analyse, commit**

```bash
cd proto/http-in-live/load_test
python3.11 detect_dropouts.py ../results/run_003_audio.wav --threshold 0.5 > ../results/run_003_dropouts.json
# Undo toutes les pistes créées dans Live
git add ../results/run_003.json ../results/run_003_dropouts.json
git commit -m "proto: résultats S2-bis — burst 50 rps × 5 min sur projet heavy"
```

### Tâche 20 : Exécuter S3 — Endurance 12h

**Fichiers :**

- Touch : `proto/http-in-live/results/run_004.json`

C'est un test long-running unattended. Utiliser `nohup` et idéalement laisser Live tourner sur une machine dédiée (ou au minimum verrouiller l'écran et désactiver le sleep : `caffeinate -i` dans un autre terminal).

- [ ] **Étape 1 : Préparer le run unattended**

1. Ouvrir `reference.als` (le projet light — heavy pas nécessaire pour l'endurance).
2. Press Play.
3. Dans un terminal :
   ```bash
   caffeinate -i &  # empêche macOS de sleep
   ```

- [ ] **Étape 2 : Lancer le run 12h**

```bash
cd proto/http-in-live/load_test
nohup python3.11 run_scenario.py s3 --duration 43200 > /tmp/s3_stdout.log 2>&1 &
disown
echo "Launched PID $!"
```

`43200` = 12 heures en secondes. Output dans `/tmp/s3_stdout.log` ; le `run_NNN.json` final est écrit en fin de run.

- [ ] **Étape 3 : Spot-check pendant le run**

Toutes les quelques heures, sanity check :

```bash
tail -1 /tmp/s3_stdout.log   # montre le sample le plus récent
```

Chaque ligne sample est un objet JSON avec `rss_kb`, `fd_count`, `latency`, `proto_diag`. Surveiller les croissances monotones qui ne plateauent pas.

- [ ] **Étape 4 : Après 12h, vérifier les critères de pass**

```bash
cat ../results/run_NNN.json | python3.11 - <<'PY'
import json, sys
data = json.load(sys.stdin)
samples = data["samples"]
print(f"Samples: {len(samples)}")
rss_first, rss_last = samples[0]["rss_kb"], samples[-1]["rss_kb"]
print(f"RSS: {rss_first} → {rss_last} kb  (delta {rss_last - rss_first} kb)")
fd_first, fd_last = samples[0]["fd_count"], samples[-1]["fd_count"]
print(f"FD : {fd_first} → {fd_last}")
p50_first, p50_last = samples[0]["latency"]["p50_ms"], samples[-1]["latency"]["p50_ms"]
print(f"p50: {p50_first} → {p50_last} ms  (ratio {p50_last / p50_first:.2f})")
qd_max = max(s["proto_diag"]["queue_depth"] for s in samples if "result" in s["proto_diag"])
print(f"queue_depth max: {qd_max}")
PY
```

Vérifier :

- RSS delta < 20 MB (20 480 KB)
- FD count steady (oscille, pas de croissance monotone)
- p50 ratio last/first < 1.5
- queue_depth max < 5

- [ ] **Étape 5 : Commit**

```bash
git add ../results/run_NNN.json
git commit -m "proto: résultats S3 — endurance 12h, drift RSS/fd/latence"
```

### Tâche 21 : Exécuter S4 — Cycle de vie Live

C'est un test procédural manuel. ~30 minutes.

- [ ] **Étape 1 : Dérouler la séquence en enregistrant les observations**

Créer `proto/http-in-live/results/run_NNN_s4.md` (numéro libre suivant) et dérouler chaque étape. Pour chaque étape, écrire `PASS` ou `FAIL: <raison>`.

| Étape | Action                                                         | Vérification                                                                      |
| ----- | -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1     | Live ouvert, proto chargé, `curl ... lom_set tempo 124` marche | tempo display = 124                                                               |
| 2     | Stop transport, `curl ... lom_get tempo` marche                | retourne 124                                                                      |
| 3     | File → Open → charger un autre projet (n'importe lequel)       | proto se ré-attache, `curl ... lom_get tempo` retourne le tempo du nouveau projet |
| 4     | File → Save                                                    | pas de crash                                                                      |
| 5     | Preferences → Link/Tempo/MIDI → set proto slot à None          | proto cesse de répondre (connection refused)                                      |
| 6     | Re-set le proto slot                                           | proto répond à nouveau                                                            |
| 7     | File → Quit, puis relancer Live + ouvrir un projet             | proto se charge auto, répond                                                      |

- [ ] **Étape 2 : Commit les résultats**

```bash
git add ../results/run_NNN_s4.md
git commit -m "proto: résultats S4 — cycle de vie Live (open/close/save/quit/relaunch)"
```

### Tâche 22 : Exécuter S5 — Session real-client Claude Code

- [ ] **Étape 1 : Suivre la procédure dans `claude_code_session.md`**

Ouvrir le fichier, configurer Claude Code, lancer les 5 prompts dans l'ordre. Enregistrer les résultats au format spécifié en bas du fichier.

- [ ] **Étape 2 : Commit le fichier de résultat S5**

```bash
git add ../results/run_NNN_s5.json
git commit -m "proto: résultats S5 — session real-client Claude Code (5 prompts)"
```

### Tâche 23 : Exécuter S6 — Thread-safety des observers

**Fichiers :**

- Créer : `proto/http-in-live/load_test/observer_test.py`
- Touch : `proto/http-in-live/results/run_NNN_s6.json`

Ce scénario nécessite un petit driver custom parce que les observers sont LOM-side et qu'on veut vérifier qu'ils firent correctement pendant que HTTP continue de répondre.

- [ ] **Étape 1 : Ajouter un endpoint observer au proto (patch temporaire)**

Éditer `proto/http-in-live/remote_script/agent4live_proto/__init__.py` :

```python
# En haut de la classe
self._observer_fires = 0

# Après self._server_thread = run_server_thread(...) dans __init__ :
try:
    self.song().add_tempo_listener(self._on_tempo_change)
except Exception as e:
    self.log_message("agent4live_proto observer registration failed: " + str(e))

# Ajouter la méthode :
def _on_tempo_change(self):
    self._observer_fires += 1
    self.log_message(f"agent4live_proto observer fired (count={self._observer_fires}, tempo={self.song().tempo})")
```

Recharger le script (Preferences → set slot à None puis revenir à agent4live_proto).

- [ ] **Étape 2 : Écrire observer_test.py**

```python
# proto/http-in-live/load_test/observer_test.py
"""S6 — verify LOM observers fire correctly while HTTP serves requests.

We change the tempo 50 times via lom_set while concurrently issuing
lom_get calls at high rate. Then we read Live's Log.txt for the count
of observer fires.
"""

import asyncio
import httpx

URL = "http://127.0.0.1:19846/mcp"


async def setter(client, n):
    for i in range(n):
        tempo = 120.0 + (i % 16)
        await client.post(URL, json={
            "jsonrpc": "2.0", "id": i, "method": "tools/call",
            "params": {"name": "lom_set", "arguments": {"path": "live_set tempo", "value": tempo}}
        }, headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream"})
        await asyncio.sleep(0.1)


async def getter(client, n):
    for i in range(n):
        await client.post(URL, json={
            "jsonrpc": "2.0", "id": 10000 + i, "method": "tools/call",
            "params": {"name": "lom_get", "arguments": {"path": "live_set tempo"}}
        }, headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream"})


async def main():
    async with httpx.AsyncClient(timeout=5.0) as client:
        await asyncio.gather(setter(client, 50), getter(client, 500))


if __name__ == "__main__":
    asyncio.run(main())
    print("Done. Check Live's Log.txt for observer fire count.")
```

- [ ] **Étape 3 : Lancer le test, compter les observer fires dans Log.txt**

```bash
cd proto/http-in-live/load_test
python3.11 observer_test.py
# Puis dans un autre shell :
grep "observer fired" "$HOME/Library/Preferences/Ableton/Live 12.0/Log.txt" | tail -50
```

Attendu : au moins 50 lignes "observer fired" distinctes après le run, toutes dans la fenêtre de temps du test (~5 secondes).

- [ ] **Étape 4 : Enregistrer le résultat et revert le patch temporaire**

Écrire `proto/http-in-live/results/run_NNN_s6.json` :

```json
{
  "scenario": "S6",
  "setter_calls": 50,
  "getter_calls_in_parallel": 500,
  "observer_fires_observed": <à remplir>,
  "pass": <true|false>,
  "notes": "..."
}
```

Puis **revert le patch** dans `__init__.py` (on ne veut pas que l'enregistrement de l'observer fuie dans les autres scénarios) :

```bash
git diff remote_script/agent4live_proto/__init__.py
git checkout remote_script/agent4live_proto/__init__.py
```

- [ ] **Étape 5 : Commit**

```bash
git add results/run_NNN_s6.json load_test/observer_test.py
git commit -m "proto: résultats S6 — thread-safety des observers sous charge HTTP concurrente"
```

---

## Phase 9 — Fallback A (contingent, seulement si R1 ou R2 se déclenchent)

Si une des Tâches 11, 17-23 révèle un hard fail attribuable à **asyncio + Live main thread** (R1) ou **incompatibilité de deps SDK MCP** (R2), exécuter cette phase. Sinon sauter directement à la Phase 10.

### Tâche 24 (contingente) : Écrire server_sync.py — JSON-RPC sur stdlib http.server

**Fichiers :**

- Créer : `proto/http-in-live/remote_script/agent4live_proto/server_sync.py`

- [ ] **Étape 1 : Implémenter server_sync.py**

```python
# proto/http-in-live/remote_script/agent4live_proto/server_sync.py
"""Fallback A — hand-rolled JSON-RPC MCP over http.server.ThreadingHTTPServer.

Drops in to replace server.py's run_server_thread without changing the
bridge or lom_exec contracts. No asyncio. No SDK. Just stdlib.

Implements just enough of MCP for Claude Code :
  - JSON-RPC 2.0 over HTTP POST
  - initialize / initialized
  - tools/list
  - tools/call
"""

from __future__ import absolute_import, print_function, unicode_literals

import http.server
import json
import socketserver
import sys
import threading
import time

PROTOCOL_VERSION = "2024-11-05"


def run_server_thread(bridge, diag, port=19846):
    handler_cls = _make_handler(bridge, diag)
    server = socketserver.ThreadingTCPServer(("127.0.0.1", port), handler_cls)
    server.allow_reuse_address = True
    t = threading.Thread(target=server.serve_forever, name="agent4live-proto-server-sync",
                         daemon=True)
    t.start()
    return t


def _make_handler(bridge, diag):

    def proto_diag_handler():
        return {
            "python_version": sys.version,
            "asyncio_loop_running": False,
            "queue_depth": bridge.queue_depth(),
            "main_thread_drain_count": diag.drain_count,
            "uptime_s": time.time() - diag.start_time,
        }

    def call_tool(name, arguments):
        slot = {"event": threading.Event(), "result": None}
        if name == "lom_get":
            msg = {"op": "get", "path": arguments["path"]}
        elif name == "lom_set":
            msg = {"op": "set", "path": arguments["path"], "value": arguments["value"]}
        elif name == "lom_call":
            msg = {"op": "call", "path": arguments["path"], "method": arguments["method"],
                   "args": arguments.get("args", [])}
        elif name == "proto_diag":
            return {"content": [{"type": "text", "text": json.dumps(proto_diag_handler())}]}
        else:
            return {"content": [{"type": "text", "text": json.dumps({"ok": False, "error": "unknown tool"})}], "isError": True}
        bridge._queue.put((msg, slot))
        if not slot["event"].wait(timeout=30.0):
            return {"content": [{"type": "text", "text": json.dumps({"ok": False, "error": "timeout"})}], "isError": True}
        return {"content": [{"type": "text", "text": json.dumps(slot["result"])}]}

    class _Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):  # silence noisy default logging
            return

        def do_POST(self):
            if self.path != "/mcp":
                self.send_response(404); self.end_headers(); return
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length)
            try:
                req = json.loads(body)
            except Exception:
                self.send_response(400); self.end_headers(); return

            method = req.get("method")
            req_id = req.get("id")
            params = req.get("params", {})

            if method == "initialize":
                response = {
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "agent4live-proto", "version": "1.0"},
                }
            elif method == "tools/list":
                response = {"tools": _TOOLS_DECL}
            elif method == "tools/call":
                response = call_tool(params["name"], params.get("arguments", {}))
            elif method == "notifications/initialized":
                self.send_response(204); self.end_headers(); return
            else:
                self.send_response(404); self.end_headers(); return

            payload = {"jsonrpc": "2.0", "id": req_id, "result": response}
            data = json.dumps(payload).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    return _Handler


_TOOLS_DECL = [
    {
        "name": "lom_get",
        "description": "Read a Live Object Model property.",
        "inputSchema": {
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
    },
    {
        "name": "lom_set",
        "description": "Write a Live Object Model property.",
        "inputSchema": {
            "type": "object",
            "properties": {"path": {"type": "string"}, "value": {}},
            "required": ["path", "value"],
        },
    },
    {
        "name": "lom_call",
        "description": "Invoke a Live Object Model method.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "method": {"type": "string"},
                "args": {"type": "array", "items": {}},
            },
            "required": ["path", "method"],
        },
    },
    {
        "name": "proto_diag",
        "description": "Return runtime diagnostics for the prototype (not a LOM call).",
        "inputSchema": {"type": "object", "properties": {}},
    },
]
```

- [ ] **Étape 2 : Swap l'import dans `__init__.py`**

Dans `proto/http-in-live/remote_script/agent4live_proto/__init__.py`, changer :

```python
from .server import run_server_thread
```

en :

```python
from .server_sync import run_server_thread
```

- [ ] **Étape 3 : Recharger dans Live, vérifier le chargement**

Live → Preferences → mettre le slot proto à None, puis revenir sur `agent4live_proto`. Tail `Log.txt` — attendre `agent4live_proto v1 started on 127.0.0.1:19846 (HTTP MCP)`.

```bash
curl -s -X POST http://127.0.0.1:19846/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Attendu : JSON avec les 4 outils.

- [ ] **Étape 4 : Re-lancer S1-S6 avec Fallback A**

Répéter les Tâches 17-23 avec le serveur Fallback A. Écrire des nouveaux fichiers `run_NNN_fallback*.json`. Si Fallback A passe : verdict = **YES (avec note Fallback A)** dans le REPORT.

- [ ] **Étape 5 : Commit Fallback A**

```bash
git add proto/http-in-live/remote_script/agent4live_proto/server_sync.py \
        proto/http-in-live/remote_script/agent4live_proto/__init__.py
git commit -m "proto: Fallback A — JSON-RPC manuel sur stdlib http.server"
```

---

## Phase 10 — Rapport et cleanup

### Tâche 25 : Écrire le REPORT.md final

**Fichiers :**

- Créer : `proto/http-in-live/results/REPORT.md`

- [ ] **Étape 1 : Agréger tous les résultats**

```bash
cd proto/http-in-live/results
ls -la run_*.json
```

Ouvrir chaque `run_NNN.json`, lire les métriques, remplir la table dans `REPORT.md` :

```markdown
# Prototype HTTP-in-Live — Rapport

**Date** : YYYY-MM-DD
**Branche** : `proto/http-in-live` (à supprimer après publication)
**Spec** : [`2026-05-15-prototype-http-in-live-design.md`](../../docs/superpowers/specs/2026-05-15-prototype-http-in-live-design.md)

## Verdict : YES | NO | MIDDLE

[Choisir un. Justifier en 1 court paragraphe ci-dessous.]

[Justification du verdict : "Les 6 scénarios passent leurs seuils stricts
avec de la marge. Le bridge asyncio + main-thread n'interfère pas avec
le moteur audio de Live, même sous 50 req/s soutenus." OU "S3 endurance
a montré un leak RSS de 87 MB après 12h, attribuable à <X>. Fallback A
a re-tourné cleanly. Recommandation de migration avec JSON-RPC manuel
plutôt que le SDK."]

## Résultats par scénario

| S     | Scénario       | Critère               | Mesure       | Pass |
| ----- | -------------- | --------------------- | ------------ | ---- |
| 1     | Latence isolée | p50<4, p99<15         | x.x / x.x ms | ✓/✗  |
| 2     | Burst+audio    | 0 dropout             | x            | ✓/✗  |
| 2     | Burst+audio    | CPU<100%              | pic x %      | ✓/✗  |
| 2     | Burst+audio    | latence stable <2× S1 | x.x ms       | ✓/✗  |
| 2-bis | Projet lourd   | mêmes que S2          | …            | ✓/✗  |
| 3     | Endurance 12h  | leak<20MB             | +x MB        | ✓/✗  |
| 3     | Endurance 12h  | fd steady             | x → x        | ✓/✗  |
| 3     | Endurance 12h  | p50 ratio <1.5×       | x.xx         | ✓/✗  |
| 3     | Endurance 12h  | queue_depth max <5    | x            | ✓/✗  |
| 4     | Cycle Live     | 7/7 steps pass        | 7/7          | ✓/✗  |
| 5     | Claude Code    | 5/5 prompts pass      | 5/5          | ✓/✗  |
| 6     | Observers      | thread-safe           | x fires obs. | ✓/✗  |

## Métriques détaillées

- [run_001.json](run_001.json) — S1
- [run_002.json](run_002.json) — S2
- [run_003.json](run_003.json) — S2-bis
- [run_004.json](run_004.json) — S3
- [run_005_s4.md](run_005_s4.md) — S4
- [run_006_s5.json](run_006_s5.json) — S5
- [run_007_s6.json](run_007_s6.json) — S6

(ajuster les filenames aux numéros réels)

## Surprises / faits saillants

[Texte libre. Tout ce qui s'est passé d'inattendu — gotchas découverts,
écarts du spec, déclenchements de Fallback A, etc.]

## Recommandation pour la migration prod

[GO / NO-GO / GO-WITH-CAVEAT]

[Si GO : "La stack asyncio + FastMCP performe à la latence cible avec
zéro impact audio. Recommandation d'écrire le plan de migration sur
cette stack exacte. Spécifiquement, lock la version du SDK MCP à X.Y.Z
et vendor les deps de la même façon (pattern `install.sh`). Le pattern
bridge (queue + drain update_display) s'est transposé proprement depuis
l'extension Browser existante et doit être réutilisé."]

[Si NO-GO : "La migration telle que spécifiée n'est pas faisable.
Spécifiquement, <failure>. Recommandation de reconsidérer : (a) split
two-process (serveur MCP Python hors Live, parle TCP à un Remote Script
fin), ou (b) abandonner la migration et adresser les gaps MIDI via des
fixes Max [js]."]

[Si GO-WITH-CAVEAT : "La migration est viable mais nécessite <change>.
Spécifiquement, le SDK a eu <problem> et on a utilisé Fallback A pour
confirmer que le pattern HTTP-in-Live sous-jacent marche. Recommandation
d'implémenter la migration prod avec JSON-RPC manuel (pattern Fallback
A), revisiter le SDK quand la version X.Y sera publiée."]
```

- [ ] **Étape 2 : Commit REPORT.md**

```bash
git add ../results/REPORT.md
git commit -m "proto: REPORT.md — verdict final + table de résultats par scénario"
```

### Tâche 26 : Copier REPORT.md sur main comme spec durable

**Fichiers :**

- Créer sur `main` : `docs/superpowers/specs/YYYY-MM-DD-prototype-http-in-live-report.md`

- [ ] **Étape 1 : Copier + commit sur main**

```bash
TODAY=$(date +%Y-%m-%d)
git checkout main
git pull --ff-only
git show proto/http-in-live:proto/http-in-live/results/REPORT.md > docs/superpowers/specs/${TODAY}-prototype-http-in-live-report.md
git add docs/superpowers/specs/${TODAY}-prototype-http-in-live-report.md
git commit -m "docs: rapport du prototype HTTP-in-Live (référence durable sur main)"
```

- [ ] **Étape 2 : Push main**

```bash
git push origin main
```

### Tâche 27 : Tagger et supprimer la branche proto

**Fichiers :** aucun — opérations git

- [ ] **Étape 1 : Tagger la branche pour la postérité**

```bash
TODAY=$(date +%Y-%m-%d)
git tag proto-archive-${TODAY} proto/http-in-live
git push origin proto-archive-${TODAY}
```

- [ ] **Étape 2 : Supprimer la branche en local et sur le remote**

```bash
git branch -D proto/http-in-live
git push origin --delete proto/http-in-live 2>/dev/null || echo "Remote branch already absent."
```

- [ ] **Étape 3 : Vérifier l'état final**

```bash
git branch | grep -i proto    # doit être vide
git tag | grep proto-archive  # montre le tag d'archive
ls docs/superpowers/specs/*prototype-http-in-live*  # design + report présents sur main
```

### Tâche 28 : Désinstaller le Remote Script proto

**Fichiers :** aucun

- [ ] **Étape 1 : Supprimer le symlink**

```bash
rm "$HOME/Music/Ableton/User Library/Remote Scripts/agent4live_proto"
```

- [ ] **Étape 2 : Reset le slot Control Surface dans Live**

Live → Preferences → Link/Tempo/MIDI → remettre le slot proto sur `None`.

- [ ] **Étape 3 : Optionnellement, retirer le dossier proto du disque local**

La branche est partie mais les fichiers `proto/http-in-live/` peuvent rester dans le working copy. Si main n'a jamais eu ces fichiers (ce qui devrait être le cas), ils disparaissent après `git checkout main`. Sinon :

```bash
rm -rf proto/   # seulement si tu es sûr qu'aucune autre branche proto n'est checkée-out
```

---

## Terminé.

L'unique artefact qui survit est `docs/superpowers/specs/YYYY-MM-DD-prototype-http-in-live-report.md` sur `main`. Le verdict dans ce fichier alimente la décision GO/NO-GO sur l'item de migration backend Node → Python du roadmap.

Si **YES** : la prochaine étape est d'écrire le plan d'implémentation pour la migration elle-même, en commençant par le design spec du Remote Script Python prod-grade.

Si **NO** : la prochaine étape est de mettre à jour l'item roadmap avec les nouvelles contraintes et de designer une alternative (split two-process ou abandon).

Si **MIDDLE/Fallback A** : la prochaine étape est la même que YES mais la stack prod swap le SDK MCP pour le pattern JSON-RPC manuel de `server_sync.py`.
