document.addEventListener('DOMContentLoaded', () => {
  // عناصر الواجهة
  const tabAuto = document.getElementById('tabAuto');
  const tabScan = document.getElementById('tabScan');
  const panelAuto = document.getElementById('panelAuto');
  const panelScan = document.getElementById('panelScan');

  const promptsInput = document.getElementById('promptsInput');
  const delayInput = document.getElementById('delayInput');
  const btnStartAuto = document.getElementById('btnStartAuto');
  const btnStopAuto = document.getElementById('btnStopAuto');
  const btnScanPage = document.getElementById('btnScanPage');

  const statusText = document.getElementById('statusText');
  const counterText = document.getElementById('counterText');
  const progressBar = document.getElementById('progressBar');

  // 1. التبديل بين التبويبات (Modes)
  tabAuto.addEventListener('click', () => {
    tabAuto.classList.add('active');
    tabScan.classList.remove('active');
    panelAuto.classList.add('active');
    panelScan.classList.remove('active');
  });

  tabScan.addEventListener('click', () => {
    tabScan.classList.add('active');
    tabAuto.classList.remove('active');
    panelScan.classList.add('active');
    panelAuto.classList.remove('active');
  });

  // 2. تقسيم البرومبتات بناءً على الأسطر الفارغة
  function getParsedPrompts() {
    const rawText = promptsInput.value.trim();
    if (!rawText) return [];
    
    // التقسيم بسطرين جديدين متتاليين أو أكثر (سطر فارغ كبير)
    return rawText
      .split(/\n\s*\n+/)
      .map(p => p.trim())
      .filter(p => p.length > 0);
  }

  // 3. إرسال أمر للـ Content Script في التبويب النشط
  async function sendMessageToActiveTab(message) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      updateStatus('خطأ: لم يتم العثور على تبويب نشط', 0, 0);
      return;
    }
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, message, (response) => {
        if (chrome.runtime.lastError) {
          updateStatus('تأكد من فتح صفحة Google Flow وإعادة تنشيطها', 0, 0);
          resolve(null);
        } else {
          resolve(response);
        }
      });
    });
  }

  // 4. بدء الأتمتة الكاملة
  btnStartAuto.addEventListener('click', async () => {
    const prompts = getParsedPrompts();
    if (prompts.length === 0) {
      alert('يرجى إدخال برومبت واحد على الأقل في صندوق النص!');
      return;
    }

    const delay = parseInt(delayInput.value, 10) || 5;

    btnStartAuto.disabled = true;
    btnStopAuto.disabled = false;
    promptsInput.disabled = true;

    updateStatus('جاري بدء التوليد...', 0, prompts.length);

    await sendMessageToActiveTab({
      action: 'START_AUTO',
      prompts: prompts,
      delay: delay
    });
  });

  // 5. إيقاف الأتمتة
  btnStopAuto.addEventListener('click', async () => {
    await sendMessageToActiveTab({ action: 'STOP_AUTO' });
    btnStartAuto.disabled = false;
    btnStopAuto.disabled = true;
    promptsInput.disabled = false;
    updateStatus('تم إيقاف العملية بواسطة المستخدم', 0, 0);
  });

  // 6. مود الفحص المباشر للصفحة
  btnScanPage.addEventListener('click', async () => {
    btnScanPage.disabled = true;
    updateStatus('جاري فحص الصور في الصفحة...', 0, 0);

    await sendMessageToActiveTab({ action: 'SCAN_PAGE' });
    btnScanPage.disabled = false;
  });

  // 7. الاستماع للتحديثات القادمة من content.js لتحديث شريط التقدم
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'STATUS_UPDATE') {
      updateStatus(message.statusText, message.current, message.total);

      if (message.completed) {
        btnStartAuto.disabled = false;
        btnStopAuto.disabled = true;
        promptsInput.disabled = false;
      }
    }
  });

  // دالة تحديث الحالة وشريط التقدم
  function updateStatus(text, current, total) {
    statusText.innerText = `الحالة: ${text}`;
    counterText.innerText = total > 0 ? `${current} / ${total}` : '0 / 0';
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;
    progressBar.style.width = `${percent}%`;
  }
});
