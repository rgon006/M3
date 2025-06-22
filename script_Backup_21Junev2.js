/* ========== 全局状态 ========== */
let sheetImages = []; // 将存储乐谱的 URL 数组
let currentPage = 0;
let flipCooldown = false;
// 新增：头部姿态检测的冷却时间
let headTurnCooldown = false;
const HEAD_TURN_COOLDOWN_MS = 1500; // 扭头翻页冷却时间 (毫秒)，可调整
const YAW_THRESHOLD = 15; // 偏航角阈值 (像素差值)，需要根据实际测试调整

// ****** Cloudinary 配置 ******
// TODO: 请将 "YOUR_CLOUDINARY_CLOUD_NAME" 替换为您的 Cloudinary Cloud name
const CLOUDINARY_CLOUD_NAME = "dje3ekclp"; 
// TODO: 请将 "YOUR_UNSIGNED_UPLOAD_PRESET" 替换为您在 Cloudinary 控制台创建的无符号上传预设名称
// 例如：如果您创建的预设名为 "my_unsigned_upload"，这里就写 "my_unsigned_upload"
const CLOUDINARY_UPLOAD_PRESET = "my_unsigned_upload"; 

// 存储乐谱URL到Local Storage的键名
const LOCAL_STORAGE_SHEETS_KEY = 'pianoSheetUrls';


