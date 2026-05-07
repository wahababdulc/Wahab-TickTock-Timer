/**
 * ChronoCanvas - Shared Application Logic
 * 
 * This file contains logic for all pages. It uses feature detection 
 * to determine which code to run (e.g. only running clock code if the clock exists).
 */

// ==========================================
// 0. Global Mobile Audio Unlock
// ==========================================
window.globalAudioCtx = null;
const globalAudioUnlock = () => {
    if (!window.globalAudioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) window.globalAudioCtx = new AudioContext();
    }
    if (window.globalAudioCtx && window.globalAudioCtx.state === 'suspended') {
        window.globalAudioCtx.resume();
    }
    // Play a silent oscillator to fully unlock
    if (window.globalAudioCtx) {
        const osc = window.globalAudioCtx.createOscillator();
        const gain = window.globalAudioCtx.createGain();
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(window.globalAudioCtx.destination);
        osc.start();
        osc.stop(window.globalAudioCtx.currentTime + 0.01);
    }
    document.removeEventListener('touchstart', globalAudioUnlock);
    document.removeEventListener('click', globalAudioUnlock);
};
document.addEventListener('touchstart', globalAudioUnlock, { once: true });
document.addEventListener('click', globalAudioUnlock, { once: true });

// ==========================================
// 1. Global Theme Logic
// ==========================================
const themeSelector = document.getElementById('theme-selector');

/**
 * Applies the selected theme and saves it to localStorage.
 * @param {string} themeName - The CSS class name of the theme
 */
const applyTheme = (themeName) => {
    // Overwrite the body className to switch themes cleanly
    document.body.className = themeName;
    // Persist choice so it survives page reloads and navigation
    localStorage.setItem('chronoCanvasTheme', themeName);
};

/**
 * Initializes the theme based on past selections on page load.
 */
const initializeTheme = () => {
    const savedTheme = localStorage.getItem('chronoCanvasTheme') || 'theme-minimalist';
    // If the selector exists on the page, sync it
    if (themeSelector) {
        themeSelector.value = savedTheme;
    }
    applyTheme(savedTheme);
};

// Listen for theme changes from the UI
if (themeSelector) {
    // Using ES6 arrow function to handle the change event cleanly
    themeSelector.addEventListener('change', (e) => applyTheme(e.target.value));
}

// Fire the theme setup immediately on all pages!
initializeTheme();

// ==========================================
// 2. Main Clock Logic (index.html)
// ==========================================
const hoursElement = document.getElementById('hours');

