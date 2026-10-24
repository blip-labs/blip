# Starter: make a new fair game in one command

```
node starter/create-fair-game.mjs my-game
cd my-game && npm install && npm test && npm start
```

You get a ready folder with the kit's code (`lib/`), the scoreboard contract (`contracts/`), their checks (`tests/`), the tiny example game (`game/`) and a local server that hands out today's Bitcoin block (`serve.mjs`).

The command only copies files. It installs nothing by itself, needs no wallet and reads no keys. `npm install` adds the Clarinet simulator, which is only used to check the contract.
