# Notes techniques pour les sessions agent

Détails de référence migrés depuis `.claude/CLAUDE.md` pour garder le fichier d'instructions principal léger. Conventions valables pour Claude Code, Codex CLI, Gemini CLI, OpenCode (ou tout autre agent qui pilote ce repo). À consulter quand on touche aux tests, qu'on prépare un commit, ou qu'on ajoute un outil LOM.

---

## Tests — objectif 100 % de coverage

`npm test` → `jest --coverage` → rapport Istanbul dans `coverage/`. Le seuil est **100 %** sur statements / branches / functions / lines. Toute baisse fait échouer `npm test` (et donc, à terme, le pre-commit hook + la CI).

**~985 tests, ~5s d'exécution.** Couverture 100 % sur tout le code applicatif (`app/lom_router/**`, `app/server/**`, `tools/build/**`, `tools/dev-server/**`).

**Exclusions** : `/* istanbul ignore ... */` ciblé avec commentaire explicatif (jamais d'exclusion globale sans raison). Détails ligne-par-ligne dans `coveragePathIgnorePatterns` de `jest.config.js` + commentaires `istanbul ignore` du code. Cas notable : `app/lom_router.js` (généré par concat) est exclu car la couverture est mesurée sur les sources `app/lom_router/<NN>_<domaine>.js`.

**Workflow** :

1. **Quand lancer les tests** : uniquement **avant un `git commit`** (le pre-commit hook les rejoue de toute façon, donc autant les passer manuellement à ce moment-là pour itérer plus vite). Pas besoin de `npm test` après chaque petit changement intermédiaire — ça fait perdre du temps en cycle de dev. Idem pendant un chantier multi-étapes : on code, on commit à la fin, et c'est là qu'on s'assure que le 100 % tient.
2. `npm test` lance les tests + génère le rapport. Si on est à 99.9 %, le test fail.
3. Pour savoir **quoi tester ensuite**, ouvrir `coverage/lcov-report/index.html` (rapport Istanbul navigable) ou regarder la sortie texte de `npm test` — colonnes `% Stmts` / `Uncovered Line #s`.
4. Pour exclure une nouvelle ligne/branche : préférer un `/* istanbul ignore ... */` ciblé avec **commentaire explicatif** plutôt qu'une exclusion globale dans `jest.config.js`.
5. Tests co-localisés : `app/server/lom/queue.js` ↔ `app/server/lom/queue.test.js`. Pattern : `jest.mock('max-api')` au top, puis `describe`/`it`/`expect`.

**Conventions** :

- Modules runtime-only (max-api) sont redirigés via `moduleNameMapper` vers `tools/test/max-api-stub.js`.
- Globals Max [js] (`LiveAPI`/`Dict`/`Task`/`outlet`/`post`/`messnamed`/...) sont injectés via `setupFiles: tools/test/max-runtime-stubs.js`.
- HTML loaded via `require('./xxx.html')` est transformé par `tools/build/jest-html-transformer.js`.
- Chaque tool MCP doit avoir au minimum : test que sa `description` est non-vide, que son `schema` valide les inputs attendus, et que son `handler` délègue au bon `lom*` helper avec les bons args.

---

## Commit messages — pièges commitlint à éviter

Le pre-commit hook fait passer `@commitlint/config-conventional` sur le message. Quelques motifs du body sont silencieusement parsés comme **footers GitHub** et déclenchent le warning `footer-leading-blank` même quand on est sûr d'avoir mis la ligne vide au bon endroit. À éviter dans le body :

| Motif piégeux                                                                       | Pourquoi                                          | Workaround                                                                                                            |
| ----------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `WORD #digits` (ex. `gris #555`, `voir #42`)                                        | Match `Refs #123` / `Closes #42` (footer GitHub)  | Wrapper en backticks (`` `#555` ``) ou reformuler (`gris foncé`)                                                      |
| `WORD :` avec espace avant `:` (style typographie française)                        | Peut être lu comme un token footer `Token: Value` | Remplacer par `—` (em-dash) ou retirer l'espace                                                                       |
| Plusieurs paragraphes du body séparés par lignes vides + `Co-Authored-By:` à la fin | Le parser peut ambiguïser le footer               | Toujours **une seule ligne vide** entre le dernier paragraphe et le footer ; jamais de double ligne vide dans le body |

**Debug rapide** (sans recommit) : `git log -1 --format=%B HEAD \| npx commitlint` re-joue commitlint sur le dernier commit et affiche le warning précis. Pratique pour itérer sur le format avant un `git commit --amend`.

**Pourquoi c'est subtil** : conventional-commits-parser utilise une regex permissive pour détecter les footers. Le warning n'est pas bloquant (level 1) mais pollue l'historique CI / les outils qui analysent les messages. Le faux positif le plus fréquent est le `#` collé à un mot — typiquement les couleurs hex CSS dans les commits qui touchent l'UI.

---

## Documentation Max 9 (locale, optionnelle)

Si `~/dev/Ableton/max9-docs/corpus/` existe sur la machine, il contient la doc officielle Cycling '74 (LOM, Node for Max API, JS API) en Markdown grep-able :

- `corpus/lom/<class>.md` — un fichier par classe LOM (`track.md`, `clip.md`, `clip_slot.md`, `device.md`, `song.md`...)
- `corpus/js-api/<kind>_<name>.md` — un fichier par entité JS (`class_live_api.md`, `class_dict.md`, `function_post.md`...)
- `corpus/node-for-max.md` — single file
- `corpus/lom/_index.md` et `corpus/js-api/_index.md` — index des fichiers

**Quand l'utiliser** : avant d'ajouter ou modifier un outil LOM, pour vérifier les propriétés/méthodes exactes d'un objet (Track, Clip, ClipSlot...), la signature d'une méthode (paramètres, types, dict spec), ou l'API LiveAPI côté JS.

**Comment chercher** : `Grep` ou `Read` direct. Exemples :

- `grep -A 8 "^## add_new_notes" ~/dev/Ableton/max9-docs/corpus/lom/clip.md`
- `grep -lr "is_playing" ~/dev/Ableton/max9-docs/corpus/lom/`
- `cat ~/dev/Ableton/max9-docs/corpus/js-api/class_live_api.md`

Voir `~/dev/Ableton/max9-docs/README.md` pour la régénération du corpus.
