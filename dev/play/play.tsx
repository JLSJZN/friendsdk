// Dev-only local play harness. Mounts the real Rare Breeds component with the SDK's low-level
// preview client, so the game can be watched and driven without a wallet. It skips the runtime's
// ownership gate and in-frame confirmations, so it is never a deliverable and is never published.
// Open http://127.0.0.1:<port>/?friend=77949 (default Friend #77949).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createGamePreview, maximumPrize, parseChanceGame, RF } from "@rarefriends/friendsdk/game";
import gameJson from "../../games/rare-breeds/game.json";
import RareBreeds from "../../games/rare-breeds/index.tsx";
import "./play.css";

const friendId = BigInt(new URLSearchParams(location.search).get("friend") ?? "77949");
const definition = parseChanceGame(gameJson);
// Same funding as the SDK runtime's preview ledger: stake = 10 x max prize, 20 RF balance.
const { client } = createGamePreview(definition, { stake: maximumPrize(definition) * 10n, rfBalance: 20n * RF, friendId });

createRoot(document.getElementById("root")!).render(<StrictMode>
  <div className="play-frame"><RareBreeds friendId={friendId} client={client} paused={false} /></div>
  <p className="play-note">Local dev harness · Friend #{friendId.toString()} · simulated RF · no wallet gate or confirmations (the published preview has both)</p>
</StrictMode>);
