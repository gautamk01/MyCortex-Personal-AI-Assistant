/**
 * Gravity Claw — JARVIS Voice Agent
 * Browser-side JavaScript for real-time voice interaction.
 *
 * Features:
 *   - Push-to-talk (hold Space or mic button)
 *   - "Hey Claw" wake word detection (via Web Speech API)
 *   - WebSocket communication with the voice server
 *   - Audio visualizer (Canvas)
 *   - TTS audio playback
 */

// ── State ────────────────────────────────────────────────────

const state = {
  ws: null,
  wsUrl: localStorage.getItem('wsUrl') || 'ws://localhost:8891',
  wakePhrase: localStorage.getItem('wakePhrase') || 'hey claw',
  isConnected: false,
  isListening: false,
  isProcessing: false,
  isSpeaking: false,
  wakeWordEnabled: false,
  mediaRecorder: null,
  audioChunks: [],
  audioContext: null,
  analyser: null,
  micStream: null,
  speechRecognition: null,
  animationFrame: null,
  reconnectTimer: null,
  reconnectAttempts: 0,
  currentAudioSource: null,
};

// ── DOM Elements ─────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);
const connectionStatus = $('#connection-status');
const connectionStatusText = connectionStatus.querySelector('.status-text');
const sttStatus = $('#stt-status');
const orb = $('#orb');
const stateLabel = $('#state-label');
const userTranscript = $('#user-transcript');
const userTranscriptText = userTranscript.querySelector('.transcript-text');
const aiResponse = $('#ai-response');
const aiResponseText = aiResponse.querySelector('.transcript-text');
const talkBtn = $('#talk-btn');
const wakeWordToggle = $('#wake-word-toggle');
const settingsBtn = $('#settings-btn');
const settingsPanel = $('#settings-panel');
const settingsSave = $('#settings-save');
const settingsClose = $('#settings-close');
const wsUrlInput = $('#ws-url');
const wakePhraseInput = $('#wake-phrase');
const canvas = $('#visualizer-canvas');
const ctx = canvas.getContext('2d');

// ── WebSocket Connection ─────────────────────────────────────

function connect() {
  // Clear any pending reconnect
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  if (state.ws) {
    state.ws.onclose = null; // Prevent triggering reconnect
    state.ws.close();
    state.ws = null;
  }

  try {
    console.log(`🔌 Connecting to ${state.wsUrl}...`);
    state.ws = new WebSocket(state.wsUrl);
    state.ws.binaryType = 'arraybuffer';

    state.ws.onopen = () => {
      state.isConnected = true;
      state.reconnectAttempts = 0;
      updateConnectionStatus('connected');
      // Send config with the first user ID
      state.ws.send(JSON.stringify({ type: 'config', chatId: 0 }));
      console.log('✅ Connected to voice server');
    };

    state.ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        const msg = JSON.parse(event.data);
        console.log('📩 Message:', msg);
        handleJsonMessage(msg);
      } else {
        // Binary data — TTS audio
        console.log(`🔊 Received audio: ${event.data.byteLength} bytes`);
        handleAudioResponse(event.data);
      }
    };

    state.ws.onclose = (event) => {
      state.isConnected = false;
      updateConnectionStatus('disconnected');
      console.log(`❌ Disconnected (code: ${event.code}, reason: ${event.reason})`);
      
      // Exponential backoff reconnect (max 30 seconds)
      state.reconnectAttempts++;
      const delay = Math.min(3000 * Math.pow(1.5, state.reconnectAttempts - 1), 30000);
      console.log(`🔄 Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${state.reconnectAttempts})...`);
      state.reconnectTimer = setTimeout(connect, delay);
    };

    state.ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  } catch (err) {
    console.error('Failed to connect:', err);
    state.reconnectAttempts++;
    const delay = Math.min(3000 * Math.pow(1.5, state.reconnectAttempts - 1), 30000);
    state.reconnectTimer = setTimeout(connect, delay);
  }
}

function handleJsonMessage(msg) {
  switch (msg.type) {
    case 'status':
      handleStatusChange(msg.status);
      break;
    case 'transcript':
      showUserTranscript(msg.text);
      break;
    case 'progress':
      showProgress(msg.text);
      break;
    case 'response':
      showAIResponse(msg.text);
      break;
    case 'error':
      console.error('Server error:', msg.message);
      showAIResponse(`⚠️ ${msg.message}`);
      setOrbState('idle');
      break;
    case 'pong':
      break;
  }
}

