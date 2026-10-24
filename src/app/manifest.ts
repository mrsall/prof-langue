import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Prof de langues",
    short_name: "Prof langues",
    description:
      "Parle anglais ou français à voix haute avec une IA qui répond avec une voix naturelle.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0d17",
    theme_color: "#0b0d17",
    lang: "fr",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
