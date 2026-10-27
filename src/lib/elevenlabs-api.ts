/**
 * Adresse de l'API ElevenLabs. Modifiable par ELEVENLABS_API_BASE pour les
 * tests automatiques (serveur factice local) ; jamais à changer en production.
 */
export const ELEVENLABS_API_BASE = (process.env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io").replace(/\/+$/, "");
