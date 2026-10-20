# Business Deal

The classic Indian property trading board game, for 2 to 6 players, each on their own phone or laptop. Computer players are optional, for empty seats or practice.

Same setup as Teen Patti, Declare and Judgment:
- **GitHub Pages** serves the website from the `docs` folder (`gh-pages` branch).
- **A Firebase function** (`bd`) rolls the dice, shuffles the Chance and Community Chest decks and checks every move. Nobody's browser can fake a roll.
- It shares the Teen Patti Firebase project (`teenpatti-44fde`) with its own function (`bd`), codebase (`businessdeal`) and collection (`btables`). Deploying it never touches the other games.

## Files

| Where | What |
|---|---|
| `docs/index.html`, `docs/style.css`, `docs/app.js` | The website: home, lobby, board, deals |
| `docs/engine.js` | All the rules and the board. Also runs practice games in the browser |
| `docs/firebase-config.js` | Firebase web config (safe to be public) |
| `functions/` | The Firebase function. `functions/engine.js` is a copy of `docs/engine.js`; run `npm run sync` after changing rules |
| `firestore.rules` | Database rules for all four games |
| `tests/` | Rules and server tests (`npm test`) |
| `tools/` | Bot game simulator, screenshot and multi-browser emulator tests |

## Rules as built

- 36 squares: 18 cities in 6 colours of 3, Roadways, Waterways, Airways, Railways, BEST Electric, Petroleum, 3 Chance, 3 Community Chest, Income Tax, Wealth Tax, and the corners Start, Jail, Club House, Rest House.
- Everyone starts with ₹15,000. Landing on or passing Start pays ₹1,500.
- You have to cross Start once before you can buy anything.
- Land on an unowned property: buy it at the printed price or pass and it goes to auction.
- Owning all 3 cities in a colour doubles the site rent and lets you build. Up to 3 houses, then a hotel. Build evenly.
- Transport rent multiplies with how many you own. Utilities charge dice total × ₹40, or × ₹100 if you own both.
- Mortgage for half the price. Lift it for that plus 10%. No rent on mortgaged property.
- Doubles roll again; three doubles in a row is Jail. Out of Jail: pay ₹500, use a card, or roll a double (3 tries).
- Club House: pay ₹100 to each player. Rest House: collect ₹100 from each player.
- Income Tax: ₹50 per property (₹100 to ₹500). Wealth Tax: ₹100 per house, ₹300 per hotel (₹100 to ₹1,000).
- Trade property and cash with anyone. Can't pay? Sell buildings, mortgage, or go bankrupt. Last one standing wins.

The host can change in the lobby: starting cash, Start salary, the cross-Start rule, auctions, old-style Club/Rest House (pay the bank / miss a turn), jail fine, the old "roll 12 to leave Start" rule, and a round limit where the richest player wins.

Box sets differ by edition. City prices, rents and card text are in `BOARD`, `CHANCE` and `CHEST` at the top of `docs/engine.js` if you want to match your own set.

## Deploy the server (one time, about 5 minutes, from your laptop)

Practice mode works right away. Online tables need the function deployed once. Install Node.js LTS from nodejs.org if you don't have it, then in Terminal:

```
git clone https://github.com/Abhyuday2103/businessdeal.git
cd businessdeal
npx firebase-tools login
cd functions && npm install && cd ..
npx firebase-tools deploy --only functions:businessdeal,firestore:rules --project teenpatti-44fde
```

The rules file includes Teen Patti, Declare and Judgment too, so deploying it keeps all four games working.

## Update the website

`git subtree push --prefix docs origin gh-pages` (Claude does this for you).
