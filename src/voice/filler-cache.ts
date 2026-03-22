import { textToSpeech } from "../tts.js";

/** 
 * A pool of generic, conversational filler phrases.
 * These are pre-generated at startup to eliminate runtime latency.
 */
const FILLER_PHRASES = [
  "Hmm, let me think about that...",
  "Oh interesting, give me a sec...",
  "Working on it...",
  "Bear with me a moment...",
  "Let me look into this...",
  "Almost there, hang tight...",
  "Ooh, good question...",
  "Processing that now...",
  "Just a sec, digging deeper...",
  "Thinking, thinking...",
  "One moment please...",
  "On it!"
];

// In-memory cache of pre-generated audio buffers
const fillerCache: Buffer[] = [];

/**
 * Initialize the filler audio cache at server startup.
 * Uses Kokoro TTS (since latency doesn't matter at boot).
 */
export async function initFillerCache(): Promise<void> {
  if (fillerCache.length > 0) return; // Already initialized

  console.log(`\n⏳ Initializing Voice Filler Cache (${FILLER_PHRASES.length} clips)...`);
  
  const startTime = Date.now();
  let successCount = 0;

  for (const text of FILLER_PHRASES) {
    try {
      // Use standard textToSpeech (Kokoro)
      const audio = await textToSpeech(text);
      if (audio) {
        fillerCache.push(audio);
        successCount++;
        process.stdout.write("."); // Progress dot
      }
    } catch (err) {
      console.warn(`\n⚠️ Failed to pre-generate filler: "${text}"`, err);
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Filler Cache ready: ${successCount} clips generated in ${duration}s.\n`);
}

/**
 * Get a random pre-generated filler audio buffer.
 * Returns null if cache is empty.
 */
export function getRandomFillerAudio(): Buffer | null {
  if (fillerCache.length === 0) return null;
  const randomIndex = Math.floor(Math.random() * fillerCache.length);
  return fillerCache[randomIndex];
}

/**
 * Returns the number of cached filler clips.
 */
export function getFillerCacheSize(): number {
  return fillerCache.length;
}
