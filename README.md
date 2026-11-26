# app-status

Toutes les 30 minutes, GitHub Actions lit l'état App Store de **toutes les
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

## Réglages (Settings → Secrets and variables → Actions)

| Secret | Valeur |
|---|---|
| `ASC_ISSUER_ID` | Issuer ID (App Store Connect → Utilisateurs et accès → Intégrations) |
| `ASC_KEY_ID` | Key ID de la clé d'équipe (rôle « Developer » suffit) |
| `ASC_PRIVATE_KEY` | contenu du `.p8` |
| `DISCORD_WEBHOOK_URL` | URL du webhook du salon Discord |

Variable optionnelle `IGNORED_BUNDLE_IDS` (onglet Variables) : bundle ids à
ne pas suivre, séparés par des virgules.

## Utilisation

- **Lancer à la main** : Actions → App status → Run workflow. Le premier
  passage poste le tableau complet.
- `state.json` garde le dernier état connu ; le workflow le commite.
- Tester en local sans poster : `node src/index.mjs --dry-run` (avec les
  variables `ASC_*` dans l'environnement).
- Tests : `npm test`.

## Coût

Gratuit dans les 2 000 minutes Actions mensuelles du plan Free (environ
1 440 min/mois à raison d'un passage toutes les 30 min). Pour suivre plus
souvent, passer le dépôt en public ou sur un plan payant.

## Plus tard

Android (Google Play) : à ajouter avec un compte de service Play ayant accès
à toutes les apps.
