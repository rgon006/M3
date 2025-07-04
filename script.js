/* ========== Global State ========== */
let sheetImages = []; // Array to store sheet music URLs
let currentPage = 0;
let flipCooldown = false; // Page flip cooldown

// Head pose detection cooldown and threshold
let headTurnCooldown = false;
const HEAD_TURN_COOLDOWN_MS = 1500;
const YAW_THRESHOLD = 8; // Yaw angle threshold (pixel difference), adjust based on testing, suggest starting from 8 or lower

// ****** New: Hand gesture detection related constants ******
let handGestureCooldown = false; // Hand gesture page flip cooldown
const HAND_COOLDOWN_MS = 1500; // Hand gesture page flip cooldown time (milliseconds)
// Hand raise Y coordinate threshold percentage (wrist Y coordinate below this threshold is considered raised, 0 is top, 1 is bottom)
// For example, 0.4 means the wrist is in the upper 40% of the video
const RAISE_HAND_Y_THRESHOLD_PERCENT = 0.4;

// ****** New: Currently selected trigger mode ******
let currentTriggerMode = 'mouth'; // Default to mouth open trigger

// ****** Cloudinary Configuration ******
// TODO: Please replace with your Cloudinary Cloud name, based on your screenshot, yours might be "dje3ekclp"
const CLOUDINARY_CLOUD_NAME = "dje3ekclp";
// TODO: Please replace with the unsigned upload preset name you created in your Cloudinary console, based on your screenshot, yours might be "my_unsigned_upload"
const CLOUDINARY_UPLOAD_PRESET = "my_unsigned_upload";

// Key name for storing sheet music URLs in Local Storage
const LOCAL_STORAGE_SHEETS_KEY = 'pianoSheetUrls';
// Prefix for locally uploaded sheet music
const LOCAL_SHEET_PREFIX = 'local_';

