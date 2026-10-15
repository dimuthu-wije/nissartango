# Éprouver le parcours organisateur, de bout en bout

Écrit le 2026-10-15, en français comme `GUIDE-admin.md` et `editor/public/aide/`,
pour la même raison : c'est un document d'exploitation, pas une passation.

**Cette passe se fait en PRODUCTION**, parce que c'est le seul endroit où le
site se reconstruit et où la file d'attente est réelle. Tout ce qu'elle crée est
supprimé à l'étape 10, et l'état d'avant est sauvegardé à l'étape 0.

---

## Ce qui est déjà vrai avant de commencer

Mesuré le 2026-10-15 sur `eqcgeqzzuzcwrflwasjo` :

| | |
|---|---|
| événements | 2, tous deux `approved` |
| organisateurs | Rosa Gervasi, El Gato Tanguero, Nissartango |
| comptes | `dimuthu.wije@outlook.com` (admin, membre des trois), `d.wijegun@gmail.com` (propriétaire d'El Gato Tanguero) |

**Vous avez donc déjà un second compte qui joue un organisateur.** Il date du
test de lien magique du 2026-09-21. Deux options :

- **le réutiliser** — plus rapide, et les étapes 1 et 2 sautent ;
- **en inviter un nouveau** — teste aussi l'invitation, qui est la partie du
  parcours qu'un vrai organisateur rencontrera en premier et la seule que vous
  n'avez jamais rejouée.

La procédure ci-dessous invite un nouveau compte, parce que c'est la version
complète. Si vous réutilisez le gmail, passez à l'étape 3.

---

## 0. Enregistrer l'état d'avant

Déjà fait : `Claude outputs/prod-backup-<horodatage>.json` contient les
événements, exceptions, organisateurs, membres, rôles et comptes. `Claude
outputs/` est gitignoré, donc rien n'en part dans git.

Sans cette sauvegarde, l'étape 10 n'a pas de retour en arrière. Ne la sautez pas
si vous rejouez cette procédure plus tard.

---

## 1. Inviter le faux organisateur

**Tableau de bord Supabase → Authentication → Users → Invite user**, avec une
adresse qui n'est ni la vôtre ni `contact@`.

**Impossible depuis l'éditeur, et c'est voulu.** `requestLink()` dans
`editor/public/auth.js` envoie `create_user: false`, donc demander un lien avec
une adresse inconnue est refusé. Son commentaire dit pourquoi : une inscription
est une décision avec une conséquence de modération, et elle n'a pas sa place
derrière un champ e-mail sur une page que n'importe qui peut ouvrir.

**À vérifier** : la personne reçoit l'invitation. Si elle n'arrive pas, c'est
Resend qu'il faut regarder — son quota gratuit est désormais partagé entre les
liens magiques et vos réponses depuis `contact@`.

---

## 2. Le rattacher à un organisateur

**editor.nissartango.fr → Organisateur → El Gato Tanguero → Membres → ajouter
par e-mail**, en **Éditeur**.

Pourquoi Éditeur et pas Propriétaire : un éditeur crée et modifie les événements
de cet organisateur, ce qui est exactement ce qu'on teste. Propriétaire ajoute
le droit de modifier la fiche et de gérer les membres — utile pour un vrai
organisateur extérieur, inutile ici.

**Si vous le faites avant l'étape 1**, le formulaire répond `NT006` et vous dit
nommément qu'il n'y a pas de compte pour cette adresse, au lieu d'échouer
vaguement. C'est un cas qui mérite d'être vu une fois : faites-le exprès.

---

## 3. Se connecter en tant que lui

**Dans une fenêtre de navigation privée**, ou un autre navigateur. Pas le vôtre
avec votre session admin dessus : vous testeriez vos propres droits sans le
savoir, et c'est l'erreur qui rend ce genre de test inutile.

1. `editor.nissartango.fr` → l'adresse invitée → **Envoyez-moi un lien**
2. ouvrir le lien **dans la même fenêtre**, tout de suite

Trois choses à savoir, elles sont dans l'aide et elles expliquent presque toutes
les pannes de connexion : le lien ne sert **qu'une fois**, il vaut **une heure**,
et il doit être ouvert **dans le navigateur qui l'a demandé**.

**À vérifier** : la page affiche l'espace éditeur, et **pas** le lien vers la
file d'attente. La file est masquée pour tout le monde sauf l'admin.

---

## 4. Créer un événement

En tant que l'organisateur simulé, remplir le formulaire. Prenez une date
**dans les 7 prochains jours** : c'est ce qui le fera apparaître dans la
première section du site plutôt que dans les cartes, et c'est la section que
vous regarderez à l'étape 6.

Mettez-y de quoi exercer les cas qui ont déjà cassé :

- plusieurs **formats** (Cours + Practica), pour la ligne d'en-tête
- un **tarif** avec note, pour `priceSummary()`
- une **description** avec un titre, une liste et du gras, pour `.prose`
- si possible un **visuel** : c'est la seule chose que le jeu d'essai local ne
  peut pas prouver, parce qu'il lui manque les octets derrière `image_path`

**À vérifier** : l'événement est enregistré en **`pending`**. Il n'y a pas de
champ statut dans le formulaire, et la politique d'insertion exige `pending` —
c'est la file d'attente qui publie, jamais le formulaire.

```bash
./scripts/check-db.sh   # ou, directement :
psql "$PROD_DB_URL" -At -c "select status, slug from public.events order by created_at desc limit 3;"
```

---

## 5. La file d'attente

Revenez dans **votre** navigateur, en admin : `editor.nissartango.fr/queue/`.

L'événement doit y être. Les trois boutons, et c'est le deuxième qui demande de
l'attention :

| bouton | effet |
|---|---|
| **Approuver** | publie ; il arrive sur le site à la reconstruction suivante |
| **Rejeter** | exige un motif. Sur un événement **déjà en ligne**, s'intitule « Rejeter (retirer du site) » et retire l'événement **entier** — toutes ses dates |
| **Marquer comme revu** | efface le drapeau, ne change rien d'autre |

Rien n'est jamais supprimé par ces boutons : un événement rejeté peut être
approuvé à nouveau.

---

## 6. Approuver, puis regarder le site

Approuvez. Puis attendez la reconstruction.

**Le poller compare les empreintes toutes les dix minutes** et déclenche le
hook de déploiement quand le contenu a bougé. Ce n'est pas une poussée git et ce
n'est pas filtré par les chemins de build.

**Ne croyez pas un déploiement sur parole.** Le reçu est servi par le site, et
la seule mesure concluante est que `built_at` ait **avancé** :

```bash
curl -s -H 'Cache-Control: no-cache' https://nissartango.fr/build-info.json | python3 -m json.tool
```

Toute la valeur du test tient dans l'asymétrie : un cache périmé ne peut rendre
qu'un horodatage **plus ancien**, jamais plus récent. Un déplacement prouve ;
une absence de déplacement ne prouve rien.

Regardez aussi `counts.events` : il doit être passé de 2 à 3.

**À vérifier sur la page** : l'événement est dans « Les 7 prochains jours »,
avec sa date, son ou ses formats, le lieu, et l'organisateur. Ouvrez sa page :
la date, le lieu, le tarif et l'organisateur s'y lisent sans étiquettes, en
gros, et le visuel — s'il y en a un — tient dans la hauteur de la fenêtre.

---

## 7. Modifier, et le drapeau

En tant qu'organisateur, corrigez quelque chose — le titre, l'heure.

**L'événement reste en ligne pendant qu'il vous attend.** Vous relisez un
changement déjà parti ; vous ne le bloquez pas.

Côté admin, il réapparaît dans la file, signalé. **« Marquer comme revu »** est
le bon bouton. « Rejeter » retirerait l'événement du site — c'est la confusion
qui coûte cher, et c'est pour la rencontrer une fois en sécurité que cette
étape existe.

---

## 8. Annuler une date

Toujours en organisateur, annulez **une occurrence** si l'événement se répète,
ou l'événement entier sinon, avec un motif.

**À vérifier après la reconstruction** : la date annulée apparaît dans l'agenda
barrée, avec le motif. C'est délibéré et c'est même le cœur du découpage en deux
sections — « pas de milonga ce jeudi » est la phrase la plus utile que l'agenda
puisse porter sur un régulier, et replier la série fait de l'exception la seule
fois où cet événement apparaît chronologiquement.

---

## 9. Les cas d'erreur, pendant que c'est sûr

Trois à provoquer exprès, parce qu'ils sont dans l'aide et qu'un organisateur
les rencontrera :

| provoquer | message attendu |
|---|---|
| demander un lien avec une adresse jamais invitée | `Signups not allowed for otp` |
| ajouter un membre par une adresse sans compte | `NT006`, nommément |
| se connecter avec un compte rattaché à rien | « Vous n'êtes membre d'aucun organisateur » |
| rouvrir un lien magique déjà utilisé | « Ce lien n'a pas fonctionné » |

L'aide les explique tous, et donne `contact@nissartango.fr` comme recours —
c'est le texte que vous venez de déployer, et le voir en situation est la
meilleure relecture possible.

---

## 10. Tout supprimer

**Irréversible.** La sauvegarde de l'étape 0 est le seul retour en arrière.

L'ordre compte, et pas pour la raison qu'on croit. Mesuré sur ce schéma :

```
event_exceptions.event_id  -> events       CASCADE
organizer_members.user_id  -> auth.users   CASCADE
user_roles.user_id         -> auth.users   CASCADE
events.created_by          -> auth.users   SET NULL   <-- celle qui surprend
```

Supprimer le compte de test **ne supprime pas ses événements** : `created_by`
passe simplement à NULL et les événements restent. Les deux suppressions sont
indépendantes et il faut les faire toutes les deux.

**Les événements**, en SQL — l'éditeur refuse de supprimer un événement publié,
parce que son lien permanent a pu être partagé :

```sql
-- les exceptions partent en cascade
delete from public.events;
select count(*) as events from public.events;            -- 0
select count(*) as exceptions from public.event_exceptions;  -- 0
```

**Le compte de test**, depuis le tableau de bord → Authentication → Users →
Delete user. Ses `organizer_members` et son éventuel `user_roles` partent en
cascade.

**À conserver** : les trois organisateurs, votre compte admin, et
`d.wijegun@gmail.com` si vous comptez vous en reservir.

**Vérifier :**

```bash
psql "$PROD_DB_URL" -At -F' | ' -c "
select 'events', count(*) from public.events
union all select 'exceptions', count(*) from public.event_exceptions
union all select 'organizers', count(*) from public.organizers
union all select 'members', count(*) from public.organizer_members
union all select 'auth users', count(*) from auth.users;"
```

---

## 11. Le déploiement final

La suppression fait bouger l'empreinte du contenu, donc le poller reconstruira
tout seul dans les dix minutes. Vous pouvez attendre, ou forcer.

**À vérifier :**

```bash
curl -s -H 'Cache-Control: no-cache' https://nissartango.fr/build-info.json | python3 -m json.tool
```

`counts.events` doit être **0**, et `built_at` avoir avancé.

Sur la page, l'agenda affiche alors **« Aucun événement à venir pour le
moment. »** — c'est l'état vide, écrit exprès et jamais vu en production
jusqu'ici. C'est aussi, accessoirement, la dernière chose que cette procédure
teste.

**Un échec de construction ne met pas le site hors ligne** : Cloudflare garde le
dernier déploiement valide, donc le site paraîtrait normal pendant que les
changements cessent d'arriver. `workers/build-notifier/` envoie un courriel en
cas d'échec, et uniquement en cas d'échec — mais une absence de courrier n'est
pas une preuve de santé. C'est `built_at` qui tranche.

---

## Ce que cette procédure ne teste pas

À dire franchement, pour que personne ne croie le contraire plus tard :

- **La délivrabilité réelle** vers autre chose que vos propres boîtes. Les
  en-têtes du 2026-09-21 montrent `dkim=pass header.d=nissartango.fr`, ce qui
  est la bonne preuve, mais sur un seul destinataire.
- **Le quota Resend sous charge.** Il est partagé entre les liens magiques et
  vos réponses depuis `contact@` depuis le 2026-10-15. Si des connexions
  commencent à échouer en silence, c'est le premier endroit à regarder.
- **Un vrai organisateur.** Vous jouez les deux rôles, donc vous savez où
  cliquer. C'est précisément ce que le test ne peut pas mesurer, et la seule
  façon de le savoir est d'inviter El Gato Tanguero et Rosa Gervasi pour de bon.
