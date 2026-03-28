/**
 * Gravity Claw — JARVIS Voice Agent
 * Browser-side JavaScript for real-time voice interaction.
 *
 * Supports two modes (set by server on connect):
 *   realtime   — AudioWorklet streams PCM16 continuously; server does VAD; audio plays in queue
 *   turn-based — Push-to-talk; sends complete audio blobs; existing behavior
 */

// ── State ────────────────────────────────────────────────────

const state = {
  ws: null,
  wsUrl: localStorage.getItem('wsUrl') || 'ws://localhost:8891',
  wakePhrase: localStorage.getItem('wakePhrase') || 'hey leo',
  mode: 'realtime',           // Set by server on connect
  isConnected: false,
  isListening: false,
  isProcessing: false,
  isSpeaking: false,
  wakeWordEnabled: true,
  // Turn-based recording
  mediaRecorder: null,
  audioChunks: [],
  // Realtime streaming
  audioWorkletNode: null,
  workletReady: false,
  // Audio context & visualizer
  audioContext: null,
  analyser: null,
  micStream: null,
  speechRecognition: null,
  animationFrame: null,
  reconnectTimer: null,
  reconnectAttempts: 0,
  // Audio playback queue (realtime mode — sentences play sequentially)
  audioQueue: [],
  isPlayingQueued: false,
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
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  if (state.ws) {
    state.ws.onclose = null;
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
      state.ws.send(JSON.stringify({ type: 'config', chatId: 0 }));
      console.log('✅ Connected to voice server');
    };

    state.ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        const msg = JSON.parse(event.data);
        handleJsonMessage(msg);
      } else {
        // Binary data — TTS audio chunk
        handleAudioChunk(event.data);
      }
    };

    state.ws.onclose = (event) => {
      state.isConnected = false;
      updateConnectionStatus('disconnected');
      stopRealtimeStreaming();
      console.log(`❌ Disconnected (code: ${event.code})`);
      state.reconnectAttempts++;
      const delay = Math.min(3000 * Math.pow(1.5, state.reconnectAttempts - 1), 30000);
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
  console.log('📩 Message:', msg);
  switch (msg.type) {
    case 'mode':
      state.mode = msg.mode;
      console.log(`🎙️ Voice mode: ${state.mode}`);
      if (state.mode === 'realtime') {
        startRealtimeStreaming();
        updateTalkBtnLabel();
        updateHintText();
        if (state.wakeWordEnabled) {
          stopWakeWordDetection();
          startWakeWordDetection();
        }
        wakeWordToggle.classList.toggle('active', state.wakeWordEnabled);
      }
      break;
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
    // ── Realtime-specific messages ──
    case 'rt_status':
      handleRtStatus(msg.status);
      break;
    case 'rt_transcript':
      if (msg.role === 'user') showUserTranscript(msg.text);
      if (msg.role === 'assistant') showAIResponse(msg.text);
      break;
    case 'rt_subtitle':
      // Live captions: accumulate sentences as AI speaks
      aiResponse.classList.remove('hidden');
      aiResponseText.textContent += (aiResponseText.textContent ? ' ' : '') + msg.text;
      break;
    case 'rt_clear_audio':
      // Flush filler audio from queue before real response starts
      clearAudioQueue();
      break;
    case 'rt_tool':
      showProgress(msg.detail || `${msg.status === 'calling' ? '⚙️' : '✅'} ${msg.name}`);
      break;
    case 'rt_interrupted':
      clearAudioQueue();
      setOrbState('listening');
      break;
    case 'vad':
      if (msg.speaking) {
        clearAudioQueue();   // Stop any remaining audio from previous response
        clearTranscripts();
        setOrbState('listening');
        startVisualizer();
      } else {
        setOrbState('processing');
        stopVisualizer();
      }
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
  switch (status) {
    case 'connected':
    case 'ready':
      state.isProcessing = false;
      state.isSpeaking = false;
      if (!state.audioQueue.length && !state.isPlayingQueued) setOrbState('idle');
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

function handleRtStatus(status) {
  switch (status) {
    case 'thinking':
      state.isProcessing = true;
      setOrbState('processing');
      break;
    case 'speaking':
      state.isSpeaking = true;
      setOrbState('speaking');
      break;
    case 'ready':
      state.isProcessing = false;
      if (!state.isPlayingQueued) {
        state.isSpeaking = false;
        setOrbState('idle');
      }
      break;
    case 'listening':
      setOrbState('listening');
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
    idle: state.mode === 'realtime' ? 'ALWAYS ON' : 'READY',
    listening: 'LISTENING',
    processing: 'THINKING',
    speaking: 'SPEAKING',
  };
  stateLabel.textContent = labels[orbState] || orbState.toUpperCase();
}

function updateHintText() {
  const hint = $('#hint-text');
  if (!hint) return;
  if (state.mode === 'realtime') {
    hint.textContent = 'Say "Hey Leo" to interrupt — or press Space to barge in';
  } else {
    hint.textContent = 'Press and hold Space or the mic button to talk — or enable "Hey Leo" wake word';
  }
}

function updateTalkBtnLabel() {
  const label = talkBtn.querySelector('.talk-label');
  if (label) {
    label.textContent = state.mode === 'realtime' ? 'ALWAYS LISTENING' : 'HOLD TO TALK';
  }
}

function showUserTranscript(text) {
  userTranscriptText.textContent = `"${text}"`;
  userTranscript.classList.remove('hidden');
}

function showProgress(text) {
  stateLabel.textContent = text.slice(0, 50);
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

// ── Realtime Streaming (AudioWorklet + continuous PCM16) ─────

async function startRealtimeStreaming() {
  if (state.audioWorkletNode) return; // Already started

  try {
    const stream = await getOrCreateMicStream();
    const audioCtx = state.audioContext;

    // Register the AudioWorklet module
    await audioCtx.audioWorklet.addModule('pcm-processor.js');

    const workletNode = new AudioWorkletNode(audioCtx, 'pcm-processor');

    workletNode.port.onmessage = (event) => {
      // PCM16 frame ready — send to server for VAD processing
      if (state.ws && state.ws.readyState === WebSocket.OPEN && state.isConnected) {
        state.ws.send(event.data); // ArrayBuffer of Int16 PCM
      }
    };

    // Connect: mic → worklet (capture only, no output)
    const micSource = audioCtx.createMediaStreamSource(stream);
    micSource.connect(workletNode);
    micSource.connect(state.analyser); // Feed analyser so visualizer reacts to mic input
    // Don't connect worklet to destination (we don't want to hear ourselves)

    state.audioWorkletNode = workletNode;
    state.workletReady = true;
    console.log('🎙️ Realtime PCM16 streaming started');
    setOrbState('idle');
  } catch (err) {
    console.error('Failed to start realtime streaming:', err);
    showAIResponse(`⚠️ Microphone error: ${err.message}`);
  }
}

function stopRealtimeStreaming() {
  if (state.audioWorkletNode) {
    state.audioWorkletNode.disconnect();
    state.audioWorkletNode = null;
    state.workletReady = false;
  }
}

// ── Audio Queue (Realtime Mode — sequential sentence playback) ─

function clearAudioQueue() {
  state.audioQueue = [];
  state.isPlayingQueued = false;
  if (state.currentAudioSource) {
    try {
      state.currentAudioSource.onended = null;
      state.currentAudioSource.stop();
    } catch { /* already stopped */ }
    state.currentAudioSource = null;
  }
  if (!state.isListening) {
    state.isSpeaking = false;
    setOrbState('idle');
    stopVisualizer();
  }
}

async function playNextFromQueue() {
  if (state.audioQueue.length === 0) {
    state.isPlayingQueued = false;
    if (!state.isProcessing) {
      state.isSpeaking = false;
      setOrbState('idle');
      if (!state.isListening) stopVisualizer();
    }
    return;
  }

  state.isPlayingQueued = true;
  const nextBuffer = state.audioQueue.shift();

  try {
    if (!state.audioContext) state.audioContext = new AudioContext();
    if (state.audioContext.state === 'suspended') await state.audioContext.resume();

    const audioBuffer = await state.audioContext.decodeAudioData(nextBuffer.slice(0));
    const source = state.audioContext.createBufferSource();
    source.buffer = audioBuffer;

    if (!state.analyser) {
      state.analyser = state.audioContext.createAnalyser();
      state.analyser.fftSize = 256;
    }
    source.connect(state.analyser);
    source.connect(state.audioContext.destination);

    state.currentAudioSource = source;
    state.isSpeaking = true;
    setOrbState('speaking');
    startVisualizer();

    source.onended = () => {
      if (state.currentAudioSource === source) state.currentAudioSource = null;
      playNextFromQueue();
    };

    source.start();
    console.log(`🔊 Playing queued chunk: ${audioBuffer.duration.toFixed(1)}s`);
  } catch (err) {
    console.error('Audio queue playback error:', err);
    playNextFromQueue(); // Skip bad chunk
  }
}

// ── Audio chunk handler ──────────────────────────────────────

function handleAudioChunk(arrayBuffer) {
  if (state.mode === 'realtime') {
    // Queue chunks for sequential playback
    state.audioQueue.push(arrayBuffer);
    if (!state.isPlayingQueued) {
      playNextFromQueue();
    }
  } else {
    // Turn-based: stop current and play immediately (existing behavior)
    handleAudioResponse(arrayBuffer);
  }
}

async function handleAudioResponse(arrayBuffer) {
  try {
    if (!state.audioContext) state.audioContext = new AudioContext();
    if (state.audioContext.state === 'suspended') await state.audioContext.resume();

    if (state.currentAudioSource) {
      try {
        state.currentAudioSource.onended = null;
        state.currentAudioSource.stop();
      } catch { /* already stopped */ }
      state.currentAudioSource = null;
    }

    const audioBuffer = await state.audioContext.decodeAudioData(arrayBuffer.slice(0));
    const source = state.audioContext.createBufferSource();
    source.buffer = audioBuffer;

    if (!state.analyser) {
      state.analyser = state.audioContext.createAnalyser();
      state.analyser.fftSize = 256;
    }
    source.connect(state.analyser);
    source.connect(state.audioContext.destination);

    state.currentAudioSource = source;

    source.onended = () => {
      if (state.currentAudioSource === source) state.currentAudioSource = null;
      if (state.isSpeaking) {
        state.isSpeaking = false;
        setOrbState('idle');
        if (!state.isListening) stopVisualizer();
      }
    };

    source.start();
    state.isSpeaking = true;
    setOrbState('speaking');
    startVisualizer();
    console.log(`🔊 Playing ${audioBuffer.duration.toFixed(1)}s of audio`);
  } catch (err) {
    console.error('Audio playback error:', err);
    state.isSpeaking = false;
    setOrbState('idle');
  }
}

// ── Microphone (shared by both modes) ───────────────────────

async function getOrCreateMicStream() {
  if (state.micStream) return state.micStream;

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

  if (!state.audioContext) {
    state.audioContext = new AudioContext({ sampleRate: 16000 });
  }
  if (state.audioContext.state === 'suspended') {
    await state.audioContext.resume();
  }
  if (!state.analyser) {
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 256;
  }

  // Connect mic to analyser for visualizer (turn-based mode)
  if (state.mode === 'turn-based') {
    const source = state.audioContext.createMediaStreamSource(stream);
    source.connect(state.analyser);
  }

  return stream;
}

// ── Turn-based Recording (push-to-talk) ─────────────────────

async function startRecording() {
  if (state.mode === 'realtime') return; // Push-to-talk disabled in realtime mode
  if (state.isListening || state.isProcessing) return;

  if (state.isSpeaking) {
    if (state.currentAudioSource) {
      state.currentAudioSource.stop();
      state.currentAudioSource = null;
    }
    state.isSpeaking = false;
    setOrbState('idle');
  }

  if (!state.isConnected) return;

  state.isListening = true;
  setOrbState('listening');
  talkBtn.classList.add('active');
  clearTranscripts();

  try {
    const stream = await getOrCreateMicStream();
    if (!state.isListening) return;

    state.audioChunks = [];

    const preferredTypes = [
      'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4',
    ];
    let mimeType = '';
    for (const type of preferredTypes) {
      if (MediaRecorder.isTypeSupported(type)) { mimeType = type; break; }
    }

    state.mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    state.mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) state.audioChunks.push(e.data); };
    state.mediaRecorder.onstop = () => sendAudioBlob();
    state.mediaRecorder.start();
    startVisualizer();
  } catch (err) {
    state.isListening = false;
    setOrbState('idle');
    talkBtn.classList.remove('active');
    showAIResponse(`⚠️ Microphone error: ${err.message}`);
  }
}

function stopRecording() {
  if (!state.isListening || state.mode === 'realtime') return;
  state.isListening = false;
  talkBtn.classList.remove('active');
  if (state.mediaRecorder?.state === 'recording') {
    state.mediaRecorder.requestData();
    state.mediaRecorder.stop();
  }
  stopVisualizer();
}

async function sendAudioBlob() {
  if (state.audioChunks.length === 0) { setOrbState('idle'); return; }

  const blob = new Blob(state.audioChunks, { type: state.mediaRecorder?.mimeType || 'audio/webm' });
  state.audioChunks = [];

  if (blob.size < 1000) { setOrbState('idle'); return; }

  setOrbState('processing');
  const buffer = await blob.arrayBuffer();
  if (state.ws?.readyState === WebSocket.OPEN) {
    state.ws.send(buffer);
  } else {
    showAIResponse('⚠️ Not connected to voice server');
    setOrbState('idle');
  }
}

// ── Barge-in (realtime mode) ─────────────────────────────────

function triggerBargeIn() {
  if (state.mode !== 'realtime' || !state.isConnected) return;
  if (!state.isSpeaking && !state.isProcessing) return;

  console.log('🛑 Barge-in triggered');
  clearAudioQueue();

  if (state.ws?.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: 'interrupt' }));
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

    const avg = dataArray.reduce((a, b) => a + b, 0) / bufferLength;
    const normalizedAvg = avg / 255;

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
        stopWakeWordDetection();
        if (state.mode === 'turn-based') {
          startRecording();
          setTimeout(() => {
            if (state.isListening) {
              stopRecording();
              setTimeout(() => { if (state.wakeWordEnabled) startWakeWordDetection(); }, 2000);
            }
          }, 8000);
        } else {
          // In realtime mode, wake word triggers barge-in
          stateLabel.textContent = 'HEY LEO';
          triggerBargeIn();
          setTimeout(() => { if (state.wakeWordEnabled) startWakeWordDetection(); }, 1000);
        }
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
  } catch { /* already started */ }
}

