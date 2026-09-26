// Rare Breeds UI: presentational React 19 components (props and callbacks only, no SDK calls).
// Styles live in games/rare-breeds/style.css (class prefix rb-). Render everything inside <GameRoot>.
export { GameRoot, WorldLayer, type GameRootProps } from "./GameRoot.tsx";
export { SpriteThumb, type SpriteThumbProps } from "./SpriteThumb.tsx";
export { Hud, type HudProps } from "./Hud.tsx";
export { ActionBar, type ActionBarProps, type StationPrompt } from "./ActionBar.tsx";
export { Panel, type PanelProps } from "./Panel.tsx";
export { MatchmakerPanel, type MatchmakerPanelProps } from "./MatchmakerPanel.tsx";
export { HatchOverlay, type HatchOverlayProps } from "./HatchOverlay.tsx";
export { BabyCard, DnaRail, type BabyCardProps } from "./BabyCard.tsx";
export { BroodPanel, type BroodPanelProps } from "./BroodPanel.tsx";
export { SettingsPanel, type SettingsPanelProps } from "./SettingsPanel.tsx";
export { EggShopPanel, type EggPack, type EggShopPanelProps } from "./EggShop.tsx";
export { CollectionMeter, type CollectionMeterProps } from "./Collection.tsx";
export { buildCollection, discoveriesOf, familiesOf, EMPTY_COLLECTION, type Collection } from "./collection.ts";
export { LoadingScreen, ErrorScreen, type LoadingScreenProps, type ErrorScreenProps } from "./Screens.tsx";
export { Toast, type ToastProps } from "./Toast.tsx";
export { PixelIcon, type PixelIconName } from "./PixelIcon.tsx";
export { type TierInfo } from "./shared.ts";
