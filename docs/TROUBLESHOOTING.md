# Troubleshooting

Problèmes courants et leurs causes/solutions. Pour le contexte d'architecture, voir [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

**Erreur 6 au chargement du device** : le header binaire du `.amxd` est désynchronisé. Ouvrir le device dans Max et faire `Cmd+S` pour le réécrire proprement.

**`dist/agent4live.amxd` affiche un fond blanc / jweb vide** : le frozen device est probablement obsolète. Refaire le workflow de build : `npm run build` puis re-Freeze depuis `dist/staging/agent4live.amxd` (voir `ARCHITECTURE.md` → _Générer le fichier de distribution_).

**Port EADDRINUSE** : soit une autre instance d'agent4live tient déjà le port (cas normal du multi-device — la 2e instance passe en mode passif et affiche la card "Duplicate device"), soit un process Node zombie d'une session précédente. Identifier le PID :

```bash
lsof -ti :19845
```

Si c'est un Max/Ableton encore lancé : OK, c'est l'instance active. Sinon (zombie) :

```bash
lsof -ti :19845 | xargs kill -9
```

**`add_clip` retourne une erreur LOM** : vérifier que la piste cible est bien une piste MIDI et que le slot est vide. Les pistes Audio du projet de démo (`1-MIDI`, `2-MIDI`, `3-Audio`, `4-Audio`) ont `is_midi_track: false` malgré leur nom — utiliser `lom_get` pour vérifier.

**Agent non détecté dans l'UI (au boot ou après bouton REFRESH)** : le binaire n'est pas dans les chemins standard. `resolveBin()` tente : `<name>`, `~/.local/bin/<name>`, `/usr/local/bin/<name>`, `/opt/homebrew/bin/<name>`. Ajouter le bon chemin dans le tableau `candidates` de `resolveBin` dans `app/server/discovery.js`.

**La card AGENT du header affiche `● none` après consentement** : tu as décoché le seul agent coché dans le modal — la mutex single-agent retombe sur "aucun agent registered". Re-cliquer sur la card AGENT rouvre le modal pour choisir.

**Le modal de consentement ne s'affiche pas au 1er drop** : la migration silencieuse a vu une entrée localhost déjà présente dans `~/.claude.json` ou `~/.config/opencode/opencode.json` et a adopté le consent automatiquement. Pour forcer le modal : `rm ~/.agent4live-ableton-mcp/preferences.json` puis re-drop.

**La card LIVEAPI reste à `● ---` après le boot** : le boot ping (`lomGet('live_set', 'tempo')` 2s après `listen`) a échoué — soit Max n'avait pas fini de wirer le `[js]` lom_router à temps, soit la LOM a planté. Faire un appel d'agent normal devrait débloquer ; sinon vérifier les logs runtime (`~/.agent4live-ableton-mcp/runtime.log`).

**Les modifications JS ne prennent pas effet** : le device doit être rechargé dans Ableton après chaque sync vers la User Library.

**Mes edits du `[js]` semblent sans effet — l'actif tourne du code stale, malgré `@autowatch 1`** : si tu as cliqué Edit sur le device pour ouvrir Max, **Ableton a créé une 2e instance shadow** du même device qui passe en passif. Cette shadow recharge bien tes edits via `@autowatch`, mais l'instance ACTIVE (celle qui tient le port et reçoit les MCP requests) ne recharge **pas** son [js] tant que la fenêtre Edit reste ouverte. Tous tes tests vont taper le code stale de l'actif. Symptômes : (a) `lom_scan_peers` qui spam la console toutes les 5s avec `jsliveapi: invalid path` (c'est la shadow en passif qui scanne), (b) tes diagnostics `post()` apparaissent en console mais le comportement réel ne change pas. **Fix** : ferme la fenêtre Max Edit (Cmd+W). La shadow disparaît, l'active recharge, tes edits prennent effet.

**`Cannot find module './lom'`** : le bundle esbuild est out-of-date ou la structure `app/server/` est cassée. Vérifier que les modules existent dans `app/server/` et relancer `npm run build`.

**Un device passif reste sur le splash gris au lieu d'afficher la card "Duplicate device"** : le marker est manquant dans le patch. Vérifier via `lom_get` que le device a un paramètre nommé `__agent4live_marker__` dans ses `parameters`. Si non (typique d'un patch ancien sans le marker, ou d'un build dist/ pré-Phase 8), éditer le patch dans Max et ajouter un `live.numbox` avec scripting name `__agent4live_marker__` (Parameter Visibility = `Stored Only`, Type `Int`, Range 0-1, Initial 1) hors zone Presentation.

**Le passif n'auto-takeover pas après que l'actif soit retiré** : le retry-bind tourne toutes les 5s. Attendre jusqu'à 5s après le retrait. Si après 10s+ l'UI passive n'a pas basculé sur l'UI normale, vérifier `~/.agent4live-ableton-mcp/runtime.log` du PID de la passive — il devrait y avoir des entrées "Acquired port — switching from passive to active". Si seulement "Retry bind: still busy", quelqu'un d'autre tient le port (zombie ou autre process).
