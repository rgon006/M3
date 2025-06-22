/* ========== 全局状态 ========== */
let sheetImages = []; // 将存储乐谱的 URL 数组
let currentPage = 0;
let flipCooldown = false; // 翻页冷却

// 头部姿态检测的冷却时间和阈值
let headTurnCooldown = false; 
const HEAD_TURN_COOLDOWN_MS = 500; 
const YAW_THRESHOLD = 5; // *** 降低阈值，建议从8开始测试，或根据您之前的调试结果来定 ***

// 手势检测相关常量
let handGestureCooldown = false; 
const HAND_COOLDOWN_MS = 1500; 
const RAISE_HAND_Y_THRESHOLD_PERCENT = 0.4; 

// ****** 新增：当前选择的触发模式 ******
let currentTriggerMode = 'mouth'; // 默认张嘴触发

// Cloudinary 配置 (TODO: 替换为您的 Cloudinary 信息)
const CLOUDINARY_CLOUD_NAME = "your_cloudinary_cloud_name"; 
const CLOUDINARY_UPLOAD_PRESET = "your_unsigned_upload_preset"; 

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
      
      // 检查 FaceLandmark68Net 是否加载
      if (!faceapi.nets.faceLandmark68Net.isLoaded) {
          console.warn('FaceLandmark68Net 未加载，跳过地标检测相关功能。');
          return;
      }

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
            if (mouth && mouth.length >= 20) {
                const topLipY = averageY([
                  mouth[2], mouth[3], mouth[4], mouth[13], mouth[14], mouth[15]
                ]);
                const bottomLipY = averageY([
                  mouth[8], mouth[9], mouth[10], mouth[17], mouth[18], mouth[19]
                ]);
                const mouthHeight = bottomLipY - topLipY;
                if (mouthHeight > 15) { // 嘴巴张开超过阈值
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

                if (yawDifference > YAW_THRESHOLD) { // 头向左转 (用户自己的左边)
                    console.log('检测到头向左转，翻回上页！');
                    prevPage();
                    headTurnCooldown = true;
                    setTimeout(() => (headTurnCooldown = false), HEAD_TURN_COOLDOWN_MS);
                } else if (yawDifference < -YAW_THRESHOLD) { // 头向右转 (用户自己的右边)
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

  function averageY(points) {
    if (!points || points.length === 0) return 0;
    return points.reduce((sum, pt) => sum + pt.y, 0) / points.length;
  }

  function averageX(points) {
    if (!points || points.length === 0) return 0;
    return points.reduce((sum, pt) => sum + pt.x, 0) / points.length;
  }
  /* ---------- 核心人脸检测和辅助函数 END ---------- */


  try {
    /* 2) 加载模型 (从本地 models 文件夹) */
    const MODEL_URL = 'https://raw.githubusercontent.com/rgon006/MMM2/main/models'; 
    await Promise.all([
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
        return; 
      }
    }

    /* 4) 启动人脸检测循环 */
    detectFaces();

    // ****** 新增：设置手部检测 ******
    // 手部检测现在也需要根据模式来启用/禁用
    setupHandDetection(); // MediaPipe Hands 初始化必须始终进行，但其结果处理会受模式控制

    // 从 Local Storage 加载之前上传的乐谱
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

  /* 5) 绑定文件上传事件 (保持不变) */
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
          
  /* ---------- Cloudinary & Local Storage 相关的辅助函数 (保持不变) ---------- */

  function loadSheetsFromLocalStorage() { /* ... 保持不变 ... */ }
  function saveSheetsToLocalStorage() { /* ... 保持不变 ... */ }
  async function handleLocalUpload(files) { /* ... 保持不变 ... */ }
  async function handleCloudUpload(files) { /* ... 保持不变 ... */ }
  function updateNavButtonsState() { /* ... 保持不变 ... */ }
  function showPage() { /* ... 保持不变 ... */ }
  function updatePageNavigation() { /* ... 保持不变 ... */ }
  function nextPage() { /* ... 保持不变 ... */ }
  function prevPage() { /* ... 保持不变 ... */ }


  /* ---------- MediaPipe Hands 相关逻辑 (修改 onHandDetectionResults) ---------- */
  async function setupHandDetection() {
    const videoElement = document.getElementById('video');
    const hands = new Hands({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${file}`;
      }
    });

    hands.setOptions({
      maxNumHands: 2, 
      modelComplexity: 1, 
      minDetectionConfidence: 0.7, 
      minTrackingConfidence: 0.7 
    });

    hands.onResults(onHandDetectionResults); 

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

    const videoElement = document.getElementById('video');
    const videoHeight = videoElement.offsetHeight;
    const videoWidth = videoElement.offsetWidth;
    const raiseYThresholdPx = videoHeight * RAISE_HAND_Y_THRESHOLD_PERCENT; 

    let leftHandRaised = false; 
    let rightHandRaised = false; 

    if (results.multiHandLandmarks && results.multiHandedness) {
      for (let i = 0; i < results.multiHandLandmarks.length; i++) {
        const landmarks = results.multiHandLandmarks[i];
        const handedness = results.multiHandedness[i].label; 

        const wristY = landmarks[0].y * videoHeight; 
        const wristX = landmarks[0].x * videoWidth; 

        const isRaised = wristY < raiseYThresholdPx;
        
        if (isRaised) {
          if (handedness === 'Left' && wristX < videoWidth / 2) {
              rightHandRaised = true; 
              console.log("检测到举起右手 (翻下一页)");
          } else if (handedness === 'Right' && wristX > videoWidth / 2) {
              leftHandRaised = true; 
              console.log("检测到举起左手 (翻上一页)");
          }
        }
      }
    }

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