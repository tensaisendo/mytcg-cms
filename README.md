# 🚀 Getting started with Strapi

## MYTCG HUB deck regulations

Pour lancer CMS et Hub ensemble sous Windows, double-cliquer sur
`../start-local.cmd`. Voir le [guide local](../README.md).

### Localized product Sets

Simulation du rattrapage : `npm run cards:plan-recovery`. Regenere l'audit medias
et produit `.tmp/reports/card-recovery-plan.md` et `.json`. Lecture seule ;
`--write` est refuse. Les candidats necessitent encore une validation officielle.
Les identifiants existants, produits ambigus et suffixes non pris en charge sont
isoles, sans toucher aux prix ni aux collections.

Les candidates automatiques localisees ont ete traitees : 204 impressions FR
et 212 JP creees et verifiees. Pour de futurs medias, regenerer d'abord le plan
ici, puis lancer depuis `mytcg-hub` :

```powershell
npm run recover:localized-batch -- --language FR --limit 50
npm run recover:localized-batch -- --language FR --limit 50 --write
npm run recover:localized-batch -- --language JP --limit 50
npm run recover:localized-batch -- --language JP --limit 50 --write
```

Le premier appel simule. Le second sauvegarde la base, ignore les impressions
existantes, ecrit seulement les propositions validees et verifie le resultat.

Verification des noms FR officiels : `npm run sets:audit-names-fr` (Python 3,
acces Internet). Puis `npm run sets:apply-names-fr` pour simuler et
`npm run sets:apply-names-fr -- --write` pour appliquer uniquement les noms.
Strapi doit tourner ; le token est lu depuis `../mytcg-hub/.env.local`.
Les journaux avant/apres sont conserves dans `.tmp/reports`.
Les produits generiques sans code officiel restent inchanges. La migration des
Sets preserve desormais les noms existants lors d'une nouvelle execution.

Audit en lecture seule des dossiers, images sans fiche et relations :
`npm run sets:audit-coverage`. Rapports `.tmp/reports/set-coverage.md` et `.json`.
Strapi peut rester lance. Les noms de fichiers identiques ne prouvent pas un
visuel identique ; aucune correction automatique n'est effectuee.

Each Set is a language-specific Media Library product folder, with `key`
(`OP09:FR`), `language`, `mediaFolderId` and a code-free local `name`.
Old shared Sets are retained with `isLegacy=true`. Their deprecated translation
fields are cleared; active Sets never inherit names from another language.
`GET /api/sets/summary?language=FR` lists only FR editions, including empty ones.

`npm run sets:migrate-editions` audits local SQLite. Start Strapi once to sync
the schema, stop it, then run `npm run sets:migrate-editions -- --write`.
The script backs up the DB, relinks by attached media, and verifies unchanged
card, price, media and collection data. Reports and unresolved links are in
`.tmp/reports`; backups in `.tmp/backups`. Restart with `npm run develop`.
Run regression tests with `npm run test:set-editions`.

### Card and language printings

`Card` stores the shared game identity and rules. Each `CardPrinting` is the
actual collectible in EN, FR or JP and owns its printed code, image, localized
text, price, Set and treatment. `CardPrinting.card` is the explicit link between
both records; matching filename suffixes are not treated as proof that artwork
or treatment is identical across languages.

For an existing database, start Strapi once after the schema change, stop it,
then audit and apply the backed-up migration:

```bash
npm run printings:migrate-card-treatment
npm run printings:migrate-card-treatment -- --write
```

The Media Library importer fills these relations for future printings and does
not overwrite a treatment already curated in Strapi.

### Collection API

`GET /api/user-cards/catalog?lang=JP&page=1` requires an authenticated user.
It filters owned printings by account and language, then applies `query`,
`set`, `rarity`, `treatment`, `color`, `type` and `sort` before pagination.
Only the 12 selected cards have their media populated. Metadata queries are
restricted to owned card codes and chunked to limit SQL parameters.
Restart Strapi to register the route and authenticated-role permission.

Regression tests (mock database, no real data modified):

```bash
node --test tests/collection-catalog.test.cjs
```

The active One Piece deck regulation and its card restrictions are managed in
the Strapi Content Manager through `Deck Regulation` and `Card Restriction`.

Compare the regulation stored in the project with Bandai's official page:

```bash
npm run regulations:check
```

This check also runs every Monday through
`.github/workflows/check-deck-regulations.yml`. It reports changes but does not
modify production rules automatically; a new dated regulation must be reviewed
and created in Strapi.

## Batch Media Library uploads

For large card image folders, prefer the batch command over the Strapi admin UI.
It uploads files into a Media Library folder, skips files that already exist in
that target folder and verifies that every local image exists remotely at the
end.

Run a dry-run first:

```bash
npm run media:upload-folder -- --source "C:\path\to\OP09" --target "EN/OP09 - EMPERORS IN THE NEW WORLD"
```

Upload for real:

```bash
npm run media:upload-folder -- --source "C:\path\to\OP09" --target "EN/OP09 - EMPERORS IN THE NEW WORLD" --write
```

Useful options:

```bash
npm run media:upload-folder -- --source "C:\path\to\OP09" --target "EN/OP09 - EMPERORS IN THE NEW WORLD" --write --concurrency 2 --retries 3
```

Do not run this command while uploading the same folder through the admin UI.
For SQLite local development, avoid running several write-heavy imports at the
same time.

Strapi comes with a full featured [Command Line Interface](https://docs.strapi.io/dev-docs/cli) (CLI) which lets you scaffold and manage your project in seconds.

### `develop`

Start your Strapi application with autoReload enabled. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-develop)

```
npm run develop
# or
yarn develop
```

### `start`

Start your Strapi application with autoReload disabled. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-start)

```
npm run start
# or
yarn start
```

### `build`

Build your admin panel. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-build)

```
npm run build
# or
yarn build
```

## ⚙️ Deployment

Strapi gives you many possible deployment options for your project including [Strapi Cloud](https://cloud.strapi.io). Browse the [deployment section of the documentation](https://docs.strapi.io/dev-docs/deployment) to find the best solution for your use case.

```
yarn strapi deploy
```

## 📚 Learn more

- [Resource center](https://strapi.io/resource-center) - Strapi resource center.
- [Strapi documentation](https://docs.strapi.io) - Official Strapi documentation.
- [Strapi tutorials](https://strapi.io/tutorials) - List of tutorials made by the core team and the community.
- [Strapi blog](https://strapi.io/blog) - Official Strapi blog containing articles made by the Strapi team and the community.
- [Changelog](https://strapi.io/changelog) - Find out about the Strapi product updates, new features and general improvements.

Feel free to check out the [Strapi GitHub repository](https://github.com/strapi/strapi). Your feedback and contributions are welcome!

## ✨ Community

- [Discord](https://discord.strapi.io) - Come chat with the Strapi community including the core team.
- [Forum](https://forum.strapi.io/) - Place to discuss, ask questions and find answers, show your Strapi project and get feedback or just talk with other Community members.
- [Awesome Strapi](https://github.com/strapi/awesome-strapi) - A curated list of awesome things related to Strapi.

---

<sub>🤫 Psst! [Strapi is hiring](https://strapi.io/careers).</sub>
