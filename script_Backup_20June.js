/* ========== 全局状态 ========== */
let sheetImages = [];
let currentPage = 0;
let flipCooldown = false;

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
    /* 2) 加载模型（相对 index.html，因此写 ./models 或 models 都行） */
	const MODEL_URL = 'https://raw.githubusercontent.com/rgon006/MMM/main/models';
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

  /* ---------- 其余函数 ---------- */
  function detectFaces() {
    const video = document.getElementById('video');
    const canvas = document.getElementById('overlay');
    const displaySize = { width: video.width, height: video.height };
    faceapi.matchDimensions(canvas, displaySize);

    setInterval(async () => {
      if (video.readyState !== 4) return;      // 摄像头未就绪
      const detections = await faceapi
        .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks();

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const resized = faceapi.resizeResults(detections, displaySize);
      faceapi.draw.drawFaceLandmarks(canvas, resized);

      for (const d of resized) {
        const topLip = d.landmarks.getTopLip();
        const bottomLip = d.landmarks.getBottomLip();
        const mouthHeight = bottomLip[0].y - topLip[0].y;
        if (mouthHeight > -15) {   // 张嘴阈值
          nextPage();
          break;
        }
      }
    }, 300);
  }

  async function handleFileUpload(e) {
    const files = e.target.files;
    if (!files.length) return;
    const btn = document.querySelector('.upload-btn');
    const txt = btn.innerHTML;
    btn.innerHTML = '<div class="spinner"></div> Processing…';

    try {
      sheetImages.forEach(u => URL.revokeObjectURL(u));
      sheetImages = Array.from(files, f => URL.createObjectURL(f));
      currentPage = 0;
      showPage();

      btn.innerHTML = `<span style="color:#27ae60">✓</span> Loaded ${files.length}`;
      setTimeout(() => (btn.innerHTML = txt), 3000);
    } catch (err) {
      console.error('Upload failed:', err);
      btn.innerHTML = `<span style="color:#e74c3c">✗</span> Upload failed`;
      setTimeout(() => (btn.innerHTML = txt), 3000);
    }
  }

  function showPage() {
    const img = document.getElementById('sheetDisplay');
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
})();