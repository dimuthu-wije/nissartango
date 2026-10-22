# Éprouver le parcours organisateur, de bout en bout

Écrit le 2026-10-15, en français comme `GUIDE-admin.md` et `editor/public/aide/`,
pour la même raison : c'est un document d'exploitation, pas une passation.

**Cette passe se fait en PRODUCTION**, parce que c'est le seul endroit où le
site se reconstruit et où la file d'attente est réelle. Tout ce qu'elle crée est
supprimé à l'étape 11, et l'état d'avant est sauvegardé à l'étape 0.

---

## Ce qui est déjà vrai avant de commencer

**RE-MESUREZ AVANT DE COMMENCER.** Ce tableau a dit « 2 événements, tous deux
`approved` » pendant six jours après qu'ils ont été supprimés, et l'étape 7
demandait de voir `counts.events` passer « de 2 à 3 » alors qu'il partait de 0.
Des nombres écrits dans un document de test périment sans prévenir, et personne
ne les relit avant de s'en servir — ce sont eux qu'on relit APRÈS, quand le
résultat ne correspond pas.

```bash
node scripts/fetch-content.mjs && python3 -c "
import json; d=json.load(open('data/snapshot.json'))
print(d['project_ref'], d['counts'])"
```

Ça lit la production directement et ne dépend d'aucun onglet ouvert au bon
endroit. Notez les nombres de départ : l'étape 7 et l'étape 12 s'y réfèrent.

État le 2026-10-22 sur `eqcgeqzzuzcwrflwasjo`, à titre d'exemple de ce que la
commande rend — pas de valeur à réutiliser :

    {'events': 0, 'organizers': 1, 'exceptions': 0}
    Nissartango | nissartango | 9ce3802d-98bc-493c-8bd7-a42b61e71943

**IL VOUS FAUT UNE SECONDE ADRESSE**, sur une boîte que vous pouvez ouvrir dans
un AUTRE navigateur que celui où tourne votre session d'administrateur. Pas un
autre onglet : avec votre session admin dans la même fenêtre, vous exerceriez
vos propres droits sans vous en apercevoir, et c'est ce qui rend ce genre de
test inutile.

La procédure crée un compte neuf à chaque passe plutôt que d'en réutiliser un.
C'est deux minutes de plus et ça teste la seule partie du parcours qu'un vrai
organisateur rencontre en premier.

---

## 0. Enregistrer l'état d'avant

**Faites-la maintenant, à chaque passe.** Ce paragraphe a dit « déjà fait »
jusqu'au 2026-10-21, ce qui n'était vrai que de la passe du 2026-10-15 : qui
rejouait la procédure lisait qu'il avait une sauvegarde qu'il n'avait pas, sur
un document dont l'étape 11 est irréversible.

Le fichier va dans `Claude outputs/prod-backup-<horodatage>.json` — événements,
exceptions, organisateurs, membres, rôles et comptes. `Claude outputs/` est
gitignoré, donc rien n'en part dans git.

Sans cette sauvegarde, l'étape 11 n'a pas de retour en arrière.

---

## 1. Créer la fiche, AVANT le compte

La fiche n'a besoin de personne ; l'appartenance a besoin des deux. C'est tout
ce qui dicte l'ordre. Une seule requête, seule dans l'éditeur SQL :

```sql
insert into public.organizers (name, slug)
values ('Ka & Jeff', 'ka-et-jeff')
returning id, name, slug;
```

**Un `INSERT … RETURNING` montre toujours sa ligne**, contrairement au `DELETE`
de l'étape 11 : ici, « aucune sortie » serait un vrai échec et non une
ambiguïté. Notez l'`id` : l'étape 3 travaille par le slug et n'en a pas
besoin, mais c'est lui qui ouvre la fiche par URL,
`/organizer/?id=<uuid>`, et vous en aurez besoin le jour où vous devrez
l'administrer sans en être membre.

