const audioUpload = document.getElementById('audio-upload');
const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');
const audioPlayerContainer = document.getElementById('audio-player-container');
const toggleBtn = document.getElementById('toggle-btn');
const speedBtn = document.getElementById('speed-btn');

let audioPlayer = null; // Dynamically created for each file
let audioContext = null, analyser = null, source = null, dataArray = null, bufferLength = null;
let animationId = null;
let currentUrl = null;
let speeds = [1, 1.5, 2, 0.5];
let speedIndex = 0;
const BASS = [20, 250];
const MID = [251, 2000];
const HIGH = [2001, 9000];
const VOCALS = [300, 3000];

// Beat pulse variables
let lastBeatValue = 0;
let beatDetected = false;
let lastBeatTime = 0;

// --- Clean up everything for new file ---
function cleanup() {
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
    if (audioPlayer) {
        audioPlayer.pause();
        audioPlayer.src = "";
        audioPlayer.remove();
        audioPlayer = null;
    }
    if (source) {
        try { source.disconnect(); } catch {}
        source = null;
    }
    if (analyser) {
        try { analyser.disconnect(); } catch {}
        analyser = null;
    }
    if (audioContext) {
        try { audioContext.close(); } catch {}
        audioContext = null;
    }
    if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
        currentUrl = null;
    }
    dataArray = null;
    bufferLength = null;
    lastBeatValue = 0;
    beatDetected = false;
    lastBeatTime = 0;
    // Reset time left display
    updateTimeLeftDisplay(0, 0);
}

// --- File upload and song switching ---
audioUpload.addEventListener('change', function() {
    const file = this.files[0];
    if (file) {
        cleanup();

        currentUrl = URL.createObjectURL(file);

        // Create a new audio element each time
        audioPlayer = document.createElement('audio');
        audioPlayer.setAttribute('id', 'audio-player');
        audioPlayer.style.display = 'none';
        audioPlayerContainer.prepend(audioPlayer);

        audioPlayer.src = currentUrl;
        audioPlayer.load();

        audioPlayer.oncanplay = () => {
            setupAudioContext();
            audioPlayer.play();
        };

        setupCustomControls();
        setupTimeLeftDisplay();
    }
    audioUpload.value = ""; // allow re-upload of same file
});

// --- Custom controls ---
function setupCustomControls() {
    toggleBtn.onclick = () => {
        if (!audioPlayer) return;
        if (audioPlayer.paused) {
            audioPlayer.play();
        } else {
            audioPlayer.pause();
        }
    };
    speedBtn.onclick = () => {
        if (!audioPlayer) return;
        speedIndex = (speedIndex + 1) % speeds.length;
        audioPlayer.playbackRate = speeds[speedIndex];
        speedBtn.textContent = `Speed: ${speeds[speedIndex]}x`;
    };
    // Always update speed button to match playback rate
    if (audioPlayer) {
        audioPlayer.playbackRate = speeds[speedIndex];
        speedBtn.textContent = `Speed: ${speeds[speedIndex]}x`;
    }
}

// Update Play/Pause button label
function updateToggleBtn() {
    if (!audioPlayer) return;
    toggleBtn.textContent = audioPlayer.paused ? 'Play' : 'Pause';
}

// --- Audio context and analyser setup ---
function setupAudioContext() {
    if (!audioPlayer) return;
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);

    source = audioContext.createMediaElementSource(audioPlayer);
    source.connect(analyser);
    analyser.connect(audioContext.destination);

    audioPlayer.onplay = () => {
        if (audioContext.state === 'suspended') audioContext.resume();
        if (!animationId) startVisualizer();
        updateToggleBtn();
    };
    audioPlayer.onpause = () => {
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
        updateToggleBtn();
    };
    audioPlayer.onseeked = () => {
        if (audioContext.state === 'suspended') audioContext.resume();
        if (!animationId && !audioPlayer.paused) startVisualizer();
    };

    // Initial button label
    updateToggleBtn();

    // Start visualizer if playing
    if (!audioPlayer.paused) startVisualizer();
}

// --- Frequency helpers ---
function freqToBin(freq) {
    if (!audioContext) return 0;
    const nyquist = audioContext.sampleRate / 2;
    return Math.round(freq / nyquist * bufferLength);
}
function getAvgInBand(data, band) {
    const [low, high] = band.map(freqToBin);
    let sum = 0, count = 0;
    for (let i = low; i <= high; i++) {
        sum += data[i];
        count++;
    }
    return count ? sum / count : 0;
}

