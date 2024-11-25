## aoi.sqlite

- Easy to use package for the implementation of SQLite in aoi.js with minimal changes.

### Setup

To get started with aoi.sqlite, we have to do a couple things.

- Install the package.

```bash
npm install github:faf4a/aoi.sqlite
```

- Update your index.js file.

```js
const { AoiClient, LoadCommands } = require("aoi.js");
const { Database } = require("aoi.sqlite");

const client = new AoiClient({
  token: "DISCORD BOT TOKEN",
  prefix: "DISCORD BOT PREFIX",
  intents: ["Guilds", "GuildMessages", "GuildMembers", "MessageContent"],
  events: ["onInteractionCreate", "onMessage"],
  disableAoiDB: true // This is important, ensure it's set to true. You can't use both at once.
});

new Database(client, {
  location: "./database.db", // your SQLite file location
  tables: ["main"],
  logging: true, // default is true
  debug: true, // default is false
});

client.variables({
    variable: "value"
}); // just like you did before.

// rest of your index.js..
```

## aoi.db

### Transfer aoi.db database

That's currently not possible with this package.

### Want to keep aoi.db?

That's currently not possible with this package and not planned in the near future.
