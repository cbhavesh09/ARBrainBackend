import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';

/* ------------- CONFIG ------------- */
/* Set BACKEND to your backend public URL (ngrok or host) */
const BACKEND = "https://invulnerable-kirstie-unregaled.ngrok-free.dev";
 // <- change if needed

/* Put your Gemini/Generative API key here */
const YOUR_API_KEY = "AIzaSyCjFlb6aQU5XVsZuBKxtnwylhCJTmBB3CU"; // <-- REPLACE with your Google API key (keep secret)
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${YOUR_API_KEY}`;

/* ------------- THREE SETUP ------------- */
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.01, 20);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.xr.enabled = true;
document.getElementById('container').appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 1);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(1,1,1);
scene.add(directionalLight);

let model = null;
let tumorMarker = null;
let loader = new GLTFLoader();
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const originalScale = 0.3;
let isMarkingTumor = false;
let tumorVisible = false;
let modelPlaced = false;
let isARMode = false;

/* Rotation toggles */
let autoRotateLR = false;
let autoRotateUD = false;
let coloredRegionsOn = false;

/* Loading screen element */
const loadingScreen = document.getElementById('loadingScreen');

/* ---------------- GLB LOADER ---------------- */
async function loadGLBUrl(url) {
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => {
      if (model) scene.remove(model);
      model = gltf.scene;
      // center + scale
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      model.position.sub(center);
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = originalScale / maxDim;
      model.scale.multiplyScalar(scale);
      model.visible = true;
      scene.add(model);
      createTumorMarker();
      if (loadingScreen) loadingScreen.classList.add('hidden');
      resolve(model);
    }, (progress) => {
      if (progress && progress.total) {
        const percent = (progress.loaded / progress.total * 100).toFixed(0);
        const txt = document.querySelector('.loading-text');
        if (txt) txt.textContent = `Loading Brain Model... ${percent}%`;
      }
    }, (err) => reject(err));
  });
}

/* --------------- Tumor marker --------------- */
function createTumorMarker() {
  if (tumorMarker) return;
  const geo = new THREE.SphereGeometry(1, 32, 32);
  const mat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 0.5, transparent:true, opacity:0.8 });
  tumorMarker = new THREE.Mesh(geo, mat);
  tumorMarker.scale.set(0.05,0.05,0.05);
  tumorMarker.visible = false;
  scene.add(tumorMarker);
}

/* --------------- Controls --------------- */
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.05;
controls.minDistance = 1; controls.maxDistance = 10;
camera.position.set(0,0,3);

/* --------------- AR Button --------------- */
const arButton = document.getElementById('ar-button');
let customARButton = null;
if ('xr' in navigator) {
  navigator.xr.isSessionSupported('immersive-ar').then(supported => {
    if (supported) {
      if (arButton) arButton.style.display = 'block';
      customARButton = ARButton.createButton(renderer, { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay'], domOverlay: { root: document.body } });
      customARButton.style.display = 'none';
      document.body.appendChild(customARButton);
      if (arButton) arButton.addEventListener('click', () => customARButton.click());
      renderer.xr.addEventListener('sessionstart', () => {
        isARMode = true; modelPlaced = false;
        if (arButton) arButton.textContent = 'Exit AR';
        const instr = document.getElementById('arInstructions'); if (instr) instr.classList.remove('hidden');
        if (model) model.visible = false;
      });
      renderer.xr.addEventListener('sessionend', () => {
        isARMode = false;
        if (arButton) arButton.textContent = 'Start AR Experience';
        if (model) { model.visible = true; model.position.set(0,0,0); }
      });
    } else {
      if (arButton) { arButton.textContent = 'AR Not Supported on This Device'; arButton.style.display='block'; arButton.disabled=true; }
    }
  }).catch(()=>{ if (arButton) { arButton.textContent = 'Error Checking AR Support'; arButton.style.display='block'; arButton.disabled=true; }});
}

/* --------------- Backend functions --------------- */
async function startConversion(patientId) {
  const url = `${BACKEND}/convert?patient_id=${encodeURIComponent(patientId)}`;
  const r = await fetch(url, { method: 'POST' });
  if (!r.ok) throw new Error('Failed to request conversion');
  const j = await r.json();
  return j.job_id;
}

async function pollJob(jobId, onUpdate = null) {
  while (true) {
    const r = await fetch(`${BACKEND}/job/${jobId}`);
    if (!r.ok) throw new Error('Job poll failed');
    const j = await r.json();
    if (onUpdate) onUpdate(j);
    if (j.status === 'done' || j.status === 'failed') return j;
    await new Promise(res => setTimeout(res, 1500));
  }
}

async function convertAndLoad(patientId) {
  const statusEl = document.getElementById('convertStatus');
  try {
    statusEl.textContent = 'Starting...';
    const jobId = await startConversion(patientId);
    statusEl.textContent = 'Job started: ' + jobId;
    const job = await pollJob(jobId, j => statusEl.textContent = `Status: ${j.status}`);
    if (job.status === 'done' && job.result_path) {
      statusEl.textContent = 'Conversion done, loading model...';
      await loadGLBFromResult(job.result_path);
      statusEl.textContent = 'Loaded successfully';
    } else {
      statusEl.textContent = 'Conversion failed';
      console.error('Job failed:', job);
    }
  } catch (err) {
    console.error(err);
    document.getElementById('convertStatus').textContent = 'Error: ' + err.message;
  }
}

async function loadGLBFromResult(resultPath) {
  // resultPath returned by backend usually like "/static/OAS1_0004_MR1.glb"
  const url = resultPath.startsWith('http') ? resultPath : (BACKEND + resultPath);
  if (loadingScreen) loadingScreen.classList.remove('hidden');
  await loadGLBUrl(url);
}

/* Hook conversion UI */
document.getElementById('convertBtn').addEventListener('click', () => {
  const pid = document.getElementById('patientIdInput').value.trim();
  if (!pid) return alert('Enter patient id like OAS1_0004_MR1');
  convertAndLoad(pid);
});

/* --------------- Mouse marking / raycast --------------- */
window.addEventListener('click', (ev) => {
  if (!isMarkingTumor || !model || isARMode) return;
  mouse.x = (ev.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(ev.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObject(model, true);
  if (intersects.length > 0) {
    const hit = intersects[0];
    const meshName = hit.object?.name || hit.object?.parent?.name || null;
    handleTumorMarking(hit.point, meshName);
  }
});

function handleTumorMarking(worldPoint, regionName = null) {
  if (!tumorMarker) createTumorMarker();
  tumorMarker.position.copy(worldPoint);
  tumorMarker.visible = true;
  tumorVisible = true;
  if (document.getElementById('toggleTumorBtn')) document.getElementById('toggleTumorBtn').textContent = 'Hide Tumor';
  document.getElementById('posX').textContent = worldPoint.x.toFixed(3);
  document.getElementById('posY').textContent = worldPoint.y.toFixed(3);
  document.getElementById('posZ').textContent = worldPoint.z.toFixed(3);
  callGeminiAPI(worldPoint, regionName);
  isMarkingTumor = false;
  document.getElementById('markTumorBtn')?.classList.remove('active');
}

/* --------------- Buttons (mark, toggle tumor, reset) --------------- */
document.getElementById('markTumorBtn').addEventListener('click', () => {
  isMarkingTumor = !isMarkingTumor;
  const btn = document.getElementById('markTumorBtn');
  if (isMarkingTumor) { btn.textContent = 'Marking... (Click on Brain)'; btn.classList.add('active'); controls.enabled = false; }
  else { btn.textContent = 'Mark Tumor'; btn.classList.remove('active'); controls.enabled = true; }
});

document.getElementById('toggleTumorBtn').addEventListener('click', () => {
  tumorVisible = !tumorVisible;
  if (tumorMarker) tumorMarker.visible = tumorVisible;
  document.getElementById('toggleTumorBtn').textContent = tumorVisible ? 'Hide Tumor' : 'Show Tumor';
});

document.getElementById('resetViewBtn').addEventListener('click', () => {
  if (tumorMarker) { tumorMarker.visible = false; tumorVisible = false; document.getElementById('toggleTumorBtn').textContent = 'Show Tumor'; }
  document.getElementById('posX').textContent = '---';
  document.getElementById('posY').textContent = '---';
  document.getElementById('posZ').textContent = '---';
  document.getElementById('tumorAnalysisResult').textContent = 'No tumor marked.';
  if (isARMode && model) { modelPlaced = false; model.visible = false; }
  else { camera.position.set(0,0,3); controls.target.set(0,0,0); controls.update(); if (model) { model.rotation.set(0,0,0); model.position.set(0,0,0); } }
});

/* --------------- Slider for scale --------------- */
document.getElementById('scaleSlider').addEventListener('input', (e) => {
  const val = parseFloat(e.target.value);
  document.getElementById('scaleValue').textContent = val.toFixed(1) + 'x';
  if (model) {
    const base = originalScale * val;
    model.scale.setScalar(base);
  }
});

/* --------------- Auto-rotate toggles --------------- */
document.getElementById('autoRotateLR').addEventListener('click', () => {
  autoRotateLR = !autoRotateLR;
  document.getElementById('autoRotateLR').classList.toggle('active', autoRotateLR);
});
document.getElementById('autoRotateUD').addEventListener('click', () => {
  autoRotateUD = !autoRotateUD;
  document.getElementById('autoRotateUD').classList.toggle('active', autoRotateUD);
});

/* --------------- Colored regions toggle (if you produce colored GLBs) --------------- */
document.getElementById('toggleColored').addEventListener('click', async () => {
  coloredRegionsOn = !coloredRegionsOn;
  document.getElementById('toggleColored').classList.toggle('active', coloredRegionsOn);
  const status = document.getElementById('convertStatus');
  if (!model) return alert('Load a model first (Convert & Load).');
  // If you produce a separate colored GLB for the same patient, you could change URL convention:
  // e.g. /static/OAS1_0004_MR1_colored.glb
  // For now this toggles an imaginary alternate file name (make sure converter writes colored version)
  try {
    const patientId = document.getElementById('patientIdInput').value.trim();
    if (!patientId) return alert('Enter patient ID first');
    const suffix = coloredRegionsOn ? '_colored' : '';
    const path = `/static/${patientId}${suffix}.glb`;
    status.textContent = 'Loading ' + path;
    await loadGLBFromResult(path);
    status.textContent = 'Loaded ' + (coloredRegionsOn ? 'colored' : 'plain') + ' model';
  } catch (err) {
    console.warn(err);
    document.getElementById('convertStatus').textContent = 'Could not load colored model: ' + err.message;
  }
});

/* --------------- Gemini call (region-aware) --------------- */
async function callGeminiAPI(position, regionName = null) {
  const resultEl = document.getElementById('tumorAnalysisResult');
  resultEl.textContent = 'Analyzing...';
  if (!YOUR_API_KEY) { resultEl.textContent = 'Gemini API key not configured.'; return; }

  const regionText = regionName ? `Region: ${regionName}.\n` : '';
  const prompt = `