function stopWakeWordDetection() {
  if (state.speechRecognition) {
    try { state.speechRecognition.stop(); } catch { /* not started */ }
  }
}

// ── Event Handlers ───────────────────────────────────────────

// Push-to-talk (only active in turn-based mode)
talkBtn.addEventListener('mousedown', (e) => { e.preventDefault(); startRecording(); });
talkBtn.addEventListener('mouseup', (e) => { e.preventDefault(); stopRecording(); });
talkBtn.addEventListener('mouseleave', () => { if (state.isListening) stopRecording(); });
talkBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startRecording(); });
talkBtn.addEventListener('touchend', (e) => { e.preventDefault(); stopRecording(); });

// Space: push-to-talk (turn-based) or barge-in (realtime)
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !e.repeat && !isInputFocused()) {
    e.preventDefault();
    if (state.mode === 'realtime') {
      triggerBargeIn();
    } else {
      startRecording();
    }
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
  if (state.wakeWordEnabled) startWakeWordDetection();
  else stopWakeWordDetection();
});

// Settings
settingsBtn.addEventListener('click', () => {
  wsUrlInput.value = state.wsUrl;
  wakePhraseInput.value = state.wakePhrase;
  settingsPanel.classList.remove('hidden');
});

settingsClose.addEventListener('click', () => settingsPanel.classList.add('hidden'));

settingsSave.addEventListener('click', () => {
  state.wsUrl = wsUrlInput.value.trim();
  state.wakePhrase = wakePhraseInput.value.trim().toLowerCase();
  localStorage.setItem('wsUrl', state.wsUrl);
  localStorage.setItem('wakePhrase', state.wakePhrase);
  settingsPanel.classList.add('hidden');
  stopRealtimeStreaming();
  state.reconnectAttempts = 0;
  connect();
});

// Keepalive
setInterval(() => {
  if (state.ws?.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: 'ping' }));
  }
}, 30000);

// ── Init ─────────────────────────────────────────────────────

console.log('🚀 Gravity Claw Voice Agent initializing...');
console.log('   Realtime mode: just speak — VAD detects your voice automatically');
console.log('   Turn-based mode: hold Space or the mic button to talk');
connect();
