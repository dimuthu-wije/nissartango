# Faire tourner l'agenda — le guide de l'administrateur

Écrit le 2026-10-03, en pendant de `editor/public/aide/` (le guide de
l'organisateur, lisible sur editor.nissartango.fr/aide/). Celui-là dit à un
organisateur ce qu'il peut faire. Celui-ci dit ce que vous seul pouvez faire, et
où chaque chose se trouve réellement.

En français, comme l'éditeur et comme l'autre guide. Le reste de `docs/` est en
anglais : ce sont des passations techniques, destinées à quelqu'un qui reprend
le code. Un guide d'exploitation que vous relirez dans six mois n'a pas de
raison de l'être.

---

## Ce qu'« administrateur » veut dire

Trois choses différentes décident de ce que quelqu'un peut faire, et on les
confond facilement :

| | Ce que c'est | Ce que ça donne |
|---|---|---|
| **administrateur** | une ligne dans `public.user_roles` avec `role = 'admin'` | la file d'attente, et le droit d'administrer **n'importe quel** organisateur |
| **propriétaire** | `organizer_members.role = 'owner'` pour un organisateur | modifier la fiche de cet organisateur, gérer ses membres |
| **éditeur** | `organizer_members.role = 'editor'` | créer et modifier les événements de cet organisateur |

Ils ne s'emboîtent pas. Être administrateur ne vous permet **pas** de créer un
événement : cela exige `is_member(organizer_id)`, et il n'existe pas de
politique d'insertion pour l'administrateur. Pour saisir un événement à la place
de quelqu'un, ajoutez-vous d'abord comme membre de son organisateur — vous le
pouvez, justement parce que vous êtes administrateur.

Aujourd'hui : `dimuthu.wije@outlook.com` est le seul administrateur, et il est
membre des trois organisateurs.

---

## Le travail quotidien : la file d'attente

**editor.nissartango.fr/queue/** — visible des seuls administrateurs. Le lien
est masqué pour tous les autres, donc un organisateur n'y arrive jamais par
hasard.

**« Rien en attente » est l'état normal.** La page est écrite pour le dire
franchement plutôt que de paraître occupée : « rien n'attend » et « vous ne
voyez rien » sont deux problèmes différents.

Trois boutons, et c'est le deuxième qui demande de l'attention :

- **Approuver** — publie l'événement. Il apparaît sur le site à la
  reconstruction suivante, au plus tard dix minutes après.
- **Rejeter** — exige toujours un motif. Sur un événement *en attente*, cela le
  refuse simplement. Sur un événement **déjà en ligne**, le bouton s'intitule
  **« Rejeter (retirer du site) »** et demande confirmation, parce qu'il retire
  l'événement entier de l'agenda — toutes ses dates, pas seulement la
  modification que vous regardiez. Rien n'est supprimé : l'approuver à nouveau
  le remet en ligne.
- **Marquer comme revu** — « j'ai vu ce changement ». Efface le drapeau, ne
  change rien d'autre. C'est ce qu'il faut quand un organisateur modifie un
  événement en ligne et que la modification convient.

Cette dernière distinction est celle qui coûte cher si on se trompe. Un
organisateur corrige une faute de frappe sur la milonga du jeudi ; l'événement
arrive dans votre file, signalé. **Rejeter** retirerait la milonga du site.
**Marquer comme revu** est le bon bouton.

Un événement modifié par son organisateur **reste en ligne** pendant qu'il vous
attend. Vous relisez un changement déjà parti, vous ne le bloquez pas.

---

## Faire entrer quelqu'un

Deux étapes, et la première n'est pas dans l'éditeur.

**1. Créer son compte.** Tableau de bord Supabase → **Authentication → Users →
Invite user** → son adresse. La personne reçoit une invitation.

Impossible depuis l'éditeur, et c'est voulu : `requestLink()` dans
`editor/public/auth.js` envoie `create_user: false`, donc demander un lien avec
une adresse inconnue est refusé. Son commentaire explique pourquoi — une
inscription est une décision avec une conséquence de modération, et elle n'a pas
sa place derrière un champ e-mail sur une page que n'importe qui peut ouvrir.

**2. La rattacher à un organisateur.** Éditeur → Organisateur → l'organisateur →
**Membres** → ajouter par e-mail, comme **Éditeur** ou **Propriétaire**.

Donnez **Propriétaire** à un véritable organisateur extérieur, sur sa propre
fiche : il pourra alors modifier son nom, ses liens et ses coordonnées, et
ajouter ses propres collègues, sans repasser par vous. Gardez **Éditeur** pour
quelqu'un qui aide sur une fiche qui n'est pas la sienne.

Si vous faites l'étape 2 avant la 1, le formulaire vous le dit nommément plutôt
que d'échouer vaguement.

---

## Créer un organisateur

**En SQL uniquement.** Personne ne détient de droit `INSERT` sur
`public.organizers` — pas même un administrateur — ce qui est délibéré et écrit
dans `20260828190100` : *« Creating and deleting organizers stays with you. »*

Tableau de bord → **SQL Editor** (il s'agit de données, pas de schéma ; la règle
« la CLI, jamais le tableau de bord » d'`AGENTS.md` concerne les migrations) :

```sql
insert into public.organizers (name, slug)
values ('El Gato Tanguero', 'el-gato-tanguero')
returning id, name, slug;
```

Le `slug` est définitif : il figure dans chaque lien vers cet organisateur.
Ajoutez ensuite son premier membre depuis l'éditeur, comme ci-dessus.

---

## Les deux projets

```
eqcgeqzzuzcwrflwasjo   « dimuthu-wije's Project »   = PRODUCTION
hjsekipqryfuwdkhxuks   « nissartango-dev »          = dev
```

**Les noms sont inversés.** Lisez la référence, jamais le nom. Chaque script de
ce dépôt affiche la référence qu'il s'apprête à toucher, avant de la toucher,
pour cette raison précise.

---

## Modifier quelque chose

| Quoi | Comment |
|---|---|
| Le code du site | `git push` — Cloudflare construit et déploie à chaque poussée sur `main` |
| Le contenu du site | rien : le poller le remarque en moins de dix minutes et reconstruit |
| L'éditeur | `npm run deploy:editor` |
| La base de données | `./scripts/db-push.sh prod --yes` |

**L'ordre compte quand une migration et l'éditeur changent ensemble.** Appliquez
d'abord la migration, déployez l'éditeur ensuite : l'ancien éditeur n'utilise
pas la nouvelle colonne, alors qu'un nouvel éditeur qui envoie une colonne
absente de la production échoue avec une erreur 400.

### Le piège qui a déjà coûté deux fois

`supabase db push --dry-run` et la vraie commande se terminent toutes deux par
`Finished supabase db push.` et nomment la même migration. La seule différence
dans le résumé est un champ :

```
simulation  {"upToDate":false,"dryRun":true, …,"message":"Finished supabase db push."}
réel        {"upToDate":false,"dryRun":false,…,"message":"Finished supabase db push."}
```

**`Applying migration <fichier>...` est la seule ligne qui signifie que c'est
fait.** Ne vous fiez pas à la dernière ligne.

---

## Vérifier que ça a marché

Ne croyez jamais un déploiement sur parole. Le reçu est servi par le site :

```bash
curl -s "https://nissartango.fr/build-info.json?t=$(date +%s)" | python3 -m json.tool
```

`built_at` doit avoir **avancé**. Toute la valeur du test tient dans cette
asymétrie : un cache périmé ne peut jamais rendre qu'un horodatage *plus ancien*,
jamais plus récent — donc un déplacement est concluant, alors qu'une absence de
déplacement ne prouve rien.

`checksum` doit correspondre à ce qu'annonce la base ; quand les deux diffèrent,
c'est simplement qu'une reconstruction est due.

Pour l'éditeur, comparez ce que Cloudflare sert réellement avec ce que vous avez
en local — en forçant la revalidation, parce que son cache de bordure a déjà
servi un fichier périmé après un déploiement parfaitement valide :

```bash
curl -sS -o /tmp/x.js -H 'Cache-Control: no-cache' https://editor.nissartango.fr/event.js
cmp /tmp/x.js editor/public/event.js && echo identique
```

---

## Ce que vous ne pouvez pas faire, et qu'il ne faut pas contourner

- **Supprimer un événement publié depuis l'éditeur.** La politique le refuse
  parce que son lien permanent a pu être partagé. Annulez-le plutôt : il reste
  en ligne, barré, avec votre motif, ce qui est plus utile à un lecteur qu'une
  page introuvable.
- **Publier à la place de quelqu'un en modifiant `status` dans le formulaire.**
  Il n'y a pas de champ statut ; la politique d'insertion exige `pending`. C'est
  la file d'attente qui publie.
- **Voir dans votre liste un organisateur dont vous n'êtes pas membre.** La
  liste répond à « les organisateurs pour lesquels je peux créer des
  événements ». Vous pouvez tout de même ouvrir sa fiche par son adresse :
  `/organizer/?id=<uuid>`.

Vous *pouvez* faire tout cela en SQL en tant que propriétaire de la base, car le
RLS ne s'applique pas au propriétaire des tables. C'est le moment où vous
contournez votre propre conception : c'est parfois justifié — nous avons fusionné
trois lignes et supprimé huit événements ainsi le 2026-10-02 — et cela doit
rester un geste délibéré, pas une commodité.

---

## Quand quelque chose casse

**Une construction en échec ne met pas le site hors ligne.** Cloudflare conserve
le dernier déploiement valide : le site paraît donc parfaitement normal pendant
que les changements de contenu cessent d'arriver. `workers/build-notifier/` vous
envoie un e-mail en cas d'échec, et uniquement en cas d'échec.

Une absence de courrier n'est *pas* une preuve de bonne santé : un worker qui
cesse de tourner n'émet aucun événement et donne exactement la même image.
Confirmez positivement avec `built_at`, ci-dessus.

`npm run verify:build` exécute quatorze contrôles structurels, y compris dans la
chaîne de construction Cloudflare : un changement qui casse l'accessibilité des
pages, le sitemap, les aperçus sociaux ou l'accord entre le JSON-LD et l'agenda
**fait échouer le déploiement** au lieu de partir en ligne. Le 2026-10-02, c'est
lui qui a vu une page d'événement afficher une seule date quand l'agenda en
listait trois.

---

## Si vous ne lisez qu'une chose avant de modifier quoi que ce soit

`AGENTS.md`, sections *Gotchas learned the hard way* et *Instruments that lie
quietly*. L'essentiel de ce qui s'est mal passé sur ce projet n'était pas un bug
dans le code, mais une mesure qui avait l'air juste : un grep incapable de
trouver, un contrôle qui posait la mauvaise question, un cache qui répondait à la
place d'un serveur.
