/* ========== 全局状态 ========== */
let sheetImages = []; // 将存储乐谱的 URL 数组
let currentPage = 0;
let flipCooldown = false;
let headTurnCooldown = false;
const HEAD_TURN_COOLDOWN_MS = 1500;
const YAW_THRESHOLD = 15;

// ****** 新增：手势检测相关常量 ******
let handGestureCooldown = false; // 手势翻页冷却
const HAND_COOLDOWN_MS = 1500; // 手势翻页冷却时间 (毫秒)
// 举手Y坐标阈值百分比 (手腕Y坐标低于此阈值算举手，0是顶部，1是底部)
// 例如0.4表示手腕在视频上半部分40%以上
const RAISE_HAND_Y_THRESHOLD_PERCENT = 0.3; 

// ****** Cloudinary 配置 ******
const CLOUDINARY_CLOUD_NAME = "dje3ekclp"; 
const CLOUDINARY_UPLOAD_PRESET = "my_unsigned_upload"; 

// 存储乐谱URL到Local Storage的键名
const LOCAL_STORAGE_SHEETS_KEY = 'pianoSheetUrls';
// 本地上传乐谱的标识前缀
const LOCAL_SHEET_PREFIX = 'local_';

/* ========== 立即执行的初始化 ========== */
(async () => {
  /* 0) 检查 faceapi 和 MediaPipe 是否存在 */
  if (!window.faceapi) {
    alert('face-api.min.js 没加载到，检查 libs/face-api.min.js 路径或服务器根目录');
    return;
  }
  // 检查 MediaPipe Hands 是否加载
  if (!window.Hands) {
    alert('MediaPipe Hands 没加载到，检查 https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/hands.js 路径');
    return;
  }
  const faceapi = window.faceapi;
  console.log('✅ faceapi 准备就绪', faceapi);
  console.log('✅ MediaPipe Hands 准备就绪', window.Hands); // 确认 MediaPipe Hands 加载

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

      const detections = await faceapi
        .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks();

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const resized = faceapi.resizeResults(detections, displaySize);
      faceapi.draw.drawFaceLandmarks(canvas, resized);

      for (const d of resized) {
        if (!d.landmarks) {
            console.warn('当前检测对象没有地标信息，跳过嘴巴和头部姿态检测。');
            continue;
        }

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
              nextPage();
            }
        }

        if (!headTurnCooldown) {
            const leftEye = d.landmarks.getLeftEye();
            const rightEye = d.landmarks.getRightEye();
            const nose = d.landmarks.getNose();

            if (leftEye.length > 0 && rightEye.length > 0 && nose.length > 0) {
                const leftEyeCenterX = averageX(leftEye);
                const rightEyeCenterX = averageX(rightEye);
                const noseTipX = nose[0].x;

                const eyeMidPointX = (leftEyeCenterX + rightEyeCenterX) / 2;
                const yawDifference = noseTipX - eyeMidPointX;

                if (yawDifference > YAW_THRESHOLD) { // 头向左转
                    console.log('检测到头向左转，翻回上页！');
                    prevPage();
                    headTurnCooldown = true;
                    setTimeout(() => (headTurnCooldown = false), HEAD_TURN_COOLDOWN_MS);
                } else if (yawDifference < -YAW_THRESHOLD) { // 头向右转
                    console.log('检测到头向右转，翻到下页！');
                    nextPage();
                    headTurnCooldown = true;
                    setTimeout(() => (headTurnCooldown = false), HEAD_TURN_COOLDOWN_MS);
                }
            }
        }
      }
    }, 300);
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
    /* 2) 加载模型 */
    const MODEL_URL = 'https://raw.githubusercontent.com/rgon006/MMM3/main/models'; 
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
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
          facingMode: 'user' // 尝试前置摄像头
        }
      });
      video.srcObject = stream;
      console.log('✅ 摄像头（前置）已打开');
    } catch (err) {
      console.warn('获取前置摄像头失败，尝试获取后置摄像头:', err);
      // 如果前置摄像头不可用，尝试后置摄像头作为备用
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: 'environment' // 尝试后置摄像头
          }
        });
        video.srcObject = stream;
        console.log('✅ 摄像头（后置）已打开');
        alert('前置摄像头不可用，已尝试使用后置摄像头。');
      } catch (err2) {
        console.error('无法访问任何摄像头:', err2);
        alert(`无法访问任何摄像头: ${err2.message}\n请确保已授权并尝试刷新页面。`);
        return; // 如果都失败，则终止后续操作
      }
    }

    /* 4) 启动人脸检测循环 */
    detectFaces();

    // ****** 新增：设置手部检测 ******
    setupHandDetection(); // 调用新的手部检测设置函数

    // 从 Local Storage 加载之前上传的乐谱
    loadSheetsFromLocalStorage();

    // ****** 绑定所有上下翻页按钮事件 ******
    const topPrevBtn = document.getElementById('topPrevPageBtn');
    const topNextBtn = document.getElementById('topNextPageBtn');
    const bottomPrevBtn = document.getElementById('bottomPrevPageBtn');
    const bottomNextBtn = document.getElementById('bottomNextPageBtn');

    if (topPrevBtn) {
        topPrevBtn.addEventListener('click', prevPage);
    }
    if (topNextBtn) {
        topNextBtn.addEventListener('click', nextPage);
    }
    if (bottomPrevBtn) {
        bottomPrevBtn.addEventListener('click', prevPage);
    }
    if (bottomNextBtn) {
        bottomNextBtn.addEventListener('click', nextPage);
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
        sheetImages = JSON.parse(storedUrls);
        sheetImages = sheetImages.filter(url => !url.startsWith(LOCAL_SHEET_PREFIX) || URL.createObjectURL); 
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
      sheetImages.forEach(u => {
        if (u.startsWith(LOCAL_SHEET_PREFIX)) {
          URL.revokeObjectURL(u.substring(LOCAL_SHEET_PREFIX.length));
        }
      });

      const newLocalUrls = Array.from(files, f => LOCAL_SHEET_PREFIX + URL.createObjectURL(f));
      
      sheetImages = [...newLocalUrls, ...sheetImages.filter(url => !url.startsWith(LOCAL_SHEET_PREFIX))];

      currentPage = 0;
      showPage();
      updatePageNavigation();

      btn.innerHTML = `<span style="color:#27ae60">✓</span> 加载了 ${files.length} 张！`;
      setTimeout(() => {
        btn.innerHTML = originalBtnText;
        btn.disabled = false;
      }, 3000);

      alert('本地乐谱已加载！刷新页面后需要重新上传。');

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

      sheetImages = [...new Set([...sheetImages, ...uploadedUrls])];
      saveSheetsToLocalStorage(); 

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

  // 辅助函数：统一更新所有翻页按钮的禁用状态
  function updateNavButtonsState() {
    const topPrevBtn = document.getElementById('topPrevPageBtn');
    const topNextBtn = document.getElementById('topNextPageBtn');
    const bottomPrevBtn = document.getElementById('bottomPrevPageBtn');
    const bottomNextBtn = document.getElementById('bottomNextPageBtn');

    const isDisabled = sheetImages.length === 0;
    const isFirstPage = currentPage === 0;
    const isLastPage = currentPage === sheetImages.length - 1;

    // Prev buttons
    if (topPrevBtn) {
        topPrevBtn.disabled = isDisabled || isFirstPage;
    }
    if (bottomPrevBtn) {
        bottomPrevBtn.disabled = isDisabled || isFirstPage;
    }

    // Next buttons
    if (topNextBtn) {
        topNextBtn.disabled = isDisabled || isLastPage;
    }
    if (bottomNextBtn) {
        bottomNextBtn.disabled = isDisabled || isLastPage;
    }
  }

  function showPage() {
    const img = document.getElementById('sheetDisplay');
    const topIndicator = document.getElementById('topPageIndicator'); 
    const bottomIndicator = document.getElementById('bottomPageIndicator'); 

    if (sheetImages.length) {
      if (sheetImages[currentPage].startsWith(LOCAL_SHEET_PREFIX)) {
        img.src = sheetImages[currentPage].substring(LOCAL_SHEET_PREFIX.length);
      } else {
        img.src = sheetImages[currentPage];
      }
      img.style.display = 'block';
      const pageText = `Page: ${currentPage + 1}/${sheetImages.length}`;

      if (topIndicator) {
          topIndicator.textContent = pageText;
      }
      if (bottomIndicator) {
          bottomIndicator.textContent = pageText;
      }
      updatePageNavigation(); 
      updateNavButtonsState(); // 调用统一更新按钮状态的函数

    } else {
      img.style.display = 'none';
      if (topIndicator) {
          topIndicator.textContent = 'No sheets loaded';
      }
      if (bottomIndicator) {
          bottomIndicator.textContent = 'No sheets loaded';
      }
      updatePageNavigation(); 
      updateNavButtonsState(); // 调用统一更新按钮状态的函数
    }
  }

  function updatePageNavigation() {
    const pageNavContainer = document.getElementById('pageNavigation');
    pageNavContainer.innerHTML = ''; 

    if (sheetImages.length === 0) {
        updateNavButtonsState(); // 确保没有乐谱时禁用所有按钮
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
    updateNavButtonsState(); // 在生成页码导航后，也更新上下翻页按钮的状态
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


  /* ---------- 新增：MediaPipe Hands 相关逻辑 ---------- */
  async function setupHandDetection() {
    const videoElement = document.getElementById('video');
    // MediaPipe Hands 模型路径
    const hands = new Hands({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${file}`;
      }
    });

    hands.setOptions({
      maxNumHands: 2, // 最多检测两只手
      modelComplexity: 1, // 模型复杂度，0, 1, 2。越高越准但越慢
      minDetectionConfidence: 0.7, // 最小检测置信度
      minTrackingConfidence: 0.7 // 最小跟踪置信度
    });

    hands.onResults(onHandDetectionResults); // 设置回调函数

    // 使用 Camera 对象发送视频帧到 MediaPipe
    // Camera API 通常用于 MediaPipe 示例，以确保帧被正确处理
    const camera = new Camera(videoElement, {
      onFrame: async () => {
        await hands.send({ image: videoElement });
      },
      width: 640, // 确保与video元素的宽度一致
      height: 480 // 确保与video元素的高度一致
    });
    camera.start();
    console.log('✅ MediaPipe Hands 检测已启动');
  }

  function onHandDetectionResults(results) {
    // 检查是否处于手势冷却期，如果是则不处理
    if (handGestureCooldown) {
      return; 
    }

    // 获取视频元素的实际尺寸，用于将归一化坐标转换为像素坐标
    const videoElement = document.getElementById('video');
    const videoHeight = videoElement.offsetHeight;
    const videoWidth = videoElement.offsetWidth;
    // 计算举手Y坐标的像素阈值
    // MediaPipe的Y轴0是顶部，所以Y值越小表示越靠近顶部
    const raiseYThresholdPx = videoHeight * RAISE_HAND_Y_THRESHOLD_PERCENT; 

    let leftHandRaised = false; // 用户自己的左手是否举起
    let rightHandRaised = false; // 用户自己的右手是否举起

    if (results.multiHandLandmarks && results.multiHandedness) {
      // 遍历检测到的每只手
      for (let i = 0; i < results.multiHandLandmarks.length; i++) {
        const landmarks = results.multiHandLandmarks[i];
        const handedness = results.multiHandedness[i].label; // "Left" 或 "Right"

        // 提取手腕关键点 (landmark 0) 的归一化 Y 坐标
        const wristY = landmarks[0].y * videoHeight; // 转换为像素坐标
        const wristX = landmarks[0].x * videoWidth; // 转换为像素坐标

        // 判断手是否举起：手腕 Y 坐标低于阈值（即更靠近屏幕顶部）
        const isRaised = wristY < raiseYThresholdPx;
        
        if (isRaised) {
          // 在前置摄像头（user facingMode）下，画面是镜像的：
          // 用户自己的右手 (MediaPipe label 'Left') 会出现在屏幕的左侧。
          // 用户自己的左手 (MediaPipe label 'Right') 会出现在屏幕的右侧。

          if (handedness === 'Left' && wristX < videoWidth / 2) {
              // 识别到用户自己的右手 (MediaPipe label 'Left') 且在屏幕左半边
              rightHandRaised = true; // 标记用户右手举起
              console.log("检测到举起右手 (翻下一页)");
          } else if (handedness === 'Right' && wristX > videoWidth / 2) {
              // 识别到用户自己的左手 (MediaPipe label 'Right') 且在屏幕右半边
              leftHandRaised = true; // 标记用户左手举起
              console.log("检测到举起左手 (翻上一页)");
          }
        }
      }
    }

    // 根据检测结果触发翻页
    // 优先处理左手（向后翻页），如果同时举起，只会触发一个
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