# 🚀 Space Connect - Backend API (Supabase & Google Contacts)

Développé par **Asta aka Space aka Kimberly**

Ce dossier contient l'API Backend pour **Space Connect**, gérant l'intégration avec **Supabase** pour la base de données PostgreSQL en temps réel et l'API **Google Contacts (People API v1)** pour la synchronisation automatique des numéros WhatsApp des membres.

---

## 🛠️ Configuration & Clé Google Contacts

La clé **Google Client ID** officielle fournie pour Space Connect a été configurée dans le fichier `.env` :
```env
GOOGLE_CLIENT_ID=644577029504-oe8g04ksr5q811mti7cntmmbudst056i.apps.googleusercontent.com
```

---

## 📁 Architecture du Backend

```
Backend/
├── config/
│   ├── googleAuth.js          # Client OAuth2 & Scopes Google Contacts
│   └── supabase.js            # Initialisation Client Supabase
├── routes/
│   ├── authRoutes.js          # Inscription & Authentification Google OAuth2
│   ├── userRoutes.js            # Enregistrement du numéro WhatsApp dans Supabase
│   └── contactsRoutes.js      # Annuaire VCF 3.0 & Synchro Google Contacts API
├── services/
│   └── googleContactsService.js # Logique d'interconnexion Google People API (v1)
├── schema.sql                 # Script SQL pour Supabase SQL Editor
├── .env                       # Variables d'environnement
├── .env.example               # Modèle de configuration
├── package.json               # Dépendances Node.js
├── README.md                  # Documentation backend
└── server.js                  # Serveur principal Express (Port 5000)
```

---

## ⚡ Démarrage Rapide

### 1. Installation des Dépendances
Dans votre terminal, naviguez dans le dossier `Backend` et installez les packages :
```bash
npm install
```

### 2. Configuration Supabase (Base de Données)
1. Rendez-vous sur votre console **Supabase** ([supabase.com](https://supabase.com)).
2. Ouvrez l'éditeur SQL (**SQL Editor**).
3. Copiez-collez le contenu de `Backend/schema.sql` et exécutez-le pour créer automatiquement les tables `profiles`, `contacts`, `sync_logs` ainsi que les règles RLS.
4. Récupérez vos clés `SUPABASE_URL` et `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` et collez-les dans le fichier `Backend/.env`.

### 3. Lancement du Serveur
```bash
# Mode Production
npm start

# Mode Développement (Redémarrage automatique)
npm run dev
```

Le serveur sera accessible sur `http://localhost:5000`.

---

## 🔌 Routes API Principales

- `GET /api/health` : État de santé et vérification de la clé Google Client ID.
- `GET /api/auth/google/url` : Génère l'URL d'autorisation Google Contacts.
- `GET /api/auth/google/callback` : Reçoit le code OAuth2 et crée/met à jour le profil dans Supabase.
- `POST /api/user/phone` : Enregistre le numéro WhatsApp dans la base Supabase.
- `GET /api/contacts` : Récupère la liste de tous les membres actifs.
- `GET /api/contacts/vcf` : Télécharge l'annuaire au format VCF 3.0.
- `POST /api/contacts/sync-google` : Déclenche la synchronisation automatique des contacts dans le compte Google de l'utilisateur.
