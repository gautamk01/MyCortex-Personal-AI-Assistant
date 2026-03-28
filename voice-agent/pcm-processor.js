/**
 * PCM Processor — AudioWorklet for continuous PCM16 microphone capture.
 *
 * Converts Float32 samples from the Web Audio API to Int16 PCM frames
 * and posts them to the main thread via MessagePort.
 *
 * Frame size: 320 samples = 20ms at 16kHz
 */

const FRAME_SIZE = 320; // 20ms at 16kHz

class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const samples = input[0]; // Float32Array (128 samples per quantum at 16kHz)

    // Accumulate samples
    for (let i = 0; i < samples.length; i++) {
      this._buffer.push(samples[i]);
    }

    // Emit complete 20ms frames
    while (this._buffer.length >= FRAME_SIZE) {
      const frame = this._buffer.splice(0, FRAME_SIZE);
      const int16 = new Int16Array(FRAME_SIZE);

      for (let i = 0; i < FRAME_SIZE; i++) {
        // Clamp and convert float32 [-1, 1] → int16 [-32768, 32767]
        const clamped = Math.max(-1, Math.min(1, frame[i]));
        int16[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
      }

      // Transfer the buffer to avoid copying
      this.port.postMessage(int16.buffer, [int16.buffer]);
    }

    return true; // Keep processor alive
  }
}

registerProcessor("pcm-processor", PCMProcessor);
