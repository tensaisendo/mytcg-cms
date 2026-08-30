# 🚀 Getting started with Strapi

## MYTCG HUB deck regulations

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