`name` et `slug` suffisent, et **laissez tout le reste vide EXPRÈS** : c'est ce
qui rend l'étape 5 utile. Une fiche vide déclenche une bannière rouge sur le
formulaire d'événement, et le but est de voir l'organisateur la rencontrer et la
remplir lui-même.

Le slug est définitif et la base impose sa forme — `slug text not null unique
check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')`, lu dans `20260828181100` plutôt que
de mémoire. Postgres nomme cette contrainte `organizers_slug_check`.

**Vérifier, sans passer par le tableau de bord :**

```bash
node scripts/fetch-content.mjs && python3 -c "
import json; d=json.load(open('data/snapshot.json'))
print(d['project_ref'], d['counts'])
for o in d['organizers']: print(' ', o['name'], '|', o['slug'], '|', o['id'])"
```

Ça lit la production par l'API et ne dépend d'aucun onglet ouvert au bon
endroit. C'est ainsi qu'on a vu, le 2026-10-22, que le nom saisi était
« Ka & Jeff » et non « Ka et Jeff ».

---

## 2. Créer le compte — confirmation automatique DÉCOCHÉE

**Tableau de bord → Authentication → Users → Add user → « Create new user ».**
Pas « Send invitation ».

Vérifiez d'abord que l'URL porte `eqcgeqzzuzcwrflwasjo`.

| champ | quoi mettre |
|---|---|
| e-mail | l'adresse de la personne |
| mot de passe | jetable — elle se connecte par lien |
| **Auto Confirm User** | **laisser décoché** |

**Décoché, et c'est contre-intuitif** : un compte déjà confirmé n'a plus rien à
confirmer, donc « Send confirmation email » n'apparaît plus pour lui — et c'est
cette action qui porte le courriel français de l'étape 4. La case fait gagner
une seconde et coûte la notification.

**À vérifier** : le compte apparaît dans la liste, et **aucun courriel ne
part**. Réception ET indésirables.

---

## 3. Rattacher la personne, en propriétaire

En SQL. L'éditeur sait le faire aussi — `add_organizer_member` autorise
`is_owner OR is_admin` — mais sa fiche n'apparaîtra pas dans votre liste
« Organisateur », il faudrait passer par `/organizer/?id=<uuid>`, et en SQL on
voit la ligne écrite.

```sql
insert into public.organizer_members (organizer_id, user_id, role)
select o.id, u.id, 'owner'
from public.organizers o, auth.users u
where o.slug = 'ka-et-jeff'
  and u.email = 'adresse@exemple.fr'
returning organizer_id, user_id, role;
```

**`owner`, pas `editor`** : la personne TIENT cette fiche. Elle modifiera ses
liens et ajoutera ses collègues sans repasser par vous.

**ZÉRO LIGNE VEUT DIRE QUE LE `select` N'A RIEN TROUVÉ** — un slug ou une
adresse qui ne correspond pas — et non que l'insertion a échoué. C'est la seule
façon dont cette requête échoue en silence.

Le compte est encore NON confirmé à cet instant, et ça n'a aucune importance :
`add_organizer_member` et cette requête cherchent l'adresse dans `auth.users` et
ne regardent jamais l'état de confirmation.

**À vérifier :**

```sql
select o.name, o.slug, u.email, m.role
from public.organizer_members m
join public.organizers o on o.id = m.organizer_id
join auth.users u on u.id = m.user_id
where o.slug = 'ka-et-jeff';
```

Une ligne, `owner`, la bonne adresse.

---

## 4. Envoyer le courriel d'activation, et arriver

**Tableau de bord → Authentication → Users → sa ligne → « Send confirmation
email ».**

C'est le seul courriel que la personne reçoit, et c'est le dernier geste :
fiche, compte et appartenance existent déjà, donc le lien marche du premier
coup.

