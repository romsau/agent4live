# S5 — Script de session real-client Claude Code

## Setup

1. Vérifier que le Remote Script proto est chargé dans Live (Phase 6 Tâche 11).
2. Configurer Claude Code pour utiliser le serveur proto :
   ```bash
   claude mcp add agent4live-proto --transport http http://127.0.0.1:19846/mcp
   ```
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

```json
{
  "scenario": "S5",
  "timestamp": "...",
  "claude_code_version": "...",
  "prompts_passed": 5,
  "prompts_failed": 0,
  "notes": "Anything surprising"
}
```