function handleStatusChange(status) {
  console.log(`📡 Status: ${status}`);
  switch (status) {
    case 'connected':
    case 'ready':
      state.isProcessing = false;
      state.isSpeaking = false;
      setOrbState('idle');
      if (status === 'ready') {
        sttStatus.classList.remove('hidden');
        sttStatus.classList.add('connected');
        sttStatus.querySelector('.status-text').textContent = 'STT READY';
      }
      break;
    case 'stt_unavailable':
      sttStatus.classList.remove('hidden');
      sttStatus.classList.remove('connected');
      sttStatus.classList.add('disconnected');
      sttStatus.querySelector('.status-text').textContent = 'STT OFFLINE';
      break;
    case 'processing':
      state.isProcessing = true;
      setOrbState('processing');
      break;
    case 'speaking':
      state.isSpeaking = true;
      setOrbState('speaking');
      break;
  }
}

// ── UI Updates ───────────────────────────────────────────────

function updateConnectionStatus(status) {
  connectionStatus.className = `status-badge ${status}`;
  connectionStatusText.textContent = status.toUpperCase();
}

function setOrbState(orbState) {
  orb.className = orbState;
  const labels = {
    idle: 'READY',
    listening: 'LISTENING',
    processing: 'THINKING',
    speaking: 'SPEAKING',
  };
  stateLabel.textContent = labels[orbState] || orbState.toUpperCase();
}

function showUserTranscript(text) {
  userTranscriptText.textContent = `"${text}"`;
  userTranscript.classList.remove('hidden');
}

function showProgress(text) {
  if (state.isProcessing && !userTranscript.classList.contains('hidden')) {
    stateLabel.textContent = text.toUpperCase();
  }
}

function showAIResponse(text) {
  aiResponseText.textContent = text;
  aiResponse.classList.remove('hidden');
}

function clearTranscripts() {
  userTranscript.classList.add('hidden');
  aiResponse.classList.add('hidden');
  userTranscriptText.textContent = '';
  aiResponseText.textContent = '';
}

// ── Audio Recording ──────────────────────────────────────────

async function getOrCreateMicStream() {
  if (state.micStream) return state.micStream;

  console.log('🎤 Requesting microphone access...');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      sampleRate: 16000,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  state.micStream = stream;

  // Set up analyser for visualizer
  if (!state.audioContext) {
    state.audioContext = new AudioContext({ sampleRate: 16000 });
  }
  if (state.audioContext.state === 'suspended') {
    await state.audioContext.resume();
  }

  const source = state.audioContext.createMediaStreamSource(stream);
  state.analyser = state.audioContext.createAnalyser();
  state.analyser.fftSize = 256;
  source.connect(state.analyser);

  return stream;
}

async function startRecording() {
  if (state.isListening || state.isProcessing) return;

  if (state.isSpeaking) {
    console.log('🛑 Interrupting AI response...');
    if (state.currentAudioSource) {
      state.currentAudioSource.stop();
      state.currentAudioSource = null;
    }
    state.isSpeaking = false;
    setOrbState('idle');
  }

  if (!state.isConnected) {
    console.warn('Cannot record: not connected to voice server');
    return;
  }

  // Mark listening early to prevent rapid multiple starts
  state.isListening = true;
  setOrbState('listening');
  talkBtn.classList.add('active');
  clearTranscripts();

  try {
    const stream = await getOrCreateMicStream();
    
    // Check if user already stopped listening while we were getting permissions
    if (!state.isListening) {
      console.warn('🎤 User stopped right away; cancelling recording start.');
      return;
    }

    state.audioChunks = [];

    // Determine the best supported MIME type
    const preferredTypes = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];
    let mimeType = '';
    for (const type of preferredTypes) {
      if (MediaRecorder.isTypeSupported(type)) {
        mimeType = type;
        break;
      }
    }

    // Start recording
    const options = mimeType ? { mimeType } : {};
    state.mediaRecorder = new MediaRecorder(stream, options);

    state.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        state.audioChunks.push(event.data);
      }
    };

    state.mediaRecorder.onstop = () => {
      console.log(`🎤 Recording stopped, ${state.audioChunks.length} chunks collected`);
      sendAudio();
    };

    state.mediaRecorder.start(); // Record as a single chunk
    
    // Start visualizer
    startVisualizer();
    console.log('🎤 Recording started');

  } catch (err) {
    state.isListening = false;
    setOrbState('idle');
    talkBtn.classList.remove('active');
    console.error('Microphone error:', err);
    showAIResponse(`⚠️ Microphone access denied: ${err.message}`);
  }
}

