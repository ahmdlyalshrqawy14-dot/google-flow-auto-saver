// متغيرات التحكم بالعملية
let isRunning = false;
let isStopped = false;

// 1. استخراج رقم الصورة من البرومبت باستخدام Regex
function extractImageNumber(promptText, fallbackIndex) {
  if (!promptText) return String(fallbackIndex);

  // يبحث عن الأرقام المقترنة بكلمات مثل: صورة رقم 24، صوره 24، Image 24، #24، أو الرقم المتواجد بالنص
  const match = promptText.match(/(?:صورة|صوره|image)?\s*(?:رقم|#)?\s*(\d+)/i);
  if (match && match[1]) {
    return match[1];
  }
  return String(fallbackIndex);
}

// 2. دالة الانتظار الزمنية
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 3. تحديث الحالة وإرسالها للواجهة Popup
function notifyStatus(statusText, current, total, completed = false) {
  chrome.runtime.sendMessage({
    type: 'STATUS_UPDATE',
    statusText,
    current,
    total,
    completed
  });
}

// 4. كتابة النص في خانة البرومبت ومحاكاة الأحداث
function setInputValue(inputElement, text) {
  inputElement.value = text;
  inputElement.dispatchEvent(new Event('input', { bubbles: true }));
  inputElement.dispatchEvent(new Event('change', { bubbles: true }));
}

// 5. البحث عن خانة الإدخال وزر التوليد
function getFlowElements() {
  const input = document.querySelector('textarea, [contenteditable="true"], input[type="text"]');
  
  // البحث عن زر التوليد بأكثر من دالة استهداف
  const buttons = Array.from(document.querySelectorAll('button'));
  const generateBtn = buttons.find(b => {
    const txt = b.innerText || b.getAttribute('aria-label') || '';
    return /generate|توليد|إرسال|send|create/i.test(txt);
  }) || buttons[buttons.length - 1];

  return { input, generateBtn };
}

// 6. الانتظار حتى اكتمال ظهور الصورة الجديدة
async function waitForNewImage(previousCount, timeoutSeconds = 60) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutSeconds * 1000) {
    if (isStopped) return null;

    const images = document.querySelectorAll('img');
    if (images.length > previousCount) {
      const latestImg = images[images.length - 1];
      if (latestImg.complete && latestImg.naturalWidth > 0 && latestImg.src.startsWith('http')) {
        return latestImg.src;
      }
    }
    await delay(1000);
  }
  return null;
}

// 7. تحويل رابط الصورة إلى Blob
async function fetchImageBlob(url) {
  try {
    const response = await fetch(url);
    return await response.blob();
  } catch (err) {
    console.error('فشل جلب الصورة:', err);
    return null;
  }
}

// 8. تنزيل ملف الـ ZIP مباشرة
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

// --- تنفيذ المود الأول: الأتمتة الكاملة ---
async function startAutoGeneration(prompts, delayTimeSec) {
  if (isRunning) return;
  isRunning = true;
  isStopped = false;

  const zip = new JSZip();
  const total = prompts.length;

  for (let i = 0; i < total; i++) {
    if (isStopped) {
      notifyStatus('تم إيقاف العملية', i, total, true);
      isRunning = false;
      return;
    }

    const currentPrompt = prompts[i];
    const imgNumber = extractImageNumber(currentPrompt, i + 1);
    const fileName = `${imgNumber}.png`;

    notifyStatus(`جاري إرسال البرومبت رقم (${imgNumber})...`, i + 1, total);

    const { input, generateBtn } = getFlowElements();
    if (!input || !generateBtn) {
      notifyStatus('لم يتم العثور على عناصر الإدخال في الصفحة!', i, total, true);
      isRunning = false;
      return;
    }

    const initialImgCount = document.querySelectorAll('img').length;

    // إدخال النص وضغط الزر
    setInputValue(input, currentPrompt);
    await delay(500);
    generateBtn.click();

    notifyStatus(`جاري انتظار توليد الصورة (${imgNumber}.png)...`, i + 1, total);

    // انتظار الصورة
    const imageUrl = await waitForNewImage(initialImgCount, 90);

    if (imageUrl) {
      const blob = await fetchImageBlob(imageUrl);
      if (blob) {
        zip.file(fileName, blob);
        notifyStatus(`تمت إضافة ${fileName} بنجاح`, i + 1, total);
      } else {
        notifyStatus(`فشل تنزيل صورة ${fileName}`, i + 1, total);
      }
    } else {
      notifyStatus(`تجاوز الوقت المحدد لصورة ${fileName}`, i + 1, total);
    }

    // مهلة الأمان المحددة من الواجهة
    if (i < total - 1 && !isStopped) {
      notifyStatus(`مهلة أمان (${delayTimeSec} ثوانٍ)...`, i + 1, total);
      await delay(delayTimeSec * 1000);
    }
  }

  // تنزيل المجلد بعد الانتهاء
  notifyStatus('جاري تجميع وتنفيذ تنزيل ملف ZIP...', total, total);
  downloadZip(zip, 'google_flow_auto_images.zip');
  notifyStatus('اكتملت جميع العمليات بنجاح!', total, total, true);

  isRunning = false;
}

// --- تنفيذ المود الثاني: فحص الصور المعروضة على الشاشة ---
async function scanPageAndDownload() {
  const zip = new JSZip();
  const images = Array.from(document.querySelectorAll('img')).filter(img => 
    img.src.startsWith('http') && img.naturalWidth > 100
  );

  if (images.length === 0) {
    notifyStatus('لم يتم العثور على صور صالحة في الصفحة', 0, 0, true);
    return;
  }

  notifyStatus(`تم العثور على ${images.length} صورة. جاري التجميع...`, 0, images.length);

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    
    // محاولة قراءة النص القريب من الصورة لمعرفة الرقم
    const parentContainer = img.closest('div') || img.parentElement;
    const promptText = parentContainer ? parentContainer.innerText : '';
    
    const imgNumber = extractImageNumber(promptText, i + 1);
    const fileName = `${imgNumber}.png`;

    const blob = await fetchImageBlob(img.src);
    if (blob) {
      zip.file(fileName, blob);
    }
    notifyStatus(`تم تجهيز الصورة ${i + 1}/${images.length} (${fileName})`, i + 1, images.length);
  }

  downloadZip(zip, 'scanned_images.zip');
  notifyStatus('تم تنزيل جميع الصور في ملف ZIP بنجاح!', images.length, images.length, true);
}

// الاستماع للرسائل القادمة من popup.js
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
