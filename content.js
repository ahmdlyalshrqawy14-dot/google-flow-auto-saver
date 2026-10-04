// ==========================================
// 1. ذاكرة التقاط الصور من الشبكة والحالة
// ==========================================
const networkCapturedImages = new Map();
let isRunning = false;
let isPaused = false;
let isStopped = false;
let executionLogs = [];
let successCount = 0;
let failedCount = 0;

// حقن سكريبت اعتراض طلبات fetch في بيئة الصفحة الرئيسية
function injectNetworkInterceptor() {
  const script = document.createElement('script');
  script.textContent = `
    (function() {
      const originalFetch = window.fetch;
      window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);
        try {
          const clone = response.clone();
          const contentType = clone.headers.get('content-type') || '';
          if (contentType.includes('application/json') || contentType.includes('text/plain')) {
            clone.text().then(text => {
              const imgUrls = text.match(/https:\/\/[^"]+\.(?:png|jpg|jpeg|webp)[^"]*/g) || [];
              imgUrls.forEach(url => {
                window.postMessage({ type: 'FLOW_IMAGE_CAPTURED', url: url }, '*');
              });
            });
          }
        } catch(e) {}
        return response;
      };
    })();
  `;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}

// تشغيل الاعتراض فور تحميل الصفحة
injectNetworkInterceptor();

// إرسال إشعار للمتصفح إذا كان مفعلاً
function showCompletionNotification(message) {
  if (chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ type: 'SHOW_NOTIFICATION', message });
  }
}

// الاستماع للصور الملتقطة عبر postMessage
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'FLOW_IMAGE_CAPTURED') {
    const url = event.data.url;
    if (!networkCapturedImages.has(url)) {
      const nextIndex = networkCapturedImages.size + 1;
      networkCapturedImages.set(url, { src: url, index: nextIndex });
      console.log(`[Google Flow Auto Saver Pro] تم التقاط صورة من الشبكة: ${url}`);
    }
  }
});

// ==========================================
// 2. الدوال المساعدة (Helper Functions)
// ==========================================

