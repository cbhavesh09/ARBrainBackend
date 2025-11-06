// script.js — cleaned single-file version with AR + loader + Gemini hooks
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';

/* --------- CONFIG --------- */
const BACKEND = "https://invulnerable-kirstie-unregaled.ngrok-free.dev"; // set to your backend/ngrok
const YOUR_API_KEY = "AIzaSyCjFlb6aQU5XVsZuBKxtnwylhCJTmBB3CU"; // put Gemini API key here if you want analysis in-browser
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${YOUR_API_KEY}`;

/* --------- THREE setup --------- */
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.01, 20);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.xr.enabled = true;
document.getElementById('container').appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(1,1,1);
scene.add(dirLight);

/* --------- Globals --------- */
let model = null;
let tumorMarker = null;
const loader = new GLTFLoader();
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const originalScale = 0.3;
let isMarkingTumor = false;
let tumorVisible = false;
let modelPlaced = false;
let isARMode = false;
let hitTestSource = null;
let hitTestSourceRequested = false;
const reticle = createReticle(); // ring reticle for AR placement
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 1;
controls.maxDistance = 10;
camera.position.set(0,0,3);

/* --------- helper DOM elems --------- */
const loadingScreen = document.getElementById('loadingScreen');
const convertStatus = document.getElementById('convertStatus');

/* --------- GLB load helper (single canonical implementation) --------- */
function loadGLBUrl(url) {
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => {
      if (model) scene.remove(model);
      model = gltf.scene;
      // center and scale model
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      model.position.sub(center);
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const scale = originalScale / maxDim;
      model.scale.setScalar(scale);
      model.visible = true;
      scene.add(model);
      ensureTumorMarker();
      if (loadingScreen) loadingScreen.classList.add('hidden');
      resolve(model);
    }, (progress) => {
      if (progress && progress.total) {
        const percent = Math.round(progress.loaded / progress.total * 100);
        const txt = document.querySelector('.loading-text');
        if (txt) txt.textContent = `Loading Brain Model... ${percent}%`;
      }
    }, (err) => reject(err));
  });
}

/* --------- Reticle (AR hit placement) --------- */
function createReticle() {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.12, 0.18, 32),
    new THREE.MeshBasicMaterial({ color: 0x00bcd4, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI/2;
  ring.visible = false;
  ring.matrixAutoUpdate = false;
  scene.add(ring);
  return ring;
}

/* --------- Tumor marker --------- */
function ensureTumorMarker() {
  if (tumorMarker) return;
  const geo = new THREE.SphereGeometry(1, 32, 32);
  const mat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 0.5, transparent:true, opacity:0.9 });
  tumorMarker = new THREE.Mesh(geo, mat);
  tumorMarker.scale.set(0.05,0.05,0.05);
  tumorMarker.visible = false;
  scene.add(tumorMarker);
}

/* --------- AR Button & hit-test setup --------- */
const arButtonEl = document.getElementById('ar-button');
let customARButton = null;
if ('xr' in navigator) {
  navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
    if (supported) {
      if (arButtonEl) arButtonEl.style.display = 'block';
      customARButton = ARButton.createButton(renderer, { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay'], domOverlay: { root: document.body } });
      customARButton.style.display = 'none'; // hide internal button, we'll trigger it via arButtonEl
      document.body.appendChild(customARButton);
      arButtonEl.addEventListener('click', () => customARButton.click());
      renderer.xr.addEventListener('sessionstart', onSessionStart);
      renderer.xr.addEventListener('sessionend', onSessionEnd);
    } else {
      if (arButtonEl) { arButtonEl.textContent = 'AR Not Supported on This Device'; arButtonEl.style.display='block'; arButtonEl.disabled=true; }
    }
  }).catch((e) => {
    console.warn('XR check error', e);
    if (arButtonEl) { arButtonEl.textContent = 'AR Unavailable'; arButtonEl.style.display='block'; arButtonEl.disabled=true; }
  });
} else {
  if (arButtonEl) { arButtonEl.textContent = 'WebXR not available'; arButtonEl.style.display='block'; arButtonEl.disabled=true; }
}

function onSessionStart() {
  isARMode = true;
  modelPlaced = false;
  hitTestSourceRequested = false;
  if (model) model.visible = false;
  const instr = document.getElementById('arInstructions');
  if (instr) instr.classList.remove('hidden');
}

function onSessionEnd() {
  isARMode = false;
  hitTestSourceRequested = false;
  hitTestSource = null;
  reticle.visible = false;
  if (model) { model.visible = true; model.position.set(0,0,0); }
}

/* Controller select (tap to place / tap to mark) */
const controller = renderer.xr.getController(0);
controller.addEventListener('select', () => {
  // if reticle visible and model not placed => place model
  if (reticle.visible && model && !modelPlaced) {
    model.position.setFromMatrixPosition(reticle.matrix);
    model.quaternion.setFromRotationMatrix(reticle.matrix);
    model.visible = true;
    modelPlaced = true;
    const instr = document.getElementById('arInstructions');
    if (instr) setTimeout(()=>instr.classList.add('hidden'), 1200);
    return;
  }
  // otherwise if marking mode and model placed, raycast from controller forward
  if (modelPlaced && isMarkingTumor && model) {
    const tempMat = new THREE.Matrix4();
    tempMat.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0,0,-1).applyMatrix4(tempMat);
    const intersects = raycaster.intersectObject(model, true);
    if (intersects.length > 0) {
      handleTumorMarking(intersects[0].point);
    }
  }
});
scene.add(controller);

/* --------- Convert & load backend integration --------- */
async function startConversion(patientId) {
  const res = await fetch(`${BACKEND}/convert?patient_id=${encodeURIComponent(patientId)}`, { method: 'POST' });
  if (!res.ok) throw new Error('convert call failed: ' + res.status);
  const j = await res.json();
  return j.job_id;
}

async function pollJob(jobId, onUpdate = null) {
  while (true) {
    const r = await fetch(`${BACKEND}/job/${jobId}`);
    if (!r.ok) throw new Error('job poll failed: ' + r.status);
    const j = await r.json();
    if (onUpdate) onUpdate(j);
    if (j.status === 'done' || j.status === 'failed') return j;
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
}

async function convertAndLoad(patientId) {
  if (!patientId) return alert('Enter patient id');
  try {
    convertStatus.textContent = 'Starting...';
    const jobId = await startConversion(patientId);
    convertStatus.textContent = 'Job: ' + jobId;
    const job = await pollJob(jobId, j => convertStatus.textContent = `Status: ${j.status}`);
    if (job.status === 'done' && job.result_path) {
      convertStatus.textContent = 'Loading model...';
      await loadGLBFromResult(job.result_path);
      convertStatus.textContent = 'Loaded';
    } else {
      convertStatus.textContent = 'Conversion failed';
      console.error('job failed', job);
    }
  } catch (err) {
    console.error(err);
    convertStatus.textContent = 'Error: ' + (err.message||err);
  }
}

/* Helper that accepts backend result_path like "/static/ID.glb" */
async function loadGLBFromResult(resultPath) {
  const url = resultPath.startsWith('http') ? resultPath : (BACKEND + resultPath);
  if (loadingScreen) loadingScreen.classList.remove('hidden');
  try {
    await loadGLBUrl(url);
  } finally {
    setTimeout(()=> loadingScreen?.classList.add('hidden'), 200);
  }
}

/* hook conversion button */
document.getElementById('convertBtn')?.addEventListener('click', () => {
  const pid = document.getElementById('patientIdInput').value.trim();
  convertAndLoad(pid);
});

/* --------- Mouse click marking for non-AR --------- */
window.addEventListener('click', (ev) => {
  if (!isMarkingTumor || !model || isARMode) return;
  mouse.x = (ev.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(ev.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObject(model, true);
  if (intersects.length > 0) handleTumorMarking(intersects[0].point);
});

/* Marking handler */
function handleTumorMarking(worldPoint) {
  ensureTumorMarker();
  tumorMarker.position.copy(worldPoint);
  tumorMarker.visible = true;
  tumorVisible = true;
  document.getElementById('toggleTumorBtn').textContent = 'Hide Tumor';
  document.getElementById('posX').textContent = worldPoint.x.toFixed(3);
  document.getElementById('posY').textContent = worldPoint.y.toFixed(3);
  document.getElementById('posZ').textContent = worldPoint.z.toFixed(3);
  callGeminiAPI(worldPoint).catch(()=>{/*ignore*/});
  isMarkingTumor = false;
  document.getElementById('markTumorBtn')?.classList.remove('active');
}

/* --------- Buttons behavior --------- */
document.getElementById('markTumorBtn')?.addEventListener('click', () => {
  isMarkingTumor = !isMarkingTumor;
  const btn = document.getElementById('markTumorBtn');
  if (isMarkingTumor) { btn.textContent = 'Marking... (Click on Brain)'; btn.classList.add('active'); controls.enabled=false; }
  else { btn.textContent = 'Mark Tumor'; btn.classList.remove('active'); controls.enabled=true; }
});
document.getElementById('toggleTumorBtn')?.addEventListener('click', () => {
  tumorVisible = !tumorVisible;
  if (tumorMarker) tumorMarker.visible = tumorVisible;
  document.getElementById('toggleTumorBtn').textContent = tumorVisible ? 'Hide Tumor' : 'Show Tumor';
});
document.getElementById('resetViewBtn')?.addEventListener('click', () => {
  if (tumorMarker) { tumorMarker.visible=false; tumorVisible=false; document.getElementById('toggleTumorBtn').textContent='Show Tumor'; }
  document.getElementById('posX').textContent='---';
  document.getElementById('posY').textContent='---';
  document.getElementById('posZ').textContent='---';
  document.getElementById('tumorAnalysisResult').textContent='No tumor marked.';
  if (isARMode && model) { modelPlaced=false; model.visible=false; }
  else { camera.position.set(0,0,3); controls.target.set(0,0,0); controls.update(); if (model) { model.rotation.set(0,0,0); model.position.set(0,0,0); } }
});
document.getElementById('scaleSlider')?.addEventListener('input', (e) => {
  const val = parseFloat(e.target.value); document.getElementById('scaleValue').textContent = val.toFixed(1)+'x';
  if (model) model.scale.setScalar(originalScale * val);
});

/* --------- Gemini (optional) --------- */
async function callGeminiAPI(position) {
  const resEl = document.getElementById('tumorAnalysisResult');
  resEl.textContent = 'Analyzing...';
  if (!YOUR_API_KEY) { resEl.textContent = 'Gemini key not configured.'; return; }
  const prompt = `A potential brain tumor has been identified at X:${position.x.toFixed(4)} Y:${position.y.toFixed(4)} Z:${position.z.toFixed(4)}. Respond with likely anatomical region (short).`;
  const requestBody = { contents: [{ parts: [{ text: prompt }] }], safetySettings: [] };
  try {
    const r = await fetch(API_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(requestBody) });
    if (!r.ok) throw new Error('API error');
    const data = await r.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
    resEl.textContent = text.trim();
    speakText(text.trim());
  } catch (err) {
    console.error(err);
    resEl.textContent = 'Analysis failed.';
  }
}

/* TTS */
function speakText(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const ut = new SpeechSynthesisUtterance(text);
  ut.lang = 'en-US'; ut.rate = 0.95;
  const voices = window.speechSynthesis.getVoices();
  ut.voice = voices.find(v=>v.lang.includes('en-US') && v.name.includes('Google')) || voices[0] || null;
  window.speechSynthesis.speak(ut);
}

/* --------- Render loop with AR hit-test handling --------- */
function render(time, frame) {
  // pulse effect on tumor marker
  if (tumorMarker && tumorMarker.visible) {
    tumorMarker.material.emissiveIntensity = 0.3 + Math.abs(Math.sin(time*0.002)) * 0.4;
  }

  // AR hit-test
  if (frame && isARMode) {
    const session = renderer.xr.getSession();
    const referenceSpace = renderer.xr.getReferenceSpace();
    if (!hitTestSourceRequested && session) {
      session.requestReferenceSpace('viewer').then((viewerSpace) => {
        session.requestHitTestSource({ space: viewerSpace }).then((source) => {
          hitTestSource = source;
        });
      });
      hitTestSourceRequested = true;
    }
    if (hitTestSource && !modelPlaced) {
      const hits = frame.getHitTestResults(hitTestSource);
      if (hits.length > 0) {
        const hit = hits[0];
        const pose = hit.getPose(referenceSpace);
        if (pose) {
          reticle.visible = true;
          reticle.matrix.fromArray(pose.transform.matrix);
        }
      } else reticle.visible = false;
    }
  } else controls.update();

  renderer.render(scene, camera);
}
renderer.setAnimationLoop(render);

/* --------- Resize handler --------- */
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth/window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