A potential brain tumor has been identified at:
X: ${position.x.toFixed(4)}, Y: ${position.y.toFixed(4)}, Z: ${position.z.toFixed(4)}.
${regionText}
Provide the most likely anatomical region name (short) and a one-line clinician-friendly suggestion.`;

  const requestBody = { contents: [{ parts: [{ text: prompt }] }], safetySettings: [] };
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    if (!res.ok) throw new Error('Gemini API error');
    const data = await res.json();
    const aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
    resultEl.textContent = aiText.trim();
    // optional TTS
    speakText(aiText.trim());
  } catch (err) {
    console.error(err);
    resultEl.textContent = 'Gemini analysis failed.';
  }
}

/* --------------- Text-to-speech --------------- */
function speakText(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const ut = new SpeechSynthesisUtterance(text);
  ut.lang = 'en-US';
  ut.rate = 0.95;
  const voices = window.speechSynthesis.getVoices();
  ut.voice = voices.find(v => v.lang === 'en-US' && v.name.includes('Google')) || voices[0] || null;
  window.speechSynthesis.speak(ut);
}

/* --------------- Animation / render --------------- */
function render(timestamp, frame) {
  // pulse tumor marker
  if (tumorMarker && tumorMarker.visible) {
    tumorMarker.material.emissiveIntensity = 0.3 + Math.abs(Math.sin(Date.now()*0.005)) * 0.3;
  }

  // auto-rotate when model loaded and not AR
  if (model && !isARMode) {
    if (autoRotateLR) model.rotation.y += 0.01;
    if (autoRotateUD) model.rotation.x += 0.008;
  }

  if (frame && isARMode) {
    // AR hit testing kept out for brevity (if you want, reuse your earlier code)
  } else {
    controls.update();
  }

  renderer.render(scene, camera);
}

function animate() {
  renderer.setAnimationLoop(render);
}
animate();

/* --------------- Helper to load path returned by backend --------------- */
async function loadGLBFromResult(resultPath) {
  const path = resultPath.startsWith('http') ? resultPath : (BACKEND + resultPath);
  if (loadingScreen) loadingScreen.classList.remove('hidden');
  try {
    await loadGLBUrl(path);
  } finally {
    if (loadingScreen) setTimeout(()=>loadingScreen.classList.add('hidden'), 300);
  }
}

/* expose simple load helper used above */
function loadGLBUrl(url) {
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => {
      if (model) scene.remove(model);
      model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      model.position.sub(center);
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = originalScale / maxDim;
      model.scale.multiplyScalar(scale);
      model.visible = true;
      scene.add(model);
      createTumorMarker();
      resolve(model);
    }, undefined, (err) => reject(err));
  });
}

/* --------------- Resize handler --------------- */
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