function stopRecording() {
  if (!state.isListening) return;

  console.log('🎤 Stopping recording...');
  state.isListening = false;
  talkBtn.classList.remove('active');

  if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
    state.mediaRecorder.requestData(); // Flush any remaining data
    state.mediaRecorder.stop();
  }

  stopVisualizer();
}

async function sendAudio() {
  if (state.audioChunks.length === 0) {
    console.warn('No audio chunks to send');
    setOrbState('idle');
    return;
  }

  const mimeType = state.mediaRecorder?.mimeType || 'audio/webm';
  const blob = new Blob(state.audioChunks, { type: mimeType });
  state.audioChunks = [];

  console.log(`📤 Audio blob: ${blob.size} bytes, type: ${blob.type}`);

  if (blob.size < 1000) {
    console.warn('Audio too short (< 1KB), ignoring');
    setOrbState('idle');
    return;
  }

  setOrbState('processing');

  const buffer = await blob.arrayBuffer();
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(buffer);
    console.log(`📤 Sent ${buffer.byteLength} bytes to voice server`);
  } else {
    showAIResponse('⚠️ Not connected to voice server');
    setOrbState('idle');
  }
}

// ── Audio Playback ───────────────────────────────────────────

async function handleAudioResponse(arrayBuffer) {
  try {
    if (!state.audioContext) {
      state.audioContext = new AudioContext();
    }
    if (state.audioContext.state === 'suspended') {
      await state.audioContext.resume();
    }

    // Stop any currently playing audio (filler or previous response)
    if (state.currentAudioSource) {
      try {
        state.currentAudioSource.onended = null; // Prevent state reset from old source
        state.currentAudioSource.stop();
      } catch { /* already stopped */ }
      state.currentAudioSource = null;
    }

    console.log(`🔊 Decoding ${arrayBuffer.byteLength} bytes of audio...`);
    const audioBuffer = await state.audioContext.decodeAudioData(arrayBuffer.slice(0));
    const source = state.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(state.audioContext.destination);

    state.currentAudioSource = source;

    source.onended = () => {
      console.log('🔊 Audio playback finished');
      if (state.currentAudioSource === source) {
        state.currentAudioSource = null;
      }
      // Only reset state if we haven't already transitioned to listening
      if (state.isSpeaking) {
        state.isSpeaking = false;
        setOrbState('idle');
      }
    };

    source.start();
    state.isSpeaking = true;
    setOrbState('speaking');
    console.log(`🔊 Playing ${audioBuffer.duration.toFixed(1)}s of audio`);
  } catch (err) {
    console.error('Audio playback error:', err);
    showAIResponse('⚠️ Could not play audio response (check console for details)');
    state.isSpeaking = false;
    setOrbState('idle');
  }
}

// ── Canvas Visualizer ────────────────────────────────────────

