document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const tabPrompts = document.getElementById('tabPrompts');
  const tabMonitor = document.getElementById('tabMonitor');
  const tabScan = document.getElementById('tabScan');
  const tabSettings = document.getElementById('tabSettings');

  const panelPrompts = document.getElementById('panelPrompts');
  const panelMonitor = document.getElementById('panelMonitor');
  const panelScan = document.getElementById('panelScan');
  const panelSettings = document.getElementById('panelSettings');

  const connectionStatus = document.getElementById('connectionStatus');
  const promptsInput = document.getElementById('promptsInput');
  const promptCountBadge = document.getElementById('promptCountBadge');
  const fileImport = document.getElementById('fileImport');

  const btnImport = document.getElementById('btnImport');
  const btnExport = document.getElementById('btnExport');
  const btnClearPrompts = document.getElementById('btnClearPrompts');
  const btnStartAuto = document.getElementById('btnStartAuto');

  const btnPauseAuto = document.getElementById('btnPauseAuto');
  const btnResumeAuto = document.getElementById('btnResumeAuto');
  const btnStopAuto = document.getElementById('btnStopAuto');
  const btnClearLog = document.getElementById('btnClearLog');

  const botSelect = document.getElementById('botSelect');
  const btnNewBot = document.getElementById('btnNewBot');
  const btnSaveBot = document.getElementById('btnSaveBot');
  const btnDeleteBot = document.getElementById('btnDeleteBot');

  const btnScanPage = document.getElementById('btnScanPage');

  const statusText = document.getElementById('statusText');
  const counterText = document.getElementById('counterText');
  const progressBar = document.getElementById('progressBar');
  const elapsedTimeText = document.getElementById('elapsedTime');
  const successCountText = document.getElementById('successCount');
  const failedCountText = document.getElementById('failedCount');
  const logTableBody = document.getElementById('logTableBody');

  // Settings elements
  const delayInput = document.getElementById('delayInput');
  const randomDelayInput = document.getElementById('randomDelayInput');
  const timeoutInput = document.getElementById('timeoutInput');
  const maxRetriesInput = document.getElementById('maxRetriesInput');
  const namingPatternSelect = document.getElementById('namingPatternSelect');
  const checkNotify = document.getElementById('checkNotify');
  const checkAutoDownload = document.getElementById('checkAutoDownload');
  const btnSaveSettings = document.getElementById('btnSaveSettings');

  // Timer reference
  let timerInterval = null;
  let startTime = null;

  // 1. Navigation Tabs
  const tabs = [
    { btn: tabPrompts, panel: panelPrompts },
    { btn: tabMonitor, panel: panelMonitor },
    { btn: tabScan, panel: panelScan },
    { btn: tabSettings, panel: panelSettings }
  ];

  tabs.forEach(({ btn, panel }) => {
    btn.addEventListener('click', () => {
      tabs.forEach(t => {
        t.btn.classList.remove('active');
        t.panel.classList.remove('active');
      });
      btn.classList.add('active');
      panel.classList.add('active');
    });
  });

  // 2. Helper to send message to active tab
  async function sendMessageToActiveTab(message) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      updateStatusDisplay('خطأ: لم يتم العثور على تبويب نشط', 0, 0);
      return null;
    }
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, message, (response) => {
        if (chrome.runtime.lastError) {
          connectionStatus.textContent = 'غير متصل';
          connectionStatus.className = 'status-indicator';
          resolve(null);
        } else {
          connectionStatus.textContent = 'متصل';
          connectionStatus.className = 'status-indicator ready';
          resolve(response);
        }
      });
    });
  }

  // 3. Count prompts helper
  function getParsedPrompts() {
    const rawText = promptsInput.value.trim();
    if (!rawText) return [];
    return rawText
      .split(/\n\s*\n+/)
      .map(p => p.trim())
      .filter(p => p.length > 0);
  }

  function updatePromptBadge() {
    const prompts = getParsedPrompts();
    promptCountBadge.textContent = `${prompts.length} برومبت`;
  }

  promptsInput.addEventListener('input', () => {
    updatePromptBadge();
    saveCurrentDraft();
  });

  // 4. Draft & Storage Management
  async function loadStoredState() {
    chrome.storage.local.get([
      'draftPrompts',
      'botProfiles',
      'selectedBot',
      'settings',
      'executionState'
    ], (data) => {
      if (data.draftPrompts) {
        promptsInput.value = data.draftPrompts;
        updatePromptBadge();
      }

      if (data.settings) {
        delayInput.value = data.settings.delay || 5;
        randomDelayInput.value = data.settings.randomDelay || 2;
        timeoutInput.value = data.settings.timeout || 90;
        maxRetriesInput.value = data.settings.maxRetries || 2;
        namingPatternSelect.value = data.settings.namingPattern || 'number';
        checkNotify.checked = data.settings.notify !== false;
        checkAutoDownload.checked = data.settings.autoDownload !== false;
      }

      if (data.botProfiles) {
        renderBotOptions(data.botProfiles, data.selectedBot);
      }

      if (data.executionState) {
        restoreExecutionUI(data.executionState);
      }
    });
  }

  function saveCurrentDraft() {
    chrome.storage.local.set({ draftPrompts: promptsInput.value });
  }

  // 5. Bot Preset Profiles
  function renderBotOptions(profiles, selectedId) {
    botSelect.innerHTML = '<option value="default">الافتراضي (توليد الصور المباشر)</option>';
    Object.keys(profiles || {}).forEach(id => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = profiles[id].name;
      if (id === selectedId) option.selected = true;
      botSelect.appendChild(option);
    });
  }

  btnNewBot.addEventListener('click', () => {
    const botName = prompt('أدخل اسم البوت الجديد أو القالب:');
    if (!botName) return;

    const botId = 'bot_' + Date.now();
    chrome.storage.local.get(['botProfiles'], (data) => {
      const profiles = data.botProfiles || {};
      profiles[botId] = {
        name: botName,
        prompts: promptsInput.value
      };
      chrome.storage.local.set({ botProfiles: profiles, selectedBot: botId }, () => {
        renderBotOptions(profiles, botId);
        alert(`تم إنشاء البوت "${botName}" بنجاح!`);
      });
    });
  });

  btnSaveBot.addEventListener('click', () => {
    const selectedId = botSelect.value;
    if (selectedId === 'default') {
      alert('لا يمكنك تعديل البوت الافتراضي، يرجى إنشاء بوت جديد.');
      return;
    }
    chrome.storage.local.get(['botProfiles'], (data) => {
      const profiles = data.botProfiles || {};
      if (profiles[selectedId]) {
        profiles[selectedId].prompts = promptsInput.value;
        chrome.storage.local.set({ botProfiles: profiles }, () => {
          alert('تم حفظ البرومبتات في البوت بنجاح!');
        });
      }
    });
  });

  btnDeleteBot.addEventListener('click', () => {
    const selectedId = botSelect.value;
    if (selectedId === 'default') {
      alert('لا يمكنك حذف البوت الافتراضي.');
      return;
    }
    if (!confirm('هل أنت تأكد من حذف هذا البوت؟')) return;

    chrome.storage.local.get(['botProfiles'], (data) => {
      const profiles = data.botProfiles || {};
      delete profiles[selectedId];
      chrome.storage.local.set({ botProfiles: profiles, selectedBot: 'default' }, () => {
        renderBotOptions(profiles, 'default');
        alert('تم حذف البوت.');
      });
    });
  });

  botSelect.addEventListener('change', () => {
    const selectedId = botSelect.value;
    chrome.storage.local.set({ selectedBot: selectedId });
    if (selectedId === 'default') return;

    chrome.storage.local.get(['botProfiles'], (data) => {
      const profiles = data.botProfiles || {};
      if (profiles[selectedId]) {
        promptsInput.value = profiles[selectedId].prompts || '';
        updatePromptBadge();
        saveCurrentDraft();
      }
    });
  });

  // 6. Import / Export / Clear
  btnImport.addEventListener('click', () => fileImport.click());

  fileImport.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target.result;
      if (file.name.endsWith('.json')) {
        try {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) {
            promptsInput.value = parsed.join('\n\n');
          } else if (parsed.prompts && Array.isArray(parsed.prompts)) {
            promptsInput.value = parsed.prompts.join('\n\n');
          }
        } catch (err) {
          alert('ملف JSON غير صالح');
        }
      } else {
        promptsInput.value = content;
      }
      updatePromptBadge();
      saveCurrentDraft();
      alert('تم استيراد البرومبتات بنجاح!');
    };
    reader.readAsText(file);
  });

  btnExport.addEventListener('click', () => {
    const prompts = getParsedPrompts();
    if (prompts.length === 0) {
      alert('لا توجد برومبتات للتصدير!');
      return;
    }

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(prompts, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "flow_prompts.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  });

  btnClearPrompts.addEventListener('click', () => {
    if (confirm('هل أنت متاكد من مسح جميع البرومبتات؟')) {
      promptsInput.value = '';
      updatePromptBadge();
      saveCurrentDraft();
    }
  });

  // 7. Settings Save
  btnSaveSettings.addEventListener('click', () => {
    const settings = {
      delay: parseInt(delayInput.value, 10) || 5,
      randomDelay: parseInt(randomDelayInput.value, 10) || 0,
      timeout: parseInt(timeoutInput.value, 10) || 90,
      maxRetries: parseInt(maxRetriesInput.value, 10) || 2,
      namingPattern: namingPatternSelect.value,
      notify: checkNotify.checked,
      autoDownload: checkAutoDownload.checked
    };

    chrome.storage.local.set({ settings }, () => {
      alert('تم حفظ الإعدادات بنجاح!');
    });
  });

  // 8. Start Execution
  btnStartAuto.addEventListener('click', async () => {
    const prompts = getParsedPrompts();
    if (prompts.length === 0) {
      alert('يرجى إدخال برومبت واحد على الأقل في صندوق النص!');
      return;
    }

    const settings = {
      delay: parseInt(delayInput.value, 10) || 5,
      randomDelay: parseInt(randomDelayInput.value, 10) || 0,
      timeout: parseInt(timeoutInput.value, 10) || 90,
      maxRetries: parseInt(maxRetriesInput.value, 10) || 2,
      namingPattern: namingPatternSelect.value,
      notify: checkNotify.checked,
      autoDownload: checkAutoDownload.checked
    };

    setExecutionModeUI(true);
    tabMonitor.click(); // Switch to Monitor tab

    startTimer();

    await sendMessageToActiveTab({
      action: 'START_AUTO',
      prompts,
      settings
    });
  });

  // Controls: Pause, Resume, Stop
  btnPauseAuto.addEventListener('click', async () => {
    await sendMessageToActiveTab({ action: 'PAUSE_AUTO' });
    btnPauseAuto.style.display = 'none';
    btnResumeAuto.style.display = 'inline-flex';
    btnResumeAuto.disabled = false;
    statusText.textContent = 'الحالة: متوقف مؤقتاً';
  });

  btnResumeAuto.addEventListener('click', async () => {
    await sendMessageToActiveTab({ action: 'RESUME_AUTO' });
    btnResumeAuto.style.display = 'none';
    btnPauseAuto.style.display = 'inline-flex';
    btnPauseAuto.disabled = false;
    statusText.textContent = 'الحالة: جاري المتابعة...';
  });

  btnStopAuto.addEventListener('click', async () => {
    await sendMessageToActiveTab({ action: 'STOP_AUTO' });
    setExecutionModeUI(false);
    stopTimer();
    statusText.textContent = 'الحالة: تم الإيقاف بواسطة المستخدم';
  });

  btnClearLog.addEventListener('click', () => {
    logTableBody.innerHTML = '<tr class="empty-row"><td colspan="4">لا توجد عمليات جارية حالياً</td></tr>';
  });

  // Direct Scan Button
  btnScanPage.addEventListener('click', async () => {
    btnScanPage.disabled = true;
    updateStatusDisplay('جاري فحص الصور في الصفحة...', 0, 0);

    await sendMessageToActiveTab({ action: 'SCAN_PAGE' });
    btnScanPage.disabled = false;
  });

  // 9. Status & Log Listener from Content Script
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'SHOW_NOTIFICATION') {
      if (chrome.notifications && chrome.notifications.create) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          title: 'Google Flow Auto Saver Pro',
          message: message.message || 'اكتملت جميع العمليات بنجاح!'
        });
      }
    }

    if (message.type === 'STATUS_UPDATE') {
      updateStatusDisplay(message.statusText, message.current, message.total);

      if (message.logs && Array.isArray(message.logs)) {
        renderLogEntries(message.logs);
      }

      if (message.successCount !== undefined) successCountText.textContent = message.successCount;
      if (message.failedCount !== undefined) failedCountText.textContent = message.failedCount;

      if (message.completed) {
        setExecutionModeUI(false);
        stopTimer();
      }
    }
  });

  // Helpers
  function setExecutionModeUI(running) {
    btnStartAuto.disabled = running;
    btnPauseAuto.disabled = !running;
    btnPauseAuto.style.display = running ? 'inline-flex' : 'inline-flex';
    btnResumeAuto.style.display = 'none';
    btnStopAuto.disabled = !running;
    promptsInput.disabled = running;
    connectionStatus.className = running ? 'status-indicator working' : 'status-indicator ready';
    connectionStatus.textContent = running ? 'جاري التوليد' : 'جاهز';
  }

  function updateStatusDisplay(text, current, total) {
    statusText.textContent = `الحالة: ${text}`;
    counterText.textContent = total > 0 ? `${current} / ${total}` : '0 / 0';
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;
    progressBar.style.width = `${percent}%`;
  }

  function renderLogEntries(logs) {
    if (logs.length === 0) return;
    logTableBody.innerHTML = '';
    logs.forEach((item, index) => {
      const tr = document.createElement('tr');
      const tagClass = item.status === 'success' ? 'success' : item.status === 'failed' ? 'failed' : 'pending';
      const statusLabel = item.status === 'success' ? 'نجاح' : item.status === 'failed' ? 'فشل' : 'جاري...';

      tr.innerHTML = `
        <td>${index + 1}</td>
        <td>${item.fileName || 'غير محدد'}</td>
        <td><span class="status-tag ${tagClass}">${statusLabel}</span></td>
        <td>${item.time || ''}</td>
      `;
      logTableBody.appendChild(tr);
    });
  }

  function startTimer() {
    stopTimer();
    startTime = Date.now();
    timerInterval = setInterval(() => {
      const elapsedMs = Date.now() - startTime;
      const totalSecs = Math.floor(elapsedMs / 1000);
      const mins = String(Math.floor(totalSecs / 60)).padStart(2, '0');
      const secs = String(totalSecs % 60).padStart(2, '0');
      elapsedTimeText.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function restoreExecutionUI(state) {
    if (state.isRunning) {
      setExecutionModeUI(true);
      if (state.isPaused) {
        btnPauseAuto.style.display = 'none';
        btnResumeAuto.style.display = 'inline-flex';
        btnResumeAuto.disabled = false;
      }
      updateStatusDisplay(state.statusText || 'جاري المعالجة...', state.current || 0, state.total || 0);
    }
  }

  // Load initial stored state
  await loadStoredState();
  updatePromptBadge();
});