/* ========== Immediately Executing Initialization ========== */
(async () => {
  /* 0) Check if faceapi and MediaPipe exist */
  if (!window.faceapi) {
    alert('face-api.min.js not loaded, check libs/face-api.min.js path.');
    return;
  }
  // Check if MediaPipe Hands is loaded
  if (!window.Hands) {
    alert('MediaPipe Hands not loaded, check https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/hands.js path.');
    return;
  }
  if (!window.Camera) {
    alert('MediaPipe Camera Utils not loaded, check https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3/camera_utils.js path.');
    return;
  }

  const faceapi = window.faceapi;
  console.log('✅ faceapi ready', faceapi);
  console.log('✅ MediaPipe Hands ready', window.Hands);
  console.log('✅ MediaPipe Camera Utils ready', window.Camera);

  /* 1) Show loading animation */
  document.getElementById('loading').style.display = 'block';

  /* ---------- Core Face Detection and Helper Functions ---------- */
  function detectFaces() {
    const video = document.getElementById('video');
    const canvas = document.getElementById('overlay');
    const displaySize = { width: video.width, height: video.height };
    faceapi.matchDimensions(canvas, displaySize);

    setInterval(async () => {
      if (video.readyState !== 4) return;

      // Check if FaceLandmark68Net is loaded to avoid errors
      if (!faceapi.nets.faceLandmark68Net.isLoaded) {
          console.warn('FaceLandmark68Net not loaded, skipping landmark detection features.');
          return;
      }

      // ****** Use SsdMobilenetv1Options() for more accuracy ******
      const detections = await faceapi
        .detectAllFaces(video, new faceapi.SsdMobilenetv1Options())
        .withFaceLandmarks();

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const resized = faceapi.resizeResults(detections, displaySize);
      faceapi.draw.drawFaceLandmarks(canvas, resized);

      for (const d of resized) {
        if (!d.landmarks) {
            //console.warn('Current detected object has no landmark information, skipping mouth and head pose detection.'); // Avoid excessive logging
            continue;
        }

        // ****** Determine whether to perform mouth detection based on currentTriggerMode ******
        if (currentTriggerMode === 'mouth' || currentTriggerMode === 'all') {
            const mouth = d.landmarks.getMouth();
            if (mouth && mouth.length >= 20) { // Check if mouth landmarks are available
                const topLipY = averageY([
                  mouth[2], mouth[3], mouth[4], mouth[13], mouth[14], mouth[15]
                ]);
                const bottomLipY = averageY([
                  mouth[8], mouth[9], mouth[10], mouth[17], mouth[18], mouth[19]
                ]);
                const mouthHeight = bottomLipY - topLipY;
                if (mouthHeight > 15) { // Mouth open threshold
                  console.log('Mouth open detected, flipping page!');
                  nextPage();
                }
            }
        }

        // ****** Determine whether to perform head turn detection based on currentTriggerMode ******
        if ((currentTriggerMode === 'headTurn' || currentTriggerMode === 'all') && !headTurnCooldown) {
            const leftEye = d.landmarks.getLeftEye();
            const rightEye = d.landmarks.getRightEye();
            const nose = d.landmarks.getNose();

            if (leftEye.length > 0 && rightEye.length > 0 && nose.length > 0) {
                const leftEyeCenterX = averageX(leftEye);
                const rightEyeCenterX = averageX(rightEye);
                const noseTipX = nose[0].x;

                const eyeMidPointX = (leftEyeCenterX + rightEyeCenterX) / 2;
                const yawDifference = noseTipX - eyeMidPointX;
                // console.log('yawDifference:', yawDifference); // For debugging, can be removed once stable

                if (yawDifference > YAW_THRESHOLD) { // Head turned left (relative to face orientation)
                    console.log('Head turned left detected, flipping to previous page!');
                    prevPage();
                    headTurnCooldown = true;
                    setTimeout(() => (headTurnCooldown = false), HEAD_TURN_COOLDOWN_MS);
                } else if (yawDifference < -YAW_THRESHOLD) { // Head turned right
                    console.log('Head turned right detected, flipping to next page!');
                    nextPage();
                    headTurnCooldown = true;
                    setTimeout(() => (headTurnCooldown = false), HEAD_TURN_COOLDOWN_MS);
                }
            }
        }
      }
    }, 300); // Check every 300ms
  }

  // Helper to calculate average Y coordinate of points
  function averageY(points) {
    if (!points || points.length === 0) return 0;
    return points.reduce((sum, pt) => sum + pt.y, 0) / points.length;
  }

  // Helper to calculate average X coordinate of points
  function averageX(points) {
    if (!points || points.length === 0) return 0;
    return points.reduce((sum, pt) => sum + pt.x, 0) / points.length;
  }
  /* ---------- Core Face Detection and Helper Functions END ---------- */


  try {
    /* 2) Load models (from local models folder) */
    const MODEL_URL = './models'; // Point to your local models folder
    await Promise.all([
      // ****** Load ssdMobilenetv1 model ******
      faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL)
    ]);

    console.log('✅ Models loaded');

    /* 3) Open camera */
    const video = document.getElementById('video');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user' // Try front camera first
        }
      });
      video.srcObject = stream;
      console.log('✅ Camera (front) opened');
    } catch (err) {
      console.warn('Failed to get front camera, trying back camera:', err);
      // If front camera fails, try back camera as fallback
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: 'environment' // Try back camera
          }
        });
        video.srcObject = stream;
        console.log('✅ Camera (back) opened');
        alert('Front camera not available, attempting to use back camera.');
      } catch (err2) {
        console.error('Cannot access any camera:', err2);
        alert(`Cannot access any camera: ${err2.message}\nPlease ensure access is granted and try refreshing the page.`);
        return; // If both fail, terminate
      }
    }

    /* 4) Start face detection loop */
    detectFaces();

    // ****** New: Set up hand detection ******
    // MediaPipe Hands initialization must always occur, but its result processing is controlled by the mode
    setupHandDetection();

    // From Local Storage load previously uploaded sheets
    loadSheetsFromLocalStorage();

    // ****** Bind page navigation button events ******
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');

    if (prevBtn) {
        prevBtn.addEventListener('click', prevPage);
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', nextPage);
    }

    // ****** New: Bind trigger mode selection event ******
    const triggerModeSelect = document.getElementById('triggerModeSelect');
    if (triggerModeSelect) {
        // Read previously selected mode from LocalStorage, default to 'mouth' if none
        const storedMode = localStorage.getItem('selectedTriggerMode');
        if (storedMode) {
            triggerModeSelect.value = storedMode;
        }
        currentTriggerMode = triggerModeSelect.value; // Initialize current mode

        triggerModeSelect.addEventListener('change', (event) => {
            currentTriggerMode = event.target.value;
            localStorage.setItem('selectedTriggerMode', currentTriggerMode); // Save selection
            console.log('Current trigger mode switched to:', currentTriggerMode);
        });
    }

  } catch (err) {
    console.error('Initialization failed:', err);
    alert(`Initialization failed: ${err.message}`);
    return;
  } finally {
    document.getElementById('loading').style.display = 'none';
  }

  /* 5) Bind file upload events */
  document.getElementById('uploadCloudBtn')
          .addEventListener('click', () => {
            const fileInput = document.getElementById('sheetInput');
            if (fileInput.files.length === 0) {
                alert('Please select sheet music files to upload!');
                return;
            }
            handleCloudUpload(fileInput.files);
          });

  document.getElementById('uploadLocalBtn')
          .addEventListener('click', () => {
            const fileInput = document.getElementById('sheetInput');
            if (fileInput.files.length === 0) {
                alert('Please select sheet music files to upload!');
                return;
            }
            handleLocalUpload(fileInput.files);
          });

  /* ---------- Cloudinary & Local Storage Related Helper Functions ---------- */

  function loadSheetsFromLocalStorage() {
    console.log('Loading sheets from Local Storage...');
    const storedUrls = localStorage.getItem(LOCAL_STORAGE_SHEETS_KEY);
    if (storedUrls) {
      try {
        // Filter out local URLs as they become invalid after refresh
        sheetImages = JSON.parse(storedUrls);
        sheetImages = sheetImages.filter(url => !url.startsWith(LOCAL_SHEET_PREFIX));
        currentPage = 0;
        showPage();
        updatePageNavigation();
        console.log(`✅ Loaded ${sheetImages.length} sheets from Local Storage.`);
      } catch (e) {
        console.error('Failed to parse sheet music URLs from Local Storage:', e);
        sheetImages = [];
      }
    } else {
      console.log('No sheets found in Local Storage.');
    }
  }

  function saveSheetsToLocalStorage() {
    // Only save Cloudinary URLs; local URLs are invalid after refresh
    const urlsToSave = sheetImages.filter(url => !url.startsWith(LOCAL_SHEET_PREFIX));
    localStorage.setItem(LOCAL_STORAGE_SHEETS_KEY, JSON.stringify(urlsToSave));
    console.log('Sheets saved to Local Storage (Cloudinary URLs only).');
  }

  function handleLocalUpload(files) {
    if (!files.length) return;
    const btn = document.getElementById('uploadLocalBtn');
    const originalBtnText = btn.innerHTML;
    btn.innerHTML = '<div class="spinner"></div> Loading…';
    btn.disabled = true;

    try {
      // Revoke previous local URLs to free up memory
      sheetImages.forEach(u => {
        if (u.startsWith(LOCAL_SHEET_PREFIX)) {
          URL.revokeObjectURL(u.substring(LOCAL_SHEET_PREFIX.length));
        }
      });

      const newLocalUrls = Array.from(files, f => LOCAL_SHEET_PREFIX + URL.createObjectURL(f));

      // Merge new local URLs with existing Cloudinary URLs (if any)
      sheetImages = [...newLocalUrls, ...sheetImages.filter(url => !url.startsWith(LOCAL_SHEET_PREFIX))];

      currentPage = 0;
      showPage();
      updatePageNavigation();

      btn.innerHTML = `<span style="color:#27ae60">✓</span> Loaded ${files.length} sheets!`;
      setTimeout(() => {
        btn.innerHTML = originalBtnText;
        btn.disabled = false;
      }, 3000);

      alert('Local sheet music loaded! Local files need to be re-uploaded after refreshing the page. Cloudinary uploaded sheets will be retained.');

    } catch (err) {
      console.error('Failed to load local sheet music:', err);
      btn.innerHTML = `<span style="color:#e74c3c">✗</span> Load Failed`;
      setTimeout(() => {
        btn.innerHTML = originalBtnText;
        btn.disabled = false;
      }, 3000);
      alert('Failed to load local sheet music. Check console for more information.');
    }
  }

  async function handleCloudUpload(files) {
    if (!files.length) return;
    const btn = document.getElementById('uploadCloudBtn');
    const originalBtnText = btn.innerHTML;
    btn.innerHTML = '<div class="spinner"></div> Uploading…';
    btn.disabled = true;

    const uploadedUrls = [];

    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

        const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

        const response = await fetch(uploadUrl, {
          method: 'POST',
          body: formData
        });

        if (!response.ok) {
          throw new Error(`Cloudinary upload failed: ${response.statusText}`);
        }

        const data = await response.json();
        uploadedUrls.push(data.secure_url);
        console.log(`✅ Successfully uploaded ${file.name}:`, data.secure_url);
      }

      // Add new uploaded URLs to the existing sheet list and remove duplicates
      sheetImages = [...new Set([...sheetImages, ...uploadedUrls])];
      saveSheetsToLocalStorage(); // Save to Local Storage

      currentPage = 0;
      showPage();
      updatePageNavigation();

      btn.innerHTML = `<span style="color:#27ae60">✓</span> Uploaded and loaded ${uploadedUrls.length} sheets!`;
      setTimeout(() => {
          btn.innerHTML = originalBtnText;
          btn.disabled = false;
      }, 3000);

    } catch (err) {
      console.error('Failed to upload sheet music:', err);
      btn.innerHTML = `<span style="color:#e74c3c">✗</span> Upload Failed`;
      setTimeout(() => {
          btn.innerHTML = originalBtnText;
          btn.disabled = false;
      }, 3000);
      alert('Failed to upload sheet music. Check console for more information.');
    }
  }

  // Helper function: Update disable state of navigation buttons
  function updateNavButtonsState() {
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');

    const isDisabled = sheetImages.length === 0;
    const isFirstPage = currentPage === 0;
    const isLastPage = currentPage === sheetImages.length - 1;

    // Prev button
    if (prevBtn) {
        prevBtn.disabled = isDisabled || isFirstPage;
    }

    // Next button
    if (nextBtn) {
        nextBtn.disabled = isDisabled || isLastPage;
    }
  }

  function showPage() {
    const img = document.getElementById('sheetDisplay');
    const bottomIndicator = document.getElementById('bottomPageIndicator');

    if (sheetImages.length) {
      if (sheetImages[currentPage].startsWith(LOCAL_SHEET_PREFIX)) {
        img.src = sheetImages[currentPage].substring(LOCAL_SHEET_PREFIX.length);
      } else {
        img.src = sheetImages[currentPage];
      }
      img.style.display = 'block';
      const pageText = `Page: ${currentPage + 1}/${sheetImages.length}`;

      if (bottomIndicator) {
          bottomIndicator.textContent = pageText;
      }
      updatePageNavigation();
      updateNavButtonsState();

    } else {
      img.style.display = 'none';
      if (bottomIndicator) {
          bottomIndicator.textContent = 'No sheets loaded';
      }
      updatePageNavigation();
      updateNavButtonsState();
    }
  }

  function updatePageNavigation() {
    const pageNavContainer = document.getElementById('pageNavigation');
    pageNavContainer.innerHTML = '';

    if (sheetImages.length === 0) {
        updateNavButtonsState();
        return;
    }

    const maxPagesToShow = 10;
    const startPage = Math.max(0, currentPage - Math.floor(maxPagesToShow / 2));
    const endPage = Math.min(sheetImages.length - 1, startPage + maxPagesToShow - 1);

    if (startPage > 0) {
        const span = document.createElement('span');
        span.textContent = '...';
        span.classList.add('page-nav-ellipsis');
        pageNavContainer.appendChild(span);
    }

    for (let i = startPage; i <= endPage; i++) {
      const pageButton = document.createElement('button');
      pageButton.textContent = i + 1;
      pageButton.classList.add('page-nav-button');
      if (i === currentPage) {
        pageButton.classList.add('active');
      }
      pageButton.addEventListener('click', () => {
        currentPage = i;
        showPage();
      });
      pageNavContainer.appendChild(pageButton);
    }

    if (endPage < sheetImages.length - 1) {
        const span = document.createElement('span');
        span.textContent = '...';
        span.classList.add('page-nav-ellipsis');
        pageNavContainer.appendChild(span);
    }
    updateNavButtonsState();
  }


  function nextPage() {
    if (!sheetImages.length || flipCooldown) return;
    if (currentPage < sheetImages.length - 1) {
        flipCooldown = true;
        currentPage++;
        showPage();
        setTimeout(() => (flipCooldown = false), 1000);
    }
  }

  function prevPage() {
    if (!sheetImages.length || flipCooldown) return;
    if (currentPage > 0) {
        flipCooldown = true;
        currentPage--;
        showPage();
        setTimeout(() => (flipCooldown = false), 1000);
    }
  }


  /* ---------- MediaPipe Hands Related Logic ---------- */
  async function setupHandDetection() {
    const videoElement = document.getElementById('video');
    // MediaPipe Hands model path
    const hands = new Hands({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${file}`;
      }
    });

    hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1, // Model complexity: 0, 1, 2. Higher is more accurate but slower.
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.7
    });

    hands.onResults(onHandDetectionResults);

    // Use Camera object to send video frames to MediaPipe
    const camera = new Camera(videoElement, {
      onFrame: async () => {
        await hands.send({ image: videoElement });
      },
      width: 640,
      height: 480
    });
    camera.start();
    console.log('✅ MediaPipe Hands detection started');
  }

  function onHandDetectionResults(results) {
    // ****** Determine whether to perform hand raise detection based on currentTriggerMode ******
    if (!(currentTriggerMode === 'handRaise' || currentTriggerMode === 'all')) {
        return; // If current mode is not hand raise or all, do not process hand gestures
    }

    if (handGestureCooldown) {
      return;
    }

    // Get actual video element dimensions for converting normalized coordinates
    const videoElement = document.getElementById('video');
    const videoHeight = videoElement.offsetHeight;
    const videoWidth = videoElement.offsetWidth;
    // Calculate Y-coordinate pixel threshold for hand raise (0 is top, 1 is bottom)
    const raiseYThresholdPx = videoHeight * RAISE_HAND_Y_THRESHOLD_PERCENT;

    let leftHandRaised = false; // User's left hand
    let rightHandRaised = false; // User's right hand

    if (results.multiHandLandmarks && results.multiHandedness) {
      // Iterate through each detected hand
      for (let i = 0; i < results.multiHandLandmarks.length; i++) {
        const landmarks = results.multiHandLandmarks[i];
        const handedness = results.multiHandedness[i].label; // "Left" or "Right" as detected by MediaPipe

        // Extract wrist landmark (landmark 0) normalized Y coordinate
        const wristY = landmarks[0].y * videoHeight; // Convert to pixel coordinate
        const wristX = landmarks[0].x * videoWidth; // Convert to pixel coordinate

        // Determine if hand is raised: wrist Y coordinate is below the threshold (closer to top of screen)
        const isRaised = wristY < raiseYThresholdPx;

        if (isRaised) {
          // For a front-facing camera ('user' facingMode), the image is mirrored:
          // User's own RIGHT hand (MediaPipe label 'Left') appears on the LEFT side of the screen.
          // User's own LEFT hand (MediaPipe label 'Right') appears on the RIGHT side of the screen.

          if (handedness === 'Left' && wristX < videoWidth / 2) {
              // Detected user's RIGHT hand (MediaPipe label 'Left') on the left half of the screen
              rightHandRaised = true; // Mark user's right hand as raised
              console.log("Right hand raised detected (flip next page)");
          } else if (handedness === 'Right' && wristX > videoWidth / 2) {
              // Detected user's LEFT hand (MediaPipe label 'Right') on the right half of the screen
              leftHandRaised = true; // Mark user's left hand as raised
              console.log("Left hand raised detected (flip previous page)");
          }
        }
      }
    }

    // Trigger page flip based on hand detection
    // Prioritize left hand (previous page) if both are raised simultaneously
    if (leftHandRaised) {
      prevPage();
      handGestureCooldown = true;
      setTimeout(() => (handGestureCooldown = false), HAND_COOLDOWN_MS);
    } else if (rightHandRaised) {
      nextPage();
      handGestureCooldown = true;
      setTimeout(() => (handGestureCooldown = false), HAND_COOLDOWN_MS);
    }
  }

})();