**À vérifier dans sa boîte** : le message est **en français** — modèle *Confirm
signup*, `PROJECT_SETUP.md` §2 — et **le lien est visible sans déplier**. Les
deux ont échoué le 2026-10-22 : le modèle était encore le défaut anglais de
Supabase, et Gmail repliait le corps dans « Contenu abrégé » parce que chaque
envoi produisait exactement les mêmes octets. L'adresse brute imprimée sous le
bouton porte un jeton unique, donc elle suffit à rendre chaque message
différent.

Puis, **dans un AUTRE navigateur** ou une fenêtre privée — pas un autre onglet,
votre session d'administrateur ne doit pas être dedans —, cliquer le lien.

**À vérifier** : il arrive directement sur le **formulaire d'événement**, sa
fiche déjà sélectionnable, et une **bannière rouge** disant que sa fiche est
vide. Pas sur le panneau `user id (sub)` / `issued` / `expires`, qui est
l'instrument d'un mainteneur.

**CES DEUX-LÀ ONT ÉTÉ CASSÉS LE 2026-10-22**, et c'est la raison de ne pas
survoler cette vérification :

- une arrivée par lien ne s'enregistrait nulle part. `store()` était privé dans
  `auth.js` et seul l'échange PKCE l'atteignait, donc la page peignait
  l'identité DU LIEN pendant que chaque requête partait au nom de ce que
  `localStorage` contenait encore — une session d'un tour précédent. Le panneau
  masquait parfaitement le défaut : il décode le jeton qu'on lui donne, donc il
  affichait toujours la bonne adresse ;
- et une arrivée par lien s'arrêtait sur ce panneau au lieu de filer sur
  `/event/`, alors qu'une connexion par le formulaire y allait.

**S'il tombe sur « Votre accès est en préparation »**, l'appartenance de
l'étape 3 n'a pas été écrite. Cette page est un filet, pas une étape.

### Facultatif : voir le filet

Pour regarder la page d'attente, refaites une passe en envoyant le courriel de
l'étape 4 AVANT l'étape 3. C'est la fenêtre que cette page couvre, et dans
l'ordre correct elle ne se présente jamais.

---

## 5. Créer un événement