function startVisualizer() {
  if (state.animationFrame) return;

  function draw() {
    state.animationFrame = requestAnimationFrame(draw);

    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;

    ctx.clearRect(0, 0, width, height);

    if (!state.analyser) return;

    const bufferLength = state.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    state.analyser.getByteFrequencyData(dataArray);

    // Calculate average volume
    const avg = dataArray.reduce((a, b) => a + b, 0) / bufferLength;
    const normalizedAvg = avg / 255;

    // Draw reactive rings
    const numRings = 5;
    for (let i = 0; i < numRings; i++) {
      const radius = 60 + i * 20 + normalizedAvg * 30;
      const alpha = 0.3 - i * 0.05;

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(6, 182, 212, ${Math.max(0, alpha * (0.5 + normalizedAvg))})`;
      ctx.lineWidth = 1 + normalizedAvg * 2;
      ctx.stroke();
    }

    // Draw frequency bars in a circle
    const barCount = 64;
    for (let i = 0; i < barCount; i++) {
      const dataIndex = Math.floor((i / barCount) * bufferLength);
      const value = dataArray[dataIndex] / 255;
      const angle = (i / barCount) * Math.PI * 2 - Math.PI / 2;
      const innerRadius = 55;
      const barLength = value * 40;

      const x1 = centerX + Math.cos(angle) * innerRadius;
      const y1 = centerY + Math.sin(angle) * innerRadius;
      const x2 = centerX + Math.cos(angle) * (innerRadius + barLength);
      const y2 = centerY + Math.sin(angle) * (innerRadius + barLength);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = `rgba(6, 182, 212, ${0.3 + value * 0.7})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  draw();
}

function stopVisualizer() {
  if (state.animationFrame) {
    cancelAnimationFrame(state.animationFrame);
    state.animationFrame = null;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// ── Wake Word Detection ──────────────────────────────────────

function startWakeWordDetection() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showAIResponse('⚠️ Wake word detection requires Chrome or Edge browser');
    return;
  }

  state.speechRecognition = new SpeechRecognition();
  state.speechRecognition.continuous = true;
  state.speechRecognition.interimResults = true;
  state.speechRecognition.lang = 'en-US';

  state.speechRecognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript.toLowerCase().trim();
      if (transcript.includes(state.wakePhrase)) {
        console.log(`🎤 Wake word detected: "${transcript}"`);
        // Briefly stop wake word detection and start recording
        stopWakeWordDetection();
        startRecording();

        // Auto-stop recording after 8 seconds
        setTimeout(() => {
          if (state.isListening) {
            stopRecording();
            // Restart wake word detection after processing
            setTimeout(() => {
              if (state.wakeWordEnabled) startWakeWordDetection();
            }, 2000);
          }
        }, 8000);

        break;
      }
    }
  };

  state.speechRecognition.onerror = (event) => {
    if (event.error !== 'no-speech' && event.error !== 'aborted') {
      console.error('Speech recognition error:', event.error);
    }
  };

  state.speechRecognition.onend = () => {
    // Restart if still enabled
    if (state.wakeWordEnabled && !state.isListening) {
      setTimeout(() => {
        if (state.wakeWordEnabled) {
          try { state.speechRecognition.start(); } catch { /* already started */ }
        }
      }, 500);
    }
  };

  try {
    state.speechRecognition.start();
    console.log(`🎤 Wake word detection active: "${state.wakePhrase}"`);
  } catch { /* already started */ }
}

function stopWakeWordDetection() {
  if (state.speechRecognition) {
    try { state.speechRecognition.stop(); } catch { /* not started */ }
  }
}

// ── Event Handlers ───────────────────────────────────────────

// Push-to-talk button
talkBtn.addEventListener('mousedown', (e) => {
  e.preventDefault();
  startRecording();
});

talkBtn.addEventListener('mouseup', (e) => {
  e.preventDefault();
  stopRecording();
});

talkBtn.addEventListener('mouseleave', () => {
  if (state.isListening) stopRecording();
});

// Touch support
talkBtn.addEventListener('touchstart', (e) => {
  e.preventDefault();
  startRecording();
});

talkBtn.addEventListener('touchend', (e) => {
  e.preventDefault();
  stopRecording();
});

// Keyboard: Space to talk
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !e.repeat && !isInputFocused()) {
    e.preventDefault();
    startRecording();
  }
});

document.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && !isInputFocused()) {
    e.preventDefault();
    stopRecording();
  }
});

function isInputFocused() {
  const active = document.activeElement;
  return active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
}

// Wake word toggle
wakeWordToggle.addEventListener('click', () => {
  state.wakeWordEnabled = !state.wakeWordEnabled;
  wakeWordToggle.classList.toggle('active', state.wakeWordEnabled);

  if (state.wakeWordEnabled) {
    startWakeWordDetection();
  } else {
    stopWakeWordDetection();
  }
});

// Settings
settingsBtn.addEventListener('click', () => {
  wsUrlInput.value = state.wsUrl;
  wakePhraseInput.value = state.wakePhrase;
  settingsPanel.classList.remove('hidden');
});

settingsClose.addEventListener('click', () => {
  settingsPanel.classList.add('hidden');
});

settingsSave.addEventListener('click', () => {
  state.wsUrl = wsUrlInput.value.trim();
  state.wakePhrase = wakePhraseInput.value.trim().toLowerCase();
  localStorage.setItem('wsUrl', state.wsUrl);
  localStorage.setItem('wakePhrase', state.wakePhrase);
  settingsPanel.classList.add('hidden');
  state.reconnectAttempts = 0;
  connect(); // Reconnect with new URL
});

// ── Keepalive ────────────────────────────────────────────────

setInterval(() => {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: 'ping' }));
  }
}, 30000);

// ── Init ─────────────────────────────────────────────────────

console.log('🚀 Gravity Claw Voice Agent initializing...');
console.log('   Hold Space or click the mic button to talk');
console.log('   Enable "Hey Claw" wake word for hands-free mode');
connect();