/* ========== 立即执行的初始化 ========== */
(async () => {
  /* 0) 检查 faceapi 是否存在 */
  if (!window.faceapi) {
    alert('face-api.min.js 没加载到，检查 libs/face-api.min.js 路径或服务器根目录');
    return;
  }
  const faceapi = window.faceapi;
  console.log('✅ faceapi 准备就绪', faceapi);

  /* 1) 显示加载动画 */
  document.getElementById('loading').style.display = 'block';

  try {
    /* 2) 加载模型 */
    // 注意：如果您已经把模型文件下载到本地，建议使用相对路径 './models'
    // 否则如果直接使用 raw.githubusercontent.com 可能会遇到 CORS 或速率限制问题
    const MODEL_URL = 'https://raw.githubusercontent.com/rgon006/MMM3/main/models'; // 您的模型URL
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL)
    ]);

    console.log('✅ 模型加载完成');

    /* 3) 打开摄像头 */
    const video = document.getElementById('video');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 }
    });
    video.srcObject = stream;

    /* 4) 启动人脸检测循环 */
    detectFaces();

    // ****** 新增：从 Local Storage 加载之前上传的乐谱 ******
    loadSheetsFromLocalStorage();

  } catch (err) {
    console.error('Initialization failed:', err);
    alert(`Camera error: ${err.message}`);
    return;
  } finally {
    document.getElementById('loading').style.display = 'none';
  }

  /* 5) 绑定文件上传事件 */
  document.getElementById('sheetInput')
          .addEventListener('change', handleFileUpload);

  /* ---------- Cloudinary & Local Storage 相关的辅助函数 ---------- */

  // 从 Local Storage 加载乐谱 URL
  function loadSheetsFromLocalStorage() {
    console.log('正在从 Local Storage 加载乐谱...');
    const storedUrls = localStorage.getItem(LOCAL_STORAGE_SHEETS_KEY);
    if (storedUrls) {
      try {
        // 解析存储的 JSON 字符串为数组
        sheetImages = JSON.parse(storedUrls);
        currentPage = 0;
        showPage(); // 显示加载后的第一页乐谱
        console.log(`✅ 从 Local Storage 加载了 ${sheetImages.length} 张乐谱。`);
      } catch (e) {
        console.error('解析 Local Storage 中的乐谱 URL 失败:', e);
        sheetImages = []; // 清空，避免数据损坏
      }
    } else {
      console.log('Local Storage 中没有找到乐谱。');
    }
  }

  // 将乐谱 URL 保存到 Local Storage
  function saveSheetsToLocalStorage() {
    localStorage.setItem(LOCAL_STORAGE_SHEETS_KEY, JSON.stringify(sheetImages));
    console.log('乐谱已保存到 Local Storage。');
  }

  /* ---------- 其余函数（保持原有的或根据之前讨论进行更新） ---------- */
  function detectFaces() {
    const video = document.getElementById('video');
    const canvas = document.getElementById('overlay');
    const displaySize = { width: video.width, height: video.height };
    faceapi.matchDimensions(canvas, displaySize);

    setInterval(async () => {
      if (video.readyState !== 4) return; // 摄像头未就绪

      // 确保地标模型已加载
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
        // 确保检测到地标
        if (!d.landmarks) {
            console.warn('当前检测对象没有地标信息，跳过嘴巴和头部姿态检测。');
            continue;
        }

        // --- 张嘴检测 (现有功能) ---
        // 使用您代码中现有的 getMouth() 和自定义 averageY
        const mouth = d.landmarks.getMouth();
        // 检查 mouth 数组是否有效且包含足够的地标点
        if (mouth && mouth.length >= 20) { // 确保 mouth 数组有足够的点来计算
            const topLipY = averageY([
              mouth[2],  // 50
              mouth[3],  // 51 (top center)
              mouth[4],  // 52
              mouth[13], // 61
              mouth[14], // 62
              mouth[15]  // 63
            ]);

            const bottomLipY = averageY([
              mouth[8],  // 56
              mouth[9],  // 57 (bottom center)
              mouth[10], // 58
              mouth[17], // 65
              mouth[18], // 66
              mouth[19]  // 67
            ]);

            const mouthHeight = bottomLipY - topLipY;
            // console.log('嘴巴高度:', mouthHeight); // 调试用
            if (mouthHeight > 15) { // 张嘴阈值（可以调）
              nextPage(); // 调用 nextPage，这里是向右翻页
              // console.log('张嘴翻页触发！');
              // break; // 如果只允许一种方式翻页，可以保留 break
            }
        } else {
            // console.warn('嘴巴地标不完整，跳过张嘴检测。');
        }


        // --- 头部扭动检测 (新增功能) ---
        if (!headTurnCooldown) {
            const leftEye = d.landmarks.getLeftEye(); // 左眼地标点数组
            const rightEye = d.landmarks.getRightEye(); // 右眼地标点数组
            const nose = d.landmarks.getNose(); // 鼻子地标点数组 (鼻尖是第一个点)

            // 确保关键地标存在
            if (leftEye.length > 0 && rightEye.length > 0 && nose.length > 0) {
                // 取眼睛和鼻子的中心点作为参考
                const leftEyeCenterX = averageX(leftEye);
                const rightEyeCenterX = averageX(rightEye);
                const noseTipX = nose[0].x; // 鼻尖的X坐标

                // 简化：使用鼻尖X坐标与两眼中心X坐标的相对位置判断偏航
                // 想象一下：头向左转，鼻尖会相对于两眼中心向右偏移（从摄像头的视角看）
                // 头向右转，鼻尖会相对于两眼中心向左偏移
                const eyeMidPointX = (leftEyeCenterX + rightEyeCenterX) / 2;
                const yawDifference = noseTipX - eyeMidPointX;

                // console.log('Yaw Difference (鼻尖X - 眼睛中心X):', yawDifference); // 调试用

                if (yawDifference > YAW_THRESHOLD) { // 鼻尖相对于眼睛中心向右偏移 -> 头向左转
                    console.log('检测到头向左转，翻回上页！');
                    prevPage();
                    headTurnCooldown = true;
                    setTimeout(() => (headTurnCooldown = false), HEAD_TURN_COOLDOWN_MS);
                } else if (yawDifference < -YAW_THRESHOLD) { // 鼻尖相对于眼睛中心向左偏移 -> 头向右转
                    console.log('检测到头向右转，翻到下页！');
                    nextPage(); // 调用 nextPage
                    headTurnCooldown = true;
                    setTimeout(() => (headTurnCooldown = false), HEAD_TURN_COOLDOWN_MS);
                }
            } else {
                // console.warn('获取眼睛或鼻子地标失败，跳过头部扭动检测。');
            }
        }
      }
    }, 300);
  }

  // 您已有的 averageY 函数
  function averageY(points) {
    if (!points || points.length === 0) return 0; // 防止除以零
    return points.reduce((sum, pt) => sum + pt.y, 0) / points.length;
  }

  // 新增 averageX 函数，用于计算X坐标平均值
  function averageX(points) {
    if (!points || points.length === 0) return 0;
    return points.reduce((sum, pt) => sum + pt.x, 0) / points.length;
  }

  // ****** 修改 handleFileUpload 函数以使用 Cloudinary 上传 ******
  async function handleFileUpload(e) {
    const files = e.target.files;
    if (!files.length) return;
    const btn = document.querySelector('.upload-btn');
    const originalBtnText = btn.innerHTML; // 保存原始按钮文本
    btn.innerHTML = '<div class="spinner"></div> 上传中…';
    btn.disabled = true; // 禁用按钮防止重复点击

    const uploadedUrls = [];

    try {
      // 遍历所有选中的文件
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET); // 使用无符号上传预设

        // Cloudinary 的上传 API URL 格式
        const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

        const response = await fetch(uploadUrl, {
          method: 'POST',
          body: formData
        });

        if (!response.ok) {
          throw new Error(`Cloudinary 上传失败: ${response.statusText}`);
        }

        const data = await response.json();
        uploadedUrls.push(data.secure_url); // 获取安全 URL (HTTPS)
        console.log(`✅ 上传 ${file.name} 成功:`, data.secure_url);
      }

      // 将新上传的URL添加到现有乐谱列表，并去重
      // 这里使用 Set 来确保 URL 的唯一性
      sheetImages = [...new Set([...sheetImages, ...uploadedUrls])];
      saveSheetsToLocalStorage(); // 保存到 Local Storage

      currentPage = 0;
      showPage(); // 显示新加载的乐谱的第一页

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

  function showPage() {
    const img = document.getElementById('sheetDisplay');
    // 假设页码指示器ID为 pageIndicator，如果您之前修改过顶部和底部指示器ID，请在这里相应修改
    const indicator = document.getElementById('pageIndicator');

    if (sheetImages.length) {
      img.src = sheetImages[currentPage];
      img.style.display = 'block';
      indicator.textContent = `Page: ${currentPage + 1}/${sheetImages.length}`;
    } else {
      img.style.display = 'none';
      indicator.textContent = 'No sheets loaded';
    }
  }

  function nextPage() {
    if (!sheetImages.length || flipCooldown) return;
    flipCooldown = true;
    currentPage = (currentPage + 1) % sheetImages.length;
    showPage();
    setTimeout(() => (flipCooldown = false), 1000);
  }

  // 新增 prevPage 函数
  function prevPage() {
    if (!sheetImages.length || flipCooldown) return;
    flipCooldown = true;
    // (currentPage - 1 + sheetImages.length) % sheetImages.length 确保负数时也能正确循环
    currentPage = (currentPage - 1 + sheetImages.length) % sheetImages.length;
    showPage();
    setTimeout(() => (flipCooldown = false), 1000);
  }

})();