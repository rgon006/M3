/* ========== 全局状态 ========== */
let sheetImages = []; // 将存储乐谱的 URL 数组
let currentPage = 0;
let flipCooldown = false; // 翻页冷却

// 头部姿态检测的冷却时间和阈值
let headTurnCooldown = false; 
const HEAD_TURN_COOLDOWN_MS = 1500; 
const YAW_THRESHOLD = 8; // 偏航角阈值 (像素差值)，您可以根据实际测试调整，建议从8或更低开始测试

// ****** 新增：手势检测相关常量 ******
let handGestureCooldown = false; // 手势翻页冷却
const HAND_COOLDOWN_MS = 1500; // 手势翻页冷却时间 (毫秒)
// 举手Y坐标阈值百分比 (手腕Y坐标低于此阈值算举手，0是顶部，1是底部)
// 例如0.4表示手腕在视频上半部分40%以上
const RAISE_HAND_Y_THRESHOLD_PERCENT = 0.4; 

// ****** 新增：当前选择的触发模式 ******
let currentTriggerMode = 'mouth'; // 默认张嘴触发

// ****** Cloudinary 配置 ******
// TODO: 请替换为您的 Cloudinary Cloud name，根据您提供的截图，您的可能是 "dje3ekclp"
const CLOUDINARY_CLOUD_NAME = "dje3ekclp"; 
// TODO: 请替换为您在 Cloudinary 控制台创建的无符号上传预设名称，根据您提供的截图，您的可能是 "my_unsigned_upload"
const CLOUDINARY_UPLOAD_PRESET = "my_unsigned_upload"; 

// 存储乐谱URL到Local Storage的键名
const LOCAL_STORAGE_SHEETS_KEY = 'pianoSheetUrls';
// 本地上传乐谱的标识前缀
const LOCAL_SHEET_PREFIX = 'local_';

/* ========== 立即执行的初始化 ========== */
(async () => {
  /* 0) 检查 faceapi 和 MediaPipe 是否存在 */
  if (!window.faceapi) {
    alert('face-api.min.js 没加载到，检查 libs/face-api.min.js 路径。');
    return;
  }
  // 检查 MediaPipe Hands 是否加载
  if (!window.Hands) {
    alert('MediaPipe Hands 没加载到，检查 https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/hands.js 路径。');
    return;
  }
  if (!window.Camera) { 
    alert('MediaPipe Camera Utils 没加载到，检查 https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3/camera_utils.js 路径。');
    return;
  }

  const faceapi = window.faceapi;
  console.log('✅ faceapi 准备就绪', faceapi);
  console.log('✅ MediaPipe Hands 准备就绪', window.Hands); 
  console.log('✅ MediaPipe Camera Utils 准备就绪', window.Camera); 

  /* 1) 显示加载动画 */
  document.getElementById('loading').style.display = 'block';

  /* ---------- 核心人脸检测和辅助函数 ---------- */
  function detectFaces() {
    const video = document.getElementById('video');
    const canvas = document.getElementById('overlay');
    const displaySize = { width: video.width, height: video.height };
    faceapi.matchDimensions(canvas, displaySize);

    setInterval(async () => {
      if (video.readyState !== 4) return;
      
      // 检查 FaceLandmark68Net 是否加载，避免错误
      if (!faceapi.nets.faceLandmark68Net.isLoaded) {
          console.warn('FaceLandmark68Net 未加载，跳过地标检测相关功能。');
          return;
      }

      // ****** 使用 SsdMobilenetv1Options() for more accuracy ******
      const detections = await faceapi
        .detectAllFaces(video, new faceapi.SsdMobilenetv1Options()) 
        .withFaceLandmarks();

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const resized = faceapi.resizeResults(detections, displaySize);
      faceapi.draw.drawFaceLandmarks(canvas, resized);

      for (const d of resized) {
        if (!d.landmarks) {
            //console.warn('当前检测对象没有地标信息，跳过嘴巴和头部姿态检测。'); // 避免刷屏
            continue;
        }

        // ****** 根据 currentTriggerMode 判断是否执行嘴巴检测 ******
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
                  console.log('检测到张嘴，翻页！');
                  nextPage();
                }
            }
        }

        // ****** 根据 currentTriggerMode 判断是否执行扭头检测 ******
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
                // console.log('yawDifference:', yawDifference); // 调试用，稳定后可以移除

                if (yawDifference > YAW_THRESHOLD) { // Head turned left (relative to face orientation)
                    console.log('检测到头向左转，翻回上页！');
                    prevPage();
                    headTurnCooldown = true;
                    setTimeout(() => (headTurnCooldown = false), HEAD_TURN_COOLDOWN_MS);
                } else if (yawDifference < -YAW_THRESHOLD) { // Head turned right
                    console.log('检测到头向右转，翻到下页！');
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
  /* ---------- 核心人脸检测和辅助函数 END ---------- */


  try {
    /* 2) 加载模型 (从本地 models 文件夹) */
    const MODEL_URL = './models'; // Point to your local models folder
    await Promise.all([
      // ****** 加载 ssdMobilenetv1 模型 ******
      faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL), 
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL)
    ]);

    console.log('✅ 模型加载完成');

    /* 3) 打开摄像头 */
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
      console.log('✅ 摄像头（前置）已打开');
    } catch (err) {
      console.warn('获取前置摄像头失败，尝试获取后置摄像头:', err);
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
        console.log('✅ 摄像头（后置）已打开');
        alert('前置摄像头不可用，已尝试使用后置摄像头。');
      } catch (err2) {
        console.error('无法访问任何摄像头:', err2);
        alert(`无法访问任何摄像头: ${err2.message}\n请确保已授权并尝试刷新页面。`);
        return; // If both fail, terminate
      }
    }

    /* 4) 启动人脸检测循环 */
    detectFaces();

    // ****** 新增：设置手部检测 ******
    // MediaPipe Hands 初始化必须始终进行，但其结果处理会受模式控制
    setupHandDetection(); 

    // From Local Storage load previously uploaded sheets
    loadSheetsFromLocalStorage();

    // ****** 绑定翻页按钮事件 ******
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');

    if (prevBtn) {
        prevBtn.addEventListener('click', prevPage);
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', nextPage);
    }

    // ****** 新增：绑定触发模式选择事件 ******
    const triggerModeSelect = document.getElementById('triggerModeSelect');
    if (triggerModeSelect) {
        // 从 LocalStorage 读取上次选择的模式，如果没有，则默认为 'mouth'
        const storedMode = localStorage.getItem('selectedTriggerMode');
        if (storedMode) {
            triggerModeSelect.value = storedMode;
        }
        currentTriggerMode = triggerModeSelect.value; // 初始化当前模式
        
        triggerModeSelect.addEventListener('change', (event) => {
            currentTriggerMode = event.target.value;
            localStorage.setItem('selectedTriggerMode', currentTriggerMode); // 保存选择
            console.log('当前触发模式已切换为:', currentTriggerMode);
        });
    }

  } catch (err) {
    console.error('Initialization failed:', err);
    alert(`初始化失败: ${err.message}`);
    return;
  } finally {
    document.getElementById('loading').style.display = 'none';
  }

  /* 5) 绑定文件上传事件 */
  document.getElementById('uploadCloudBtn')
          .addEventListener('click', () => { 
            const fileInput = document.getElementById('sheetInput');
            if (fileInput.files.length === 0) {
                alert('请选择乐谱文件进行上传！');
                return;
            }
            handleCloudUpload(fileInput.files);
          });

  document.getElementById('uploadLocalBtn')
          .addEventListener('click', () => { 
            const fileInput = document.getElementById('sheetInput');
            if (fileInput.files.length === 0) {
                alert('请选择乐谱文件进行上传！');
                return;
            }
            handleLocalUpload(fileInput.files);
          });
          
  /* ---------- Cloudinary & Local Storage 相关的辅助函数 ---------- */

  function loadSheetsFromLocalStorage() {
    console.log('正在从 Local Storage 加载乐谱...');
    const storedUrls = localStorage.getItem(LOCAL_STORAGE_SHEETS_KEY);
    if (storedUrls) {
      try {
        // Filter out local URLs as they become invalid after refresh
        sheetImages = JSON.parse(storedUrls);
        sheetImages = sheetImages.filter(url => !url.startsWith(LOCAL_SHEET_PREFIX));
        currentPage = 0;
        showPage(); 
        updatePageNavigation(); 
        console.log(`✅ 从 Local Storage 加载了 ${sheetImages.length} 张乐谱。`);
      } catch (e) {
        console.error('解析 Local Storage 中的乐谱 URL 失败:', e);
        sheetImages = []; 
      }
    } else {
      console.log('Local Storage 中没有找到乐谱。');
    }
  }

  function saveSheetsToLocalStorage() {
    // Only save Cloudinary URLs; local URLs are invalid after refresh
    const urlsToSave = sheetImages.filter(url => !url.startsWith(LOCAL_SHEET_PREFIX));
    localStorage.setItem(LOCAL_STORAGE_SHEETS_KEY, JSON.stringify(urlsToSave));
    console.log('乐谱已保存到 Local Storage (仅 Cloudinary URL)。');
  }

  function handleLocalUpload(files) {
    if (!files.length) return;
    const btn = document.getElementById('uploadLocalBtn');
    const originalBtnText = btn.innerHTML;
    btn.innerHTML = '<div class="spinner"></div> 加载中…';
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

      btn.innerHTML = `<span style="color:#27ae60">✓</span> 加载了 ${files.length} 张！`;
      setTimeout(() => {
        btn.innerHTML = originalBtnText;
        btn.disabled = false;
      }, 3000);

      alert('本地乐谱已加载！刷新页面后需要重新上传本地文件。Cloudinary上传的乐谱会保留。');

    } catch (err) {
      console.error('加载本地乐谱失败:', err);
      btn.innerHTML = `<span style="color:#e74c3c">✗</span> 加载失败`;
      setTimeout(() => {
        btn.innerHTML = originalBtnText;
        btn.disabled = false;
      }, 3000);
      alert('加载本地乐谱失败。请检查控制台获取更多信息。');
    }
  }

  async function handleCloudUpload(files) {
    if (!files.length) return;
    const btn = document.getElementById('uploadCloudBtn'); 
    const originalBtnText = btn.innerHTML; 
    btn.innerHTML = '<div class="spinner"></div> 上传中…';
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
          throw new Error(`Cloudinary 上传失败: ${response.statusText}`);
        }

        const data = await response.json();
        uploadedUrls.push(data.secure_url); 
        console.log(`✅ 上传 ${file.name} 成功:`, data.secure_url);
      }

      // Add new uploaded URLs to the existing sheet list and remove duplicates
      sheetImages = [...new Set([...sheetImages, ...uploadedUrls])];
      saveSheetsToLocalStorage(); // Save to Local Storage

      currentPage = 0;
      showPage(); 
      updatePageNavigation(); 

      btn.innerHTML = `<span style="color:#27ae60">✓</span> 上传并加载了 ${uploadedUrls.length} 张！`;
      setTimeout(() => {
          btn.innerHTML = originalBtnText;
          btn.disabled = false;
      }, 3000);

    } catch (err) {
      console.error('上传乐谱失败:', err);
      btn.innerHTML = `<span style="color:#e74c3c">✗</span> 上传失败`;
      setTimeout(() => {
          btn.innerHTML = originalBtnText;
          btn.disabled = false;
      }, 3000);
      alert('上传乐谱失败。请检查控制台获取更多信息。');
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


  /* ---------- MediaPipe Hands 相关逻辑 ---------- */
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
    console.log('✅ MediaPipe Hands 检测已启动');
  }

  function onHandDetectionResults(results) {
    // ****** 根据 currentTriggerMode 判断是否执行举手检测 ******
    if (!(currentTriggerMode === 'handRaise' || currentTriggerMode === 'all')) {
        return; // 如果当前模式不是举手或所有，则不处理手势
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
              console.log("检测到举起右手 (翻下一页)");
          } else if (handedness === 'Right' && wristX > videoWidth / 2) {
              // Detected user's LEFT hand (MediaPipe label 'Right') on the right half of the screen
              leftHandRaised = true; // Mark user's left hand as raised
              console.log("检测到举起左手 (翻上一页)");
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