# app-status

Toutes les 5 minutes, GitHub Actions lit l'état App Store de **toutes les
apps du compte Les Ignobles** et poste sur Discord dès que l'une d'elles change
de statut (envoyée en review, en review, validée, rejetée, en ligne…), avec le
tableau de toutes les apps. Une nouvelle app du compte est prise en compte
toute seule.

```
🔵 Parkeur passe en review
iOS 1.1.53 (270) · Waiting for review → In review
━━━━━━━━━━━━━━━━━━
📱 État des apps
🟢 Kut — iOS 1.1.0 en ligne · 🟡 1.2.0 en attente de review
🟢 Nimble — iOS 2.0.3 en ligne
🟢 Parkeur — iOS 1.1.51 en ligne · 🔵 1.1.53 en review
Mis à jour à 14:32
```

## Apps suivies : `apps.json`

- `internal` : apps du compte Les Ignobles, par id App Store Connect, avec
  leur **nom court** affiché. Une app du compte absente de la liste apparaît
  avec son nom App Store complet (à ajouter ici pour la renommer).
- `external` : apps d'autres comptes, par `appStoreId` (l'id dans l'URL
  `apps.apple.com/.../idXXXX`). Seule la **version en ligne** est connue
  (App Store public) : message quand une nouvelle version sort. Pour les
  statuts de review, il faudrait une clé App Store Connect de leur compte.
- `ignored` : ids ou débuts de nom à ne jamais afficher (la variable GitHub
  `IGNORED_APPS` s'y ajoute).

## Réglages (Settings → Secrets and variables → Actions)

| Secret | Valeur |
|---|---|
| `ASC_ISSUER_ID` | Issuer ID (App Store Connect → Utilisateurs et accès → Intégrations) |
| `ASC_KEY_ID` | Key ID de la clé d'équipe (rôle « Developer » suffit) |
| `ASC_PRIVATE_KEY` | contenu du `.p8` |
| `DISCORD_WEBHOOK_URL` | URL du webhook du salon Discord |

Variable optionnelle `IGNORED_APPS` (onglet Variables) : exclusions en plus
de celles d'`apps.json`, séparées par des virgules.

## Utilisation

- **Lancer à la main** : Actions → App status → Run workflow. Le premier
  passage poste le tableau complet.
- `state.json` garde le dernier état connu ; le workflow le commite.
- Tester en local sans poster : `node src/index.mjs --dry-run` (avec les
  variables `ASC_*` dans l'environnement).
- Tests : `npm test`.

## Déclenchement toutes les 5 min : cron-job.org

Le cron de GitHub saute la plupart des passages (2 en 12 h observés). Un job
cron-job.org (« Cron App Status Les Ignobles ») lance donc le workflow toutes
les 5 min : `POST https://api.github.com/repos/Les-Ignobles/app-status/actions/workflows/app-status.yml/dispatches`,
corps `{"ref":"main"}`, en-têtes `Authorization: Bearer <token>`,
`Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`.
Réponse attendue : 204.

- Token : fine-grained, dépôt `app-status` seul, permission « Actions :
  lecture et écriture ». **Expire le 28/11/2027** : le recréer avant et le
  remplacer dans cron-job.org.
- La version d'API `2022-11-28` est arrêtée par GitHub le 10/03/2028 : passer
  à la suivante d'ici là.
- Le cron GitHub reste en secours ; un seul passage à la fois, et sans
  changement rien n'est posté, donc les doublons sont sans effet.

## Coût et fréquence

Dépôt **public** : minutes GitHub Actions illimitées, d'où un passage toutes
les 5 min (le minimum de GitHub, qui peut décaler ou sauter des passages).
Seuls `apps.json` et `state.json` sont visibles (noms et versions, déjà
publics sur l'App Store) ; les clés restent des secrets. Sans changement
pendant 50 jours, le workflow pousse un commit vide pour que GitHub ne
suspende pas le cron.

## Plus tard

Android (Google Play) : à ajouter avec un compte de service Play ayant accès
à toutes les apps.