// استخراج رقم الصورة أو صياغة الاسم النهائي حسب الإعدادات
function formatFileName(promptText, index, pattern = 'number') {
  const match = (promptText || '').match(/(?:صورة|صوره|image)?\s*(?:رقم|#)?\s*(\d+)/i);
  const imgNum = (match && match[1]) ? match[1] : String(index);

  if (pattern === 'number_prompt') {
    const cleanPrompt = (promptText || '').replace(/[^\w\s\u0600-\u06FF]/gi, '').substring(0, 20).trim();
    return `${imgNum}_${cleanPrompt || 'image'}.png`;
  } else if (pattern === 'timestamp') {
    const timeStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `${imgNum}_${timeStr}.png`;
  }

  return `${imgNum}.png`;
}

// دالة الانتظار مع دعم الإيقاف المؤقت والإلغاء
async function delay(ms) {
  const step = 200;
  let elapsed = 0;
  while (elapsed < ms) {
    if (isStopped) break;
    while (isPaused && !isStopped) {
      await new Promise(r => setTimeout(r, 300));
    }
    await new Promise(r => setTimeout(r, step));
    elapsed += step;
  }
}

// إرسال تحديثات الحالة ورسائل السجل للـ Popup
function notifyStatus(statusText, current, total, completed = false) {
  chrome.runtime.sendMessage({
    type: 'STATUS_UPDATE',
    statusText,
    current,
    total,
    completed,
    logs: executionLogs,
    successCount,
    failedCount
  });

  // حفظ الحالة في chrome.storage للاسترجاع
  chrome.storage.local.set({
    executionState: {
      isRunning,
      isPaused,
      statusText,
      current,
      total
    }
  });
}

function addLogEntry(fileName, promptText, status) {
  const timeStr = new Date().toLocaleTimeString('ar-EG', { hour12: false });
  executionLogs.unshift({
    fileName,
    prompt: (promptText || '').substring(0, 30),
    status,
    time: timeStr
  });
  if (executionLogs.length > 50) executionLogs.pop();
}

// كتابة النص في خانة البرومبت وتفعيل الأحداث
function setInputValue(inputElement, text) {
  if (!inputElement) return;

  inputElement.focus();
  const isEditable = inputElement.isContentEditable ||
                     inputElement.getAttribute('contenteditable') === 'true' ||
                     inputElement.getAttribute('contenteditable') === '';

  if (isEditable) {
    inputElement.innerText = text;
    inputElement.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
  } else {
    inputElement.value = text;
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    inputElement.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

// البحث عن عناصر الإدخال وزر التوليد داخل الواجهة
function getFlowElements() {
  const input = document.querySelector('textarea, [contenteditable="true"], [contenteditable=""], [contenteditable], input[type="text"]');
  const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
  const generateBtn = buttons.find(b => {
    const txt = (b.innerText || b.getAttribute('aria-label') || b.getAttribute('title') || '').trim();
    return /generate|توليد|إرسال|send|create|run|submit|أرسل/i.test(txt);
  }) || buttons[buttons.length - 1];

  return { input, generateBtn };
}

// الانتظار حتى ظهور صورة جديدة في DOM الصفحة أو التقاطها عبر الشبكة
async function waitForNewImage(previousCapturedCount, timeoutSeconds = 90) {
  const startTime = Date.now();
  const initialDomImages = Array.from(document.querySelectorAll('img'))
    .filter(img => img.src.startsWith('http') && (img.naturalWidth > 150 || img.clientWidth > 150))
    .map(img => img.src);

  while (Date.now() - startTime < timeoutSeconds * 1000) {
    if (isStopped) return null;
    while (isPaused && !isStopped) {
      await new Promise(r => setTimeout(r, 500));
    }

    // 1. تحقق من ذاكرة التقاط الشبكة أولاً
    const captured = Array.from(networkCapturedImages.values());
    if (captured.length > previousCapturedCount) {
      const latestCaptured = captured[captured.length - 1];
      if (latestCaptured && latestCaptured.src) {
        return latestCaptured.src;
      }
    }

    // 2. تحقق من عناصر الصورة في DOM
    const currentDomImages = Array.from(document.querySelectorAll('img')).filter(img =>
      img.src.startsWith('http') &&
      !img.src.includes('avatar') &&
      !img.src.includes('profile') &&
      !img.src.includes('icon') &&
      (img.naturalWidth > 150 || img.clientWidth > 150 || img.naturalHeight > 150 || img.clientHeight > 150)
    );

    const newDomImg = currentDomImages.find(img => !initialDomImages.includes(img.src));
    if (newDomImg && newDomImg.complete) {
      return newDomImg.src;
    }

    await delay(1000);
  }

  // محاولة أخيرة: إرجاع آخر صورة ملتقطة إذا وجدت
  const finalCaptured = Array.from(networkCapturedImages.values());
  if (finalCaptured.length > previousCapturedCount) {
    return finalCaptured[finalCaptured.length - 1].src;
  }

  return null;
}

// جلب الصورة كـ Blob
async function fetchImageBlob(url) {
  try {
    const response = await fetch(url);
    return await response.blob();
  } catch (err) {
    console.error('فشل جلب الصورة:', err);
    return null;
  }
}

// تنزيل ملف ZIP
function downloadZip(zip, filename = 'google_flow_images.zip') {
  zip.generateAsync({ type: 'blob' }).then((content) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(content);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });
}

// ==========================================
// 3. المود الأول: الأتمتة الكاملة (Auto Mode)
// ==========================================
async function startAutoGeneration(prompts, settings = {}) {
  if (isRunning) return;
  isRunning = true;
  isPaused = false;
  isStopped = false;
  executionLogs = [];
  successCount = 0;
  failedCount = 0;

  const zip = new JSZip();
  const total = prompts.length;

  const delayBaseSec = settings.delay || 5;
  const randomDelaySec = settings.randomDelay || 0;
  const timeoutSec = settings.timeout || 90;
  const maxRetries = settings.maxRetries || 1;
  const namingPattern = settings.namingPattern || 'number';

  for (let i = 0; i < total; i++) {
    if (isStopped) {
      notifyStatus('تم إيقاف العملية بواسطة المستخدم', i, total, true);
      isRunning = false;
      return;
    }

    const currentPrompt = prompts[i];
    const fileName = formatFileName(currentPrompt, i + 1, namingPattern);

    addLogEntry(fileName, currentPrompt, 'pending');
    notifyStatus(`جاري إرسال البرومبت (${fileName})...`, i + 1, total);

    let imageFetched = false;
    let attempt = 0;

    while (attempt <= maxRetries && !imageFetched && !isStopped) {
      attempt++;
      if (attempt > 1) {
        notifyStatus(`إعادة المحاولة ${attempt - 1}/${maxRetries} لـ (${fileName})...`, i + 1, total);
        await delay(3000);
      }

      const { input, generateBtn } = getFlowElements();
      if (!input || !generateBtn) {
        notifyStatus('لم يتم العثور على عناصر الصفحة!', i, total, true);
        isRunning = false;
        return;
      }

      const initialCapturedCount = networkCapturedImages.size;

      // كتابة البرومبت والنقر
      setInputValue(input, currentPrompt);
      await delay(600);
      generateBtn.click();

      notifyStatus(`جاري انتظار التوليد (${fileName})...`, i + 1, total);

      // انتظار الصورة جديدة
      const imageUrl = await waitForNewImage(initialCapturedCount, timeoutSec);

      if (imageUrl) {
        const blob = await fetchImageBlob(imageUrl);
        if (blob) {
          zip.file(fileName, blob);
          successCount++;
          imageFetched = true;
          addLogEntry(fileName, currentPrompt, 'success');
          notifyStatus(`تم أخذ صورة ${fileName} بنجاح`, i + 1, total);
        }
      }
    }

    if (!imageFetched) {
      failedCount++;
      addLogEntry(fileName, currentPrompt, 'failed');
      notifyStatus(`فشل توليد ${fileName} بعد عدة محاولات`, i + 1, total);
    }

    // مهلة الأمان بين البرومبتات (مع تفاوت عشوائي)
    if (i < total - 1 && !isStopped) {
      const extraRandom = randomDelaySec > 0 ? Math.floor(Math.random() * (randomDelaySec * 1000)) : 0;
      const totalWait = (delayBaseSec * 1000) + extraRandom;
      notifyStatus(`مهلة أمان (${Math.round(totalWait / 1000)} ثوانٍ)...`, i + 1, total);
      await delay(totalWait);
    }
  }

  if (settings.autoDownload !== false && successCount > 0) {
    notifyStatus('جاري ضغط وتجميع ملف ZIP...', total, total);
    downloadZip(zip, 'google_flow_auto_images.zip');
  }

  notifyStatus('اكتملت جميع العمليات بنجاح!', total, total, true);
  if (settings.notify !== false) {
    showCompletionNotification(`تم إكمال توليد ${successCount} صورة بنجاح من أصل ${total}!`);
  }

  isRunning = false;
}

// ==========================================
// 4. المود الثاني: فحص المصدر المباشر (Scan Mode)
// ==========================================
async function scanPageAndDownload() {
  const zip = new JSZip();
  let items = Array.from(networkCapturedImages.values());

  // إذا لم يتم التقاط صور عبر الشبكة، يتم فحص عناصر img الموجودة في DOM كبديل
  if (items.length === 0) {
    const domImages = Array.from(document.querySelectorAll('img')).filter(img => 
      img.src.startsWith('http') &&
      !img.src.includes('avatar') &&
      !img.src.includes('profile') &&
      !img.src.includes('icon') &&
      (img.naturalWidth > 150 || img.clientWidth > 150 || img.naturalHeight > 150 || img.clientHeight > 150)
    );

    domImages.forEach((img, idx) => {
      let promptContainer = img.closest('div, section, article, [role="region"]') || img.parentElement;
      let promptText = promptContainer ? promptContainer.innerText : '';
      let fileName = formatFileName(promptText, idx + 1, 'number');
      items.push({ src: img.src, index: fileName });
    });
  }

  if (items.length === 0) {
    notifyStatus('لم يتم العثور على أي صور صالحة في الصفحة أو الذاكرة', 0, 0, true);
    return;
  }

  notifyStatus(`تم العثور على ${items.length} صورة. جاري الضغط...`, 0, items.length);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const fileName = item.index.endsWith('.png') ? item.index : `${item.index}.png`;

    const blob = await fetchImageBlob(item.src);
    if (blob) {
      zip.file(fileName, blob);
    }
    notifyStatus(`تم تجهيز الصورة ${i + 1}/${items.length} (${fileName})`, i + 1, items.length);
  }

  downloadZip(zip, 'scanned_images.zip');
  notifyStatus(`تم تنزيل ${items.length} صورة في ملف ZIP بنجاح!`, items.length, items.length, true);
}

// ==========================================
// 5. الاستماع لرسائل الـ Popup
// ==========================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'START_AUTO') {
    startAutoGeneration(request.prompts, request.settings);
    sendResponse({ status: 'STARTED' });
  } else if (request.action === 'PAUSE_AUTO') {
    isPaused = true;
    sendResponse({ status: 'PAUSED' });
  } else if (request.action === 'RESUME_AUTO') {
    isPaused = false;
    sendResponse({ status: 'RESUMED' });
  } else if (request.action === 'STOP_AUTO') {
    isStopped = true;
    isPaused = false;
    sendResponse({ status: 'STOPPING' });
  } else if (request.action === 'SCAN_PAGE') {
    scanPageAndDownload();
    sendResponse({ status: 'SCANNING' });
  }
  return true;
});