En tant que l'organisateur simulé, remplir le formulaire. Prenez une date
**dans les 7 prochains jours** : c'est ce qui le fera apparaître dans la
première section du site plutôt que dans les cartes, et c'est la section que
vous regarderez à l'étape 7.

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
psql "$PROD_DB_URL" -At -c "select status, slug from public.events order by created_at desc limit 3;"
```

**Pas `./scripts/check-db.sh`**, que ce passage proposait jusqu'au 2026-10-21
comme s'il répondait à la question. Il ne regarde jamais `public.events` : c'est
un audit en lecture seule des droits et du RLS (`supabase/tests/grants_check.sql`).
Utile, et sans rapport avec le statut d'un événement.

---

## 6. La file d'attente

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

## 7. Approuver, puis regarder le site

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

Regardez aussi `counts.events` : il doit avoir augmenté de un par rapport au
nombre relevé en tête de ce document. Pas « de 2 à 3 » — c'est ce que cette
ligne disait, et elle a survécu de six jours aux deux événements qu'elle
comptait.

**À vérifier sur la page** : l'événement est dans « Les 7 prochains jours »,
avec sa date, son ou ses formats, le lieu, et l'organisateur. Ouvrez sa page :
la date, le lieu, le tarif et l'organisateur s'y lisent sans étiquettes, en
gros, et le visuel — s'il y en a un — tient dans la hauteur de la fenêtre.

---

## 8. Modifier, et le drapeau

En tant qu'organisateur, corrigez quelque chose — le titre, l'heure.

**L'événement reste en ligne pendant qu'il vous attend.** Vous relisez un
changement déjà parti ; vous ne le bloquez pas.

Côté admin, il réapparaît dans la file, signalé. **« Marquer comme revu »** est
le bon bouton. « Rejeter » retirerait l'événement du site — c'est la confusion
qui coûte cher, et c'est pour la rencontrer une fois en sécurité que cette
étape existe.

---

## 9. Annuler une date

Toujours en organisateur, annulez **une occurrence** si l'événement se répète,
ou l'événement entier sinon, avec un motif.

**À vérifier après la reconstruction** : la date annulée apparaît dans l'agenda
barrée, avec le motif. C'est délibéré et c'est même le cœur du découpage en deux
sections — « pas de milonga ce jeudi » est la phrase la plus utile que l'agenda
puisse porter sur un régulier, et replier la série fait de l'exception la seule
fois où cet événement apparaît chronologiquement.

---

## 10. Les cas d'erreur, pendant que c'est sûr

Quatre à provoquer exprès, parce qu'ils sont dans l'aide et qu'un organisateur
les rencontrera. (Ce paragraphe a annoncé « trois » au-dessus d'un tableau de
quatre lignes jusqu'au 2026-10-21.)

| provoquer | message attendu |
|---|---|
| demander un lien avec une adresse jamais invitée | `Signups not allowed for otp` |
| ajouter un membre par une adresse sans compte | `NT006`, nommément |
| se connecter avec un compte rattaché à rien | **ça dépend de qui vous êtes**, voir ci-dessous |
| rouvrir un lien magique déjà utilisé | « Ce lien n'a pas fonctionné » |

**Le troisième cas a deux réponses depuis le 2026-10-18, et c'est voulu.** Le
même état — une session valide, aucune appartenance — veut dire deux choses
différentes selon la personne :

| qui se connecte | ce qu'il voit |
|---|---|
| quelqu'un qu'on est en train d'intégrer | « Votre accès est en préparation. », en bleu |
| **un administrateur** | « Vous n'êtes membre d'aucun organisateur », en rouge, avec l'explication de `is_member()` |

La boîte rouge n'a jamais été écrite pour un organisateur : c'est un diagnostic
RLS, et pour la personne qu'elle décrit elle se lit comme un refus qu'elle
aurait provoqué. Elle reste pour vous, qui êtes la seule personne à qui elle
s'adresse. Voir `editor/public/pending.js`.

**Ce tableau a décrit l'ancien comportement pendant trois jours** après que la
page d'attente a été déployée, alors que les étapes 1 et 2 du même document
décrivaient déjà le nouveau. Une correction qui atterrit à un endroit et déclare
le fichier terminé est l'échec récurrent de ce dépôt ; relisez le document
entier quand vous changez un message.

**Pour provoquer le premier cas en tant qu'admin**, il faut un compte membre de
rien : le vôtre est membre d'au moins une fiche. Le compte de test, entre l'étape 2
et l'étape 3, est exactement ça — mais dans l'ordre correct cette fenêtre ne
dure que le temps d'écrire une requête et personne n'y entre. Pour la voir,
il faut la provoquer : c'est le paragraphe facultatif de l'étape 4.

L'aide les explique tous, et donne `contact@nissartango.fr` comme recours —
c'est le texte que vous venez de déployer, et le voir en situation est la
meilleure relecture possible.

---

## 11. Tout supprimer

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
with partis as (delete from public.events returning slug)
select count(*) as supprimes from partis;
```

**La forme `with … returning` n'est pas une coquetterie**, et c'est l'étape la
plus irréversible du document. L'éditeur SQL de Supabase affiche « Success. No
rows returned » qu'un `DELETE` ait emporté une ligne ou zéro : les deux issues
sont indiscernables à l'écran. Le 2026-10-19, une suppression d'organisateur a
été relancée quatre fois sur cette ambiguïté, sur une ligne qui était visible,
sans déclencheur ni RLS pour l'expliquer. Compter dans un CTE force un nombre à
apparaître, donc « aucune sortie » devient impossible.

Même piège, deuxième moitié : **l'éditeur n'affiche que le résultat de la
DERNIÈRE requête** quand on en lance plusieurs d'un coup. Lancez-les une par
une, et vérifiez ensuite :

```sql
select count(*) as events from public.events;                -- 0
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

## 12. Le déploiement final

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
