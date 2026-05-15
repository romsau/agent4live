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

```bash
./install.sh
```

Le script symlinke `remote_script/agent4live_proto/` dans
`~/Music/Ableton/User Library/Remote Scripts/agent4live_proto/`.

Ensuite dans Live : **Preferences → Link/Tempo/MIDI**, sélectionne
`agent4live_proto` dans un **slot différent** de celui du prod
`agent4live` (les deux peuvent tourner en parallèle — prod sur :19845,
proto sur :19846).

## Lancer un scénario

```bash
cd load_test
python run_scenario.py s1   # latence isolée (1000 calls)
python run_scenario.py s2   # burst 50 req/s × 5 min, nécessite reference.als chargé
python run_scenario.py s3   # endurance 12h
# S4, S5, S6 sont partiellement manuels — voir load_test/claude_code_session.md
```

Chaque run écrit `results/run_NNN.json`.

## Désinstall

```bash
rm ~/Music/Ableton/User\ Library/Remote\ Scripts/agent4live_proto
```

Puis dans Live → Preferences → Link/Tempo/MIDI, remets le slot proto sur `None`.
