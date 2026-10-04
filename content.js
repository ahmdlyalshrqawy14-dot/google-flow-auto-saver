// ==========================================
// 1. ذاكرة التقاط الصور من الشبكة والمؤشرات
// ==========================================
const networkCapturedImages = new Map();
let isRunning = false;
let isStopped = false;

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

// الاستماع للصور الملتقطة عبر postMessage
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'FLOW_IMAGE_CAPTURED') {
    const url = event.data.url;
    if (!networkCapturedImages.has(url)) {
      const nextIndex = networkCapturedImages.size + 1;
      networkCapturedImages.set(url, { src: url, index: nextIndex });
      console.log(`[Google Flow Auto Saver] تم التقاط صورة من المصدر: ${url}`);
    }
  }
});

// ==========================================
// 2. الدوال المساعدة (Helper Functions)
// ==========================================

// استخراج رقم الصورة من البرومبت باستخدام Regex
function extractImageNumber(promptText, fallbackIndex) {
  if (!promptText) return String(fallbackIndex);
  const match = promptText.match(/(?:صورة|صوره|image)?\s*(?:رقم|#)?\s*(\d+)/i);
  return (match && match[1]) ? match[1] : String(fallbackIndex);
}

// دالة الانتظار
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// إرسال تحديثات الحالة للـ Popup
function notifyStatus(statusText, current, total, completed = false) {
  chrome.runtime.sendMessage({
    type: 'STATUS_UPDATE',
    statusText,
    current,
    total,
    completed
  });
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
async function waitForNewImage(previousCapturedCount, timeoutSeconds = 60) {
  const startTime = Date.now();
  const initialDomImages = Array.from(document.querySelectorAll('img'))
    .filter(img => img.src.startsWith('http') && (img.naturalWidth > 150 || img.clientWidth > 150))
    .map(img => img.src);

  while (Date.now() - startTime < timeoutSeconds * 1000) {
    if (isStopped) return null;

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
async function startAutoGeneration(prompts, delayTimeSec) {
  if (isRunning) return;
  isRunning = true;
  isStopped = false;

  const zip = new JSZip();
  const total = prompts.length;

  for (let i = 0; i < total; i++) {
    if (isStopped) {
      notifyStatus('تم إيقاف العملية بواسطة المستخدم', i, total, true);
      isRunning = false;
      return;
    }

    const currentPrompt = prompts[i];
    const imgNumber = extractImageNumber(currentPrompt, i + 1);
    const fileName = `${imgNumber}.png`;

    notifyStatus(`جاري إرسال البرومبت (${imgNumber})...`, i + 1, total);

    const { input, generateBtn } = getFlowElements();
    if (!input || !generateBtn) {
      notifyStatus('لم يتم العثور على خانة الإدخال في الصفحة!', i, total, true);
      isRunning = false;
      return;
    }

    const initialCapturedCount = networkCapturedImages.size;

    // كتابة البرومبت والنقر
    setInputValue(input, currentPrompt);
    await delay(500);
    generateBtn.click();

    notifyStatus(`جاري انتظار توليد صورة (${fileName})...`, i + 1, total);

    // انتظار الصورة الجديدة
    const imageUrl = await waitForNewImage(initialCapturedCount, 90);

    if (imageUrl) {
      const blob = await fetchImageBlob(imageUrl);
      if (blob) {
        zip.file(fileName, blob);
        notifyStatus(`تمت إضافة ${fileName} بنجاح للـ ZIP`, i + 1, total);
      } else {
        notifyStatus(`فشل تحميل صورة ${fileName}`, i + 1, total);
      }
    } else {
      notifyStatus(`تجاوز الوقت المحدد للبرومبت ${fileName}`, i + 1, total);
    }

    // مهلة الأمان بين البرومبتات
    if (i < total - 1 && !isStopped) {
      notifyStatus(`انتظار مهلة أمان (${delayTimeSec} ثوانٍ)...`, i + 1, total);
      await delay(delayTimeSec * 1000);
    }
  }

  notifyStatus('جاري ضغط وتجميع ملف ZIP...', total, total);
  downloadZip(zip, 'google_flow_auto_images.zip');
  notifyStatus('اكتملت جميع البرومبتات وتنزيل الملف بنجاح!', total, total, true);

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
      let imgNum = extractImageNumber(promptText, idx + 1);
      items.push({ src: img.src, index: imgNum });
    });
  }

  if (items.length === 0) {
    notifyStatus('لم يتم العثور على أي صور صالحة في الصفحة أو الذاكرة', 0, 0, true);
    return;
  }

  notifyStatus(`تم العثور على ${items.length} صورة. جاري الضغط...`, 0, items.length);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const fileName = `${item.index}.png`;

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
    startAutoGeneration(request.prompts, request.delay);
    sendResponse({ status: 'STARTED' });
  } else if (request.action === 'STOP_AUTO') {
    isStopped = true;
    sendResponse({ status: 'STOPPING' });
  } else if (request.action === 'SCAN_PAGE') {
    scanPageAndDownload();
    sendResponse({ status: 'SCANNING' });
  }
  return true;
});
