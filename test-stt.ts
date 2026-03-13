import { config } from "./src/config.js";
import { speechToText } from "./src/stt.js";
import { writeFileSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";

async function testStt() {
  console.log("Generating sample audio using TTS...");
  try {
    // Generate a dummy silent/beep ogg file or similar for testing, or just use espeak
    execSync("mkdir -p /tmp && ffmpeg -f lavfi -i sine=frequency=1000:duration=2 -c:a libvorbis -q:a 4 /tmp/test-audio.ogg -y");
  } catch(e) {
    console.error("FFmpeg not available, writing a dummy file buffer instead.");
    writeFileSync("/tmp/test-audio.ogg", Buffer.alloc(1024));
  }
  
  const buffer = readFileSync("/tmp/test-audio.ogg");
  
  // Set the Railway env var to bypass local mock
  process.env.RAILWAY_ENVIRONMENT_NAME = "production";
  
  console.log("Testing Sarvam API...");
  const result = await speechToText(buffer, "audio/ogg");
  console.log("Result:", result);
}

testStt().catch(console.error);