// Feature detection: only run this if we are on the Home page
if (hoursElement) {
    const minutesElement = document.getElementById('minutes');
    const secondsElement = document.getElementById('seconds');
    const periodElement = document.getElementById('period');
    
    const dayNameElement = document.getElementById('day-name');
    const monthElement = document.getElementById('month');
    const dayNumberElement = document.getElementById('day-number');
    const yearElement = document.getElementById('year');

    // Utility: Pad numbers with zero (e.g., 9 -> '09') using string methods
    const padZero = (num) => num.toString().padStart(2, '0');

    // --- IndexedDB for Custom Audio ---
    const DB_NAME = 'ChronoCanvasDB';
    const STORE_NAME = 'AudioStore';
    
    const initDB = () => {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };
        });
    };

    const saveAudioToDB = async (blob) => {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.put(blob, 'customAlarm');
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    };

    const loadAudioFromDB = async () => {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.get('customAlarm');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    };
    
    // Request Notification Permission on load
    if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
        Notification.requestPermission();
    }

    // --- Alarm Logic ---
    const alarmTimeInput = document.getElementById('alarm-time');
    const alarmToneSelect = document.getElementById('alarm-tone');
    const customAudioInput = document.getElementById('custom-audio-input');
    const alarmBtn = document.getElementById('alarm-btn');
    const alarmStatus = document.getElementById('alarm-status');
    const clockWrapper = document.querySelector('.clock-wrapper');
    
    let alarmTime = localStorage.getItem('alarmTime') || null;
    let alarmTone = localStorage.getItem('alarmTone') || 'beep';
    let isAlarmRinging = false;
    let alarmInterval = null;
    let autoShutoffTimeout = null;
    let customAudioElement = null;

    // Initialize UI on load if alarm is set
    if (alarmTime) {
        alarmTimeInput.value = alarmTime;
        alarmToneSelect.value = alarmTone;
        if (alarmTone === 'custom') customAudioInput.style.display = 'block';
        alarmBtn.textContent = 'Clear Alarm';
        const [hours, mins] = alarmTime.split(':');
        const displayHours = (parseInt(hours) % 12) || 12;
        const period = parseInt(hours) >= 12 ? 'PM' : 'AM';
        alarmStatus.textContent = `Alarm set for ${displayHours}:${mins} ${period}`;
    }

    alarmToneSelect.addEventListener('change', (e) => {
        customAudioInput.style.display = e.target.value === 'custom' ? 'block' : 'none';
    });

    customAudioInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            await saveAudioToDB(file);
            alert('Custom audio saved successfully!');
        }
    });

    const setupShutoff = () => {
        // 3-Minute Auto Shutoff (180,000 ms)
        if (autoShutoffTimeout) clearTimeout(autoShutoffTimeout);
        autoShutoffTimeout = setTimeout(() => {
            if (isAlarmRinging) {
                if (typeof window.stopTone === 'function') window.stopTone();
                alarmTime = null;
                localStorage.removeItem('alarmTime');
                alarmBtn.textContent = 'Set Alarm';
                alarmStatus.textContent = 'Alarm auto-cleared';
            }
        }, 180000);
    };

    window.playTone = async (type) => {
        if (alarmInterval) clearInterval(alarmInterval);

        if (type === 'custom') {
            try {
                const blob = await loadAudioFromDB();
                if (blob) {
                    const url = URL.createObjectURL(blob);
                    customAudioElement = new Audio(url);
                    customAudioElement.loop = true;
                    customAudioElement.play().catch(e => console.log('Audio play failed:', e));
                    return setupShutoff(); // Skip audioCtx if custom plays successfully
                }
            } catch (e) {
                console.error('Failed to load custom audio, falling back to beep');
            }
            type = 'beep'; // Fallback
        }

        if (!window.globalAudioCtx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) window.globalAudioCtx = new AudioContext();
        }
        if (window.globalAudioCtx && window.globalAudioCtx.state === 'suspended') {
            window.globalAudioCtx.resume();
        }

        const triggerSound = () => {
            if (!window.globalAudioCtx) return;
            const osc = window.globalAudioCtx.createOscillator();
            const gain = window.globalAudioCtx.createGain();
            osc.connect(gain);
            gain.connect(window.globalAudioCtx.destination);
            
            if (type === 'beep') {
                osc.type = 'square';
                osc.frequency.setValueAtTime(880, window.globalAudioCtx.currentTime);
                gain.gain.setValueAtTime(0.1, window.globalAudioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, window.globalAudioCtx.currentTime + 0.1);
                osc.start();
                osc.stop(window.globalAudioCtx.currentTime + 0.1);
            } else if (type === 'chime') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(1046.50, window.globalAudioCtx.currentTime);
                gain.gain.setValueAtTime(0.3, window.globalAudioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, window.globalAudioCtx.currentTime + 1.5);
                osc.start();
                osc.stop(window.globalAudioCtx.currentTime + 1.5);
            } else if (type === 'siren') {
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(400, window.globalAudioCtx.currentTime);
                osc.frequency.linearRampToValueAtTime(800, window.globalAudioCtx.currentTime + 0.4);
                gain.gain.setValueAtTime(0.1, window.globalAudioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, window.globalAudioCtx.currentTime + 0.5);
                osc.start();
                osc.stop(window.globalAudioCtx.currentTime + 0.5);
            }
        };

        triggerSound();
        const intervalTime = type === 'beep' ? 500 : (type === 'chime' ? 2000 : 600);
        alarmInterval = setInterval(triggerSound, intervalTime);
        setupShutoff();
    };

    window.stopTone = () => {
        isAlarmRinging = false;
        if (alarmInterval) {
            clearInterval(alarmInterval);
            alarmInterval = null;
        }
        if (customAudioElement) {
            customAudioElement.pause();
            customAudioElement.currentTime = 0;
            customAudioElement = null;
        }
        if (autoShutoffTimeout) {
            clearTimeout(autoShutoffTimeout);
            autoShutoffTimeout = null;
        }
        clockWrapper.classList.remove('alarm-active-ring');
    };

    alarmBtn.addEventListener('click', () => {
        if (isAlarmRinging) {
            // Cancel ringing
            if (typeof window.stopTone === 'function') window.stopTone();
            alarmTime = null;
            localStorage.removeItem('alarmTime');
            localStorage.removeItem('lastRungDate');
            alarmBtn.textContent = 'Set Alarm';
            alarmStatus.textContent = 'Alarm cancelled';
            return;
        }

        if (alarmTime) {
            // Unset alarm
            alarmTime = null;
            localStorage.removeItem('alarmTime');
            localStorage.removeItem('lastRungDate');
            alarmBtn.textContent = 'Set Alarm';
            alarmStatus.textContent = 'Alarm cleared';
        } else {
            // Set alarm
            if (!alarmTimeInput.value) {
                alarmStatus.textContent = 'Please select a time!';
                return;
            }
            alarmTime = alarmTimeInput.value;
            alarmTone = alarmToneSelect.value;
            localStorage.setItem('alarmTime', alarmTime);
            localStorage.setItem('alarmTone', alarmTone);
            localStorage.removeItem('lastRungDate');
            
            alarmBtn.textContent = 'Clear Alarm';
            const [hours, mins] = alarmTime.split(':');
            const displayHours = (parseInt(hours) % 12) || 12;
            const period = parseInt(hours) >= 12 ? 'PM' : 'AM';
            alarmStatus.textContent = `Alarm set for ${displayHours}:${mins} ${period}`;
            
            // --- Mobile Browser Audio Unlock Workaround ---
            globalAudioUnlock(); // Ensure audio is unlocked

            // 2. Unlock HTML5 Audio (for custom music)
            if (!customAudioElement) {
                customAudioElement = new Audio();
            }
            // Silent base64 WAV to force browser to grant audio playback rights
            customAudioElement.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
            customAudioElement.play().then(() => {
                customAudioElement.pause();
            }).catch(e => console.log('Audio unlock skipped:', e));
        }
    });


    // --- End Alarm Logic ---

    const updateClock = () => {
        // Advanced Date manipulation
        const now = new Date();
        
        let hours = now.getHours();
        const minutes = now.getMinutes();
        const seconds = now.getSeconds();
        
        const isPM = hours >= 12;
        
        // Convert to 12-hour format cleanly
        hoursElement.textContent = padZero(hours % 12 || 12);
        minutesElement.textContent = padZero(minutes);
        secondsElement.textContent = padZero(seconds);
        periodElement.textContent = isPM ? 'PM' : 'AM';
        
        // ES6 Intl API for robust and localized date string formatting
        dayNameElement.textContent = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(now);
        monthElement.textContent = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(now);
        dayNumberElement.textContent = now.getDate();
        yearElement.textContent = now.getFullYear();
    };

    // Run once immediately to avoid 1-second delay, then set interval
    updateClock();
    setInterval(updateClock, 1000);

    // --- 3D Parallax Tilt Card Logic ---
    const tiltCard = document.getElementById('tilt-card');
    const glare = document.getElementById('glare');
    
    if (tiltCard && glare) {
        tiltCard.addEventListener('mousemove', (e) => {
            const rect = tiltCard.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            
            const maxRotate = 15;
            const rotateX = ((y - centerY) / centerY) * -maxRotate;
            const rotateY = ((x - centerX) / centerX) * maxRotate;
            
            tiltCard.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`;
            
            const glareX = (x / rect.width) * 100;
            const glareY = (y / rect.height) * 100;
            glare.style.background = `radial-gradient(circle at ${glareX}% ${glareY}%, rgba(255, 255, 255, 0.5) 0%, rgba(255, 255, 255, 0) 60%)`;
        });
        
        tiltCard.addEventListener('mouseleave', () => {
            tiltCard.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)`;
            tiltCard.style.transition = 'transform 0.5s ease-out';
        });
        
        tiltCard.addEventListener('mouseenter', () => {
            tiltCard.style.transition = 'transform 0.1s ease-out';
        });
        
        // Auto-hide like a sunset after 4 seconds and enter Swimming Mode
        setTimeout(() => {
            const heroContainer = document.querySelector('.hero-image-container');
            if (heroContainer) {
                heroContainer.classList.add('sunset-hide');
            }
            // Trigger Swimming Mode globally
            document.body.classList.add('swim-mode');
        }, 4000);
    }

}