// --- Frequency line visualizer (mirrored horizontally, background) ---
function drawFrequencyLine(data) {
    ctx.save();
    ctx.globalAlpha = 0.25; // transparent for "behind" effect
    ctx.strokeStyle = "#00fff7";
    ctx.lineWidth = 3;

    // Main (left-to-right) frequency line
    ctx.beginPath();
    const len = data.length;
    const height = canvas.height - 30;
    const xStep = canvas.width / len;

    for (let i = 0; i < len; i++) {
        const value = data[i] / 255;
        const y = height - value * (height - 40);
        const x = i * xStep;
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.stroke();

    // Mirrored (right-to-left) frequency line
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
        const value = data[i] / 255;
        const y = height - value * (height - 40);
        const x = canvas.width - 1 - (i * xStep);
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.stroke();

    ctx.restore();
}

// --- Beat detection (just for pulse effect, no tempo) ---
function detectBeat(bass, time) {
    const threshold = 120; // Sensitivity threshold (tweak as needed)
    const minInterval = 0.2; // Minimum seconds between beats

    // Rising edge detection
    if (
        bass > threshold &&
        lastBeatValue <= threshold &&
        (time - lastBeatTime) > minInterval
    ) {
        lastBeatTime = time;
        beatDetected = true;
    } else {
        beatDetected = false;
    }
    lastBeatValue = bass;
}

// --- Visualizer loop ---
function startVisualizer() {
    function visualize() {
        if (!analyser || !audioPlayer || audioPlayer.paused) return;
        animationId = requestAnimationFrame(visualize);
        analyser.getByteFrequencyData(dataArray);

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw frequency line in the background (mirrored horizontally)
        drawFrequencyLine(dataArray);

        // Calculate band averages
        const overall = getAvgInBand(dataArray, [20, 9000]);
        const bass = getAvgInBand(dataArray, BASS);
        const mid = getAvgInBand(dataArray, MID);
        const high = getAvgInBand(dataArray, HIGH);
        const vocals = getAvgInBand(dataArray, VOCALS);

        // --- Beat detection ---
        const now = audioPlayer.currentTime;
        detectBeat(bass, now);

        // Bar visualizers
        const barWidth = 100;
        const startX = 80;
        const gap = 180;

        drawBar(startX + 0 * gap, canvas.height - 60, barWidth, overall, '#4caf50', "Volume");
        drawBar(startX + 1 * gap, canvas.height - 60, barWidth, bass, '#2196f3', "Bass");
        drawBar(startX + 2 * gap, canvas.height - 60, barWidth, high, '#ff9800', "Percussion");
        drawBar(startX + 3 * gap, canvas.height - 60, barWidth, mid, '#9c27b0', "Instruments");
        drawBar(startX + 4 * gap, canvas.height - 60, barWidth, vocals, '#e91e63', "Vocals");
        
        // --- Circle visualizer (beat pulse only) ---
        drawBeatCircle(startX + 5 * gap + 90, canvas.height - 110, beatDetected, bass);

        // White flash for strong beats
        if (bass > 170 || overall > 180) {
            ctx.save();
            ctx.globalAlpha = 0.3;
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.restore();
        }

        // --- Update time left display ---
        updateTimeLeftDisplay(
            audioPlayer.duration || 0,
            audioPlayer.currentTime || 0
        );
    }
    if (animationId) cancelAnimationFrame(animationId);
    animationId = requestAnimationFrame(visualize);
}

function drawBar(x, y, width, value, color, label) {
    const height = Math.max(10, value * 1.5);
    ctx.save();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 15;
    ctx.fillRect(x, y - height, width, height);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff";
    ctx.font = "18px Arial";
    ctx.textAlign = "center";
    ctx.fillText(label, x + width / 2, y + 24);
    ctx.restore();
}

// --- Beat circle visualizer (pulse only, no BPM) ---
function drawBeatCircle(cx, cy, isBeat, bass) {
    // The radius is a mix of bass and a pulse effect
    // On beat, the circle expands rapidly and then shrinks back (using a simple decay)
    let baseRadius = 40 + (bass / 2.5);
    // Add a pulse for the beat
    let pulse = 0;
    if (isBeat) {
        pulse = 30;
        drawBeatCircle.lastPulseTime = performance.now();
    }
    // Decay the pulse
    if (drawBeatCircle.lastPulseTime) {
        pulse -= (performance.now() - drawBeatCircle.lastPulseTime) * 0.15;
        if (pulse < 0) pulse = 0;
    }
    let radius = baseRadius + pulse;

    ctx.save();
    ctx.globalAlpha = 0.7;
    let gradient = ctx.createRadialGradient(cx, cy, radius * 0.3, cx, cy, radius);
    gradient.addColorStop(0, "#ffffbb");
    gradient.addColorStop(0.35, "#ffe44e");
    gradient.addColorStop(1, "#ff9800");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#ff9800";
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
    ctx.stroke();

    // Draw "BEAT" label
    ctx.fillStyle = "#fff";
    ctx.font = "bold 22px Arial";
    ctx.textAlign = "center";
    ctx.fillText("BEAT", cx, cy + 10);

    ctx.restore();
}
drawBeatCircle.lastPulseTime = 0;

// --- Time Left Display ---
function setupTimeLeftDisplay() {
    let timeLeftDiv = document.getElementById('time-left-display');
    if (!timeLeftDiv) {
        timeLeftDiv = document.createElement('div');
        timeLeftDiv.id = 'time-left-display';
        timeLeftDiv.style.position = 'fixed';
        timeLeftDiv.style.left = '0';
        timeLeftDiv.style.bottom = '10px';
        timeLeftDiv.style.width = '100%';
        timeLeftDiv.style.textAlign = 'center';
        timeLeftDiv.style.fontSize = '20px';
        timeLeftDiv.style.color = '#fff';
        timeLeftDiv.style.textShadow = '0 2px 6px #000b';
        timeLeftDiv.style.pointerEvents = 'none';
        document.body.appendChild(timeLeftDiv);
    }
    // Set initial value
    updateTimeLeftDisplay(0, 0);
}

// Call this every frame with duration and currentTime
function updateTimeLeftDisplay(duration, currentTime) {
    let timeLeftDiv = document.getElementById('time-left-display');
    if (!timeLeftDiv) return;
    let timeLeft = Math.max(0, duration - currentTime);
    timeLeftDiv.textContent = `Time left: ${formatTime(timeLeft)}`;
}

function formatTime(t) {
    if (!isFinite(t) || t < 0) t = 0;
    let m = Math.floor(t / 60);
    let s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}