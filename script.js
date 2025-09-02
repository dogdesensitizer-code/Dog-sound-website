// Audio setup (unchanged core logic, now with hidden audio element)
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const audioElement = document.querySelector("#thunder-audio");
const track = audioCtx.createMediaElementSource(audioElement);

// Filters
const lowFilter = audioCtx.createBiquadFilter();
lowFilter.type = "lowpass";
lowFilter.frequency.value = 200;

const highFilter = audioCtx.createBiquadFilter();
highFilter.type = "highpass";
highFilter.frequency.value = 200;

// Gains
const lowGain = audioCtx.createGain();
const highGain = audioCtx.createGain();

// Connect chains
track.connect(lowFilter).connect(lowGain).connect(audioCtx.destination);
track.connect(highFilter).connect(h