// ==========================================
// 3. Stopwatch & Timer Logic (stopwatch.html)
// ==========================================
const swDisplay = document.getElementById('stopwatch-display');

// Feature detection: only run this if we are on the Stopwatch page
if (swDisplay) {
    
    /* --- 3A. Persistent Stopwatch Logic --- */
    let swInterval;
    let swStartTime = parseInt(localStorage.getItem('swStartTime')) || 0;
    let swElapsedTime = parseInt(localStorage.getItem('swElapsedTime')) || 0;
    let isSwRunning = localStorage.getItem('isSwRunning') === 'true';
    
    // Format ms into MM:SS.ms format
    const formatSW = (timeMs) => {
        const date = new Date(timeMs);
        const m = date.getUTCMinutes().toString().padStart(2, '0');
        const s = date.getUTCSeconds().toString().padStart(2, '0');
        const ms = Math.floor(date.getUTCMilliseconds() / 10).toString().padStart(2, '0');
        return `${m}:${s}.${ms}`;
    };

    const runSwInterval = () => {
        if (swInterval) clearInterval(swInterval);
        swInterval = setInterval(() => {
            swElapsedTime = Date.now() - swStartTime;
            swDisplay.textContent = formatSW(swElapsedTime);
            localStorage.setItem('swElapsedTime', swElapsedTime);
        }, 50);
    };

    if (isSwRunning) {
        swDisplay.classList.add('active-timer');
        runSwInterval();
    } else {
        swDisplay.textContent = formatSW(swElapsedTime);
    }

    document.getElementById('sw-start').addEventListener('click', () => {
        if (!isSwRunning) {
            isSwRunning = true;
            localStorage.setItem('isSwRunning', 'true');
            swStartTime = Date.now() - swElapsedTime;
            localStorage.setItem('swStartTime', swStartTime);
            runSwInterval();
            swDisplay.classList.add('active-timer');
        }
    });

    document.getElementById('sw-stop').addEventListener('click', () => {
        isSwRunning = false;
        localStorage.setItem('isSwRunning', 'false');
        clearInterval(swInterval);
        swDisplay.classList.remove('active-timer');
    });

    document.getElementById('sw-reset').addEventListener('click', () => {
        isSwRunning = false;
        clearInterval(swInterval);
        swElapsedTime = 0;
        localStorage.setItem('isSwRunning', 'false');
        localStorage.setItem('swElapsedTime', '0');
        localStorage.setItem('swStartTime', '0');
        swDisplay.textContent = "00:00.00";
        swDisplay.classList.remove('active-timer');
    });

    /* --- 3B. Persistent Countdown Timer Logic --- */
    const timerDisplay = document.getElementById('timer-display');
    const inputM = document.getElementById('timer-m');
    const inputS = document.getElementById('timer-s');
    
    let timerInterval;
    let timerTargetTime = parseInt(localStorage.getItem('timerTargetTime')) || 0;
    let timerRemaining = parseInt(localStorage.getItem('timerRemaining')) || 0;
    let isTimerRunning = localStorage.getItem('isTimerRunning') === 'true';

    const formatTimer = (totalSeconds) => {
        const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
        const s = (totalSeconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };

    const runTimerInterval = () => {
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            timerRemaining = Math.max(0, Math.ceil((timerTargetTime - Date.now()) / 1000));
            timerDisplay.textContent = formatTimer(timerRemaining);
            localStorage.setItem('timerRemaining', timerRemaining);
            
            if (timerRemaining <= 0) {
                clearInterval(timerInterval);
                isTimerRunning = false;
                localStorage.setItem('isTimerRunning', 'false');
                timerDisplay.classList.remove('active-timer');
                timerDisplay.textContent = "00:00";
                alert("Time's up! Great job!");
            }
        }, 1000);
    };

    if (isTimerRunning) {
        timerDisplay.classList.add('active-timer');
        runTimerInterval();
    } else {
        timerDisplay.textContent = formatTimer(timerRemaining);
    }

    document.getElementById('timer-start').addEventListener('click', () => {
        if (!isTimerRunning) {
            if (timerRemaining === 0) {
                const mins = parseInt(inputM.value) || 0;
                const secs = parseInt(inputS.value) || 0;
                timerRemaining = (mins * 60) + secs;
            }
            if (timerRemaining > 0) {
                isTimerRunning = true;
                timerTargetTime = Date.now() + (timerRemaining * 1000);
                localStorage.setItem('timerTargetTime', timerTargetTime);
                localStorage.setItem('isTimerRunning', 'true');
                timerDisplay.classList.add('active-timer');
                timerDisplay.textContent = formatTimer(timerRemaining);
                runTimerInterval();
            }
        }
    });

    document.getElementById('timer-stop').addEventListener('click', () => {
        isTimerRunning = false;
        localStorage.setItem('isTimerRunning', 'false');
        timerRemaining = Math.max(0, Math.ceil((timerTargetTime - Date.now()) / 1000));
        localStorage.setItem('timerRemaining', timerRemaining);
        clearInterval(timerInterval);
        timerDisplay.classList.remove('active-timer');
    });

    document.getElementById('timer-reset').addEventListener('click', () => {
        isTimerRunning = false;
        clearInterval(timerInterval);
        timerRemaining = 0;
        localStorage.setItem('isTimerRunning', 'false');
        localStorage.setItem('timerRemaining', '0');
        localStorage.setItem('timerTargetTime', '0');
        timerDisplay.textContent = "00:00";
        timerDisplay.classList.remove('active-timer');
        inputM.value = '';
        inputS.value = '';
    });

    /* --- 3C. Persistent Study Focus Tracker Logic --- */
    const STUDY_MINS = 25;
    const BREAK_MINS = 5;
    let studyInterval;
    let studyTargetTime = parseInt(localStorage.getItem('studyTargetTime')) || 0;
    let studyRemaining = parseInt(localStorage.getItem('studyRemaining')) || (STUDY_MINS * 60);
    let isStudyRunning = localStorage.getItem('isStudyRunning') === 'true';
    let isStudyMode = localStorage.getItem('isStudyMode') !== 'false';
    let completedSessions = parseInt(localStorage.getItem('completedSessions')) || 0;

    const studyDisplay = document.getElementById('study-display');
    const studyIndicator = document.getElementById('study-mode-indicator');
    const sessionDots = document.getElementById('session-dots').children;

    const playStudyChime = () => {
        if (!window.globalAudioCtx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) window.globalAudioCtx = new AudioContext();
        }
        if (window.globalAudioCtx && window.globalAudioCtx.state === 'suspended') {
            window.globalAudioCtx.resume();
        }
        if (!window.globalAudioCtx) return;
        
        const ctx = window.globalAudioCtx;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1046.50, ctx.currentTime);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.5);
        osc.start();
        osc.stop(ctx.currentTime + 1.5);
    };

    const updateStudyDisplay = () => {
        studyDisplay.textContent = formatTimer(studyRemaining);
        studyIndicator.textContent = isStudyMode ? 'Study Time' : 'Break Time';
        studyIndicator.className = isStudyMode ? 'mode-indicator mode-study' : 'mode-indicator mode-break';
        
        // Restore dots
        Array.from(sessionDots).forEach((dot, index) => {
            if (index < completedSessions) dot.classList.add('completed');
            else dot.classList.remove('completed');
        });
        
        if (isStudyRunning) {
            document.getElementById('study-start').textContent = 'Pause';
        } else {
            document.getElementById('study-start').textContent = isStudyMode ? (studyRemaining < STUDY_MINS*60 ? 'Resume Focus' : 'Start Focus') : (studyRemaining < BREAK_MINS*60 ? 'Resume Break' : 'Start Break');
        }

        // --- SYNC ZEN MODE ---
        if (typeof window.toggleZenMode === 'function') window.toggleZenMode(isStudyMode && isStudyRunning);
    };

    const runStudyInterval = () => {
        if (studyInterval) clearInterval(studyInterval);
        studyInterval = setInterval(() => {
            studyRemaining = Math.max(0, Math.ceil((studyTargetTime - Date.now()) / 1000));
            studyDisplay.textContent = formatTimer(studyRemaining);
            localStorage.setItem('studyRemaining', studyRemaining);

            if (studyRemaining <= 0) {
                playStudyChime();
                if (isStudyMode) {
                    isStudyMode = false;
                    studyRemaining = BREAK_MINS * 60;
                    if (completedSessions < sessionDots.length) {
                        completedSessions++;
                        localStorage.setItem('completedSessions', completedSessions);
                    }
                } else {
                    isStudyMode = true;
                    studyRemaining = STUDY_MINS * 60;
                }
                localStorage.setItem('isStudyMode', isStudyMode);
                localStorage.setItem('studyRemaining', studyRemaining);
                
                isStudyRunning = false;
                localStorage.setItem('isStudyRunning', 'false');
                clearInterval(studyInterval);
                updateStudyDisplay();
                studyDisplay.classList.remove('active-timer');
            }
        }, 1000);
    };

    if (isStudyRunning) {
        studyDisplay.classList.add('active-timer');
        runStudyInterval();
    }
    updateStudyDisplay();

    document.getElementById('study-start').addEventListener('click', () => {
        if (!isStudyRunning) {
            isStudyRunning = true;
            localStorage.setItem('isStudyRunning', 'true');
            studyTargetTime = Date.now() + (studyRemaining * 1000);
            localStorage.setItem('studyTargetTime', studyTargetTime);
            studyDisplay.classList.add('active-timer');
            updateStudyDisplay();
            runStudyInterval();
        } else {
            isStudyRunning = false;
            localStorage.setItem('isStudyRunning', 'false');
            studyRemaining = Math.max(0, Math.ceil((studyTargetTime - Date.now()) / 1000));
            localStorage.setItem('studyRemaining', studyRemaining);
            clearInterval(studyInterval);
            studyDisplay.classList.remove('active-timer');
            updateStudyDisplay();
        }
    });

    document.getElementById('study-reset').addEventListener('click', () => {
        isStudyRunning = false;
        clearInterval(studyInterval);
        isStudyMode = true;
        studyRemaining = STUDY_MINS * 60;
        completedSessions = 0;
        
        localStorage.setItem('isStudyRunning', 'false');
        localStorage.setItem('isStudyMode', 'true');
        localStorage.setItem('studyRemaining', studyRemaining);
        localStorage.setItem('completedSessions', '0');
        localStorage.setItem('studyTargetTime', '0');
        
        studyDisplay.classList.remove('active-timer');
        updateStudyDisplay();
    });
}

