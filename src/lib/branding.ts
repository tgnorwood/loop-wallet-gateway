import previewAsset from "@/assets/loop-wallet-social.jpg.asset.json";

/** Leaf-page metadata only: keep images out of the root/shared layouts. */
export const loopPreviewMeta = [
  { property: "og:type", content: "website" },
  { property: "og:site_name", content: "Loop Wallet" },
  { property: "og:image", content: new URL(previewAsset.url, "https://wallet.loop.fans").href },
  { property: "og:image:width", content: "1200" },
  { property: "og:image:height", content: "630" },
  { property: "og:image:alt", content: "Loop Wallet — futuristic graphite wallet with cyan and violet cards and the Loop logo" },
  { name: "twitter:card", content: "summary_large_image" },
  { name: "twitter:image", content: new URL(previewAsset.url, "https://wallet.loop.fans").href },
  { name: "twitter:image:alt", content: "Loop Wallet — futuristic graphite wallet with cyan and violet cards and the Loop logo" },
];