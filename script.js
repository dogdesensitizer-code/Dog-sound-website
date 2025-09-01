// Audio setup
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

// Connect
track.connect(lowFilter).connect(lowGain).connect(audioCtx.destination);
track.connect(highFilter).connect(highGain).connect(audioCtx.destination);

// Sliders + displays
const lowSlider = document.getElementById("lowSlider");
const highSlider = document.getElementById("highSlider");
const lowValue = document.getElementById("lowValue");
const highValue = document.getElementById("highValue");

// Reduction → Gain mapping
function reductionToGain(reduction) {
  switch (reduction) {
    case "0": return 1.0;   // full sound
    case "25": return 0.75;
    case "50": return 0.5;
    case "75": return 0.25; // gentle
  }
}

// Update low band
lowSlider.addEventListener("input", () => {
  const reduction = lowSlider.value;
  lowGain.gain.value = reductionToGain(reduction);
  lowValue.textContent = `${reduction}% reduction`;
});

// Update high band
highSlider.addEventListener("input", () => {
  const reduction = highSlider.value;
  highGain.gain.value = reductionToGain(reduction);
  highValue.textContent = `${reduction}% reduction`;
});