// ==========================================
// 4. Magic Canvas Background Animation
// ==========================================
const canvas = document.getElementById('magic-canvas');
if (canvas) {
    const ctx = canvas.getContext('2d');
    let particlesArray = [];
    
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    });

    class Particle {
        constructor() {
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height;
            this.size = Math.random() * 3 + 1;
            this.speedX = Math.random() * 1.5 - 0.75;
            this.speedY = Math.random() * 1.5 - 0.75;
            
            // Randomly pick a color from a magic palette
            const colors = ['#00ffcc', '#ff00ff', '#ffe600', '#ffffff'];
            this.color = colors[Math.floor(Math.random() * colors.length)];
        }
        update() {
            this.x += this.speedX;
            this.y += this.speedY;
            
            // Bounce off edges
            if (this.x < 0 || this.x > canvas.width) this.speedX *= -1;
            if (this.y < 0 || this.y > canvas.height) this.speedY *= -1;
        }
        draw() {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fillStyle = this.color;
            ctx.shadowBlur = 15;
            ctx.shadowColor = this.color;
            ctx.fill();
        }
    }

    const initParticles = () => {
        particlesArray = [];
        for (let i = 0; i < 150; i++) {
            particlesArray.push(new Particle());
        }
    };
    initParticles();

    let animationFrameId;
    const animateParticles = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        for (let i = 0; i < particlesArray.length; i++) {
            particlesArray[i].update();
            particlesArray[i].draw();
        }
        
        // Draw magical connecting lines
        for (let i = 0; i < particlesArray.length; i++) {
            for (let j = i; j < particlesArray.length; j++) {
                const dx = particlesArray[i].x - particlesArray[j].x;
                const dy = particlesArray[i].y - particlesArray[j].y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance < 120) {
                    ctx.beginPath();
                    // Fade lines out as they get further apart
                    ctx.strokeStyle = `rgba(255, 255, 255, ${(1 - distance/120) * 0.3})`;
                    ctx.lineWidth = 0.5;
                    ctx.moveTo(particlesArray[i].x, particlesArray[i].y);
                    ctx.lineTo(particlesArray[j].x, particlesArray[j].y);
                    ctx.stroke();
                }
            }
        }
        animationFrameId = requestAnimationFrame(animateParticles);
    };

    // Start Animation
    animateParticles();

    // Fade out and stop exactly after 20 seconds
    setTimeout(() => {
        canvas.style.opacity = '0';
        setTimeout(() => {
            cancelAnimationFrame(animationFrameId);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }, 2000); // wait for 2s CSS fade transition
    }, 20000);
}

