# Space Connect

Plateforme de réseau WhatsApp développée par **Asta aka Space aka Kimberly**.

## Stack
- **Backend** : Node.js + Express (port 5000)
- **Frontend** : HTML/CSS/JS statique servi par le backend (`/Frontend`)
- **Base de données** : Supabase (PostgreSQL)
- **Auth** : Google OAuth2 (People API v1)

## Comment lancer l'app

```bash
cd Backend && node server.js
```

Le serveur démarre sur `http://0.0.0.0:5000` et sert le frontend depuis `/Frontend`.

## Variables d'environnement (Replit Secrets)

| Clé | Description |
|-----|-------------|
| `SESSION_SECRET` | Clé de chiffrement AES-256 des tokens OAuth |
| `GOOGLE_CLIENT_SECRET` | Secret OAuth2 Google Cloud Console |
| `SUPABASE_URL` | URL du projet Supabase (env var partagée) |
| `SUPABASE_ANON_KEY` | Clé publique Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé service role Supabase (admin) |

`GOOGLE_CLIENT_ID` est public et configuré dans `Backend/config/googleAuth.js`.

Le `GOOGLE_REDIRECT_URI` est construit **dynamiquement** depuis le host de la requête (`buildRedirectUri(req)`) — pas besoin de valeur fixe.

## Déploiement

Configuré en **autoscale** avec la commande : `node Backend/server.js`

### Avant de déployer, s'assurer que :
1. Le schéma Supabase est appliqué (`Backend/schema.sql` → SQL Editor Supabase)
2. Après le 1er déploiement : ajouter `https://<app>.replit.app/api/auth/google/callback` dans Google Cloud Console → Authorized redirect URIs

## Routes API principales

| Route | Description |
|-------|-------------|
| `GET /api/health` | État du serveur |
| `GET /api/stats` | Statistiques membres (anonymisées) |
| `GET /api/auth/google/url` | URL de connexion Google |
| `GET /api/auth/google/callback` | Callback OAuth2 |
| `POST /api/user/phone` | Enregistrement numéro WhatsApp |
| `GET /api/contacts` | Liste membres actifs |
| `GET /api/contacts/vcf` | Annuaire VCF 3.0 |
| `POST /api/contacts/sync-google` | Sync Google Contacts |