// ==========================================
// 5. Zen Water Ripples Background Feature
// ==========================================
const zenCanvas = document.getElementById('zen-canvas');
let zenCtx, rippleArray = [], rippleAnimationId;

if (zenCanvas) {
    zenCtx = zenCanvas.getContext('2d');
    
    const resizeZenCanvas = () => {
        zenCanvas.width = window.innerWidth;
        zenCanvas.height = window.innerHeight;
    };
    resizeZenCanvas();
    window.addEventListener('resize', resizeZenCanvas);

    class Ripple {
        constructor(x, y) {
            this.x = x;
            this.y = y;
            this.radius = 1;
            this.opacity = 0.6;
            this.expansionRate = Math.random() * 1.5 + 0.5;
        }
        update() {
            this.radius += this.expansionRate;
            this.opacity -= 0.008; // Controls how long the ripple lasts
        }
        draw() {
            zenCtx.beginPath();
            zenCtx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            zenCtx.strokeStyle = `rgba(100, 200, 255, ${Math.max(this.opacity, 0)})`;
            zenCtx.lineWidth = 2;
            zenCtx.shadowBlur = 15;
            zenCtx.shadowColor = '#64c8ff'; // Glowing blue ripples
            zenCtx.stroke();
        }
    }

    const animateRipples = () => {
        zenCtx.clearRect(0, 0, zenCanvas.width, zenCanvas.height);
        for (let i = 0; i < rippleArray.length; i++) {
            rippleArray[i].update();
            rippleArray[i].draw();
            // Remove faded ripples
            if (rippleArray[i].opacity <= 0) {
                rippleArray.splice(i, 1);
                i--;
            }
        }
        rippleAnimationId = requestAnimationFrame(animateRipples);
    };

    // Track clicks and mouse movement to spawn ripples
    const createRipple = (e) => {
        if (!document.body.classList.contains('zen-mode-active')) return;
        rippleArray.push(new Ripple(e.clientX, e.clientY));
    };

    window.addEventListener('click', createRipple);
    window.addEventListener('mousemove', (e) => {
        // Throttle generation so the screen isn't overwhelmed
        if (Math.random() > 0.92) createRipple(e);
    });
    // Unified function to start/stop the effect smoothly
    window.toggleZenMode = (isActive) => {
        if (!zenCanvas) return;
        if (isActive) {
            document.body.classList.add('zen-mode-active');
            zenCanvas.style.opacity = '1';
            if (!rippleAnimationId) animateRipples();
        } else {
            document.body.classList.remove('zen-mode-active');
            zenCanvas.style.opacity = '0';
            
            // Wait for 1.5s CSS fade transition before killing animation
            setTimeout(() => {
                if (!document.body.classList.contains('zen-mode-active')) {
                    cancelAnimationFrame(rippleAnimationId);
                    rippleAnimationId = null;
                    rippleArray = [];
                    if(zenCtx && zenCanvas) zenCtx.clearRect(0, 0, zenCanvas.width, zenCanvas.height);
                }
            }, 1500); 
        }
    };
}

// ==========================================
// 6. Global Alarm Checker
// ==========================================
setInterval(() => {
    const aTime = localStorage.getItem('alarmTime');
    const rDate = localStorage.getItem('lastRungDate');
    
    // Check if alarm is set and not already ringing
    // We check window.isAlarmRingingGlobal to prevent multiple intervals
    if (aTime && !window.isAlarmRingingGlobal) {
        const now = new Date();
        const hrs = now.getHours().toString().padStart(2, '0');
        const mins = now.getMinutes().toString().padStart(2, '0');
        const currentStr = `${hrs}:${mins}`;
        const dStr = now.toDateString();
        
        if (currentStr === aTime && dStr !== rDate) {
            localStorage.setItem('lastRungDate', dStr);
            window.isAlarmRingingGlobal = true;
            
            const status = document.getElementById('alarm-status');
            const btn = document.getElementById('alarm-btn');
            const cw = document.querySelector('.alarm-section') ? document.querySelector('.alarm-section').closest('.clock-wrapper') : null;
            
            if (status) status.textContent = 'ALARM RINGING!';
            if (btn) btn.textContent = 'Stop Alarm';
            if (cw) cw.classList.add('alarm-active-ring');
            
            if ("Notification" in window && Notification.permission === "granted") {
                new Notification("Wahab TickTock Timer", { body: `Your alarm for ${aTime} is ringing!`, icon: "clock-logo.png" });
            }
            
            const aTone = localStorage.getItem('alarmTone') || 'beep';
            
            // Use existing playTone if on home page, else use global audio context
            if (typeof window.playTone === 'function') {
                window.playTone(aTone);
            } else {
                if (!window.globalAudioCtx) {
                    const AudioContext = window.AudioContext || window.webkitAudioContext;
                    if (AudioContext) window.globalAudioCtx = new AudioContext();
                }
                if (window.globalAudioCtx && window.globalAudioCtx.state === 'suspended') {
                    window.globalAudioCtx.resume();
                }
                
                if (window.globalAudioCtx) {
                    const ctx = window.globalAudioCtx;
                    const triggerSound = () => {
                        const osc = ctx.createOscillator();
                        const gain = ctx.createGain();
                        osc.connect(gain);
                        gain.connect(ctx.destination);
                        if (aTone === 'beep') {
                            osc.type = 'square';
                            osc.frequency.setValueAtTime(880, ctx.currentTime);
                            gain.gain.setValueAtTime(0.1, ctx.currentTime);
                            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
                            osc.start();
                            osc.stop(ctx.currentTime + 0.1);
                        } else if (aTone === 'chime') {
                            osc.type = 'sine';
                            osc.frequency.setValueAtTime(1046.50, ctx.currentTime);
                            gain.gain.setValueAtTime(0.3, ctx.currentTime);
                            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.5);
                            osc.start();
                            osc.stop(ctx.currentTime + 1.5);
                        }
                    };
                    triggerSound();
                    window.globalAlarmAudioInterval = setInterval(triggerSound, aTone === 'beep' ? 500 : 2000);
                }
            }
            
            // Global stop button for all pages
            if (!document.getElementById('global-stop-btn')) {
                const gBtn = document.createElement('button');
                gBtn.id = 'global-stop-btn';
                gBtn.textContent = 'ALARM RINGING! CLICK TO STOP';
                gBtn.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:999999;padding:20px 40px;font-size:24px;font-weight:bold;background:#ff4d4d;color:#fff;border:none;border-radius:10px;cursor:pointer;box-shadow:0 0 20px rgba(255,77,77,0.8);';
                gBtn.addEventListener('click', () => { 
                    window.isAlarmRingingGlobal = false;
                    if (window.globalAlarmAudioInterval) clearInterval(window.globalAlarmAudioInterval);
                    if (typeof window.stopTone === 'function') window.stopTone();
                    gBtn.remove();
                    if (btn) {
                        btn.textContent = 'Clear Alarm';
                        if (status) {
                            const [h, m] = aTime.split(':');
                            const dh = (parseInt(h) % 12) || 12;
                            const p = parseInt(h) >= 12 ? 'PM' : 'AM';
                            status.textContent = `Alarm set for ${dh}:${m} ${p}`;
                        }
                    }
                    if (cw) cw.classList.remove('alarm-active-ring');
                });
                document.body.appendChild(gBtn);
            }
        }
    }
}, 1000);
