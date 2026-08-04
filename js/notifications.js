/**
 * notifications.js
 * Xin quyền thông báo (giống hệt app cài từ App Store/Play Store hỏi lần
 * đầu) + gửi thông báo cục bộ (local notification).
 *
 * Ưu tiên dùng ServiceWorkerRegistration.showNotification() vì tương thích
 * tốt với iOS Safari khi app đã được "Thêm vào màn hình chính" (standalone
 * PWA) - `new Notification()` trực tiếp có thể không hoạt động ổn định
 * trong môi trường đó. Nếu không có service worker (vd đang mở bằng trình
 * duyệt thường, chưa cài), fallback về Notification API thường.
 *
 * LƯU Ý QUAN TRỌNG (để không gây hiểu lầm với người dùng): đây là thông báo
 * CỤC BỘ - chỉ hoạt động khi app còn đang chạy (kể cả chạy nền/tab khác).
 * Muốn nhận thông báo khi đã tắt hẳn app/khoá máy lâu, cần Web Push THẬT với
 * server đẩy tin (VAPID) - không nằm trong phạm vi module này.
 */

const NotificationsModule = (function () {
  const SOUND_KEY = 'dq_tracker_sound_enabled_v1';
  let bannerEl = null;
  let swRegistration = null;
  let audioCtx = null;
  let isSoundEnabled = true;

  try {
    const savedSound = localStorage.getItem(SOUND_KEY);
    if (savedSound !== null) {
      isSoundEnabled = savedSound === 'true';
    }
  } catch (err) {}

  function isSupported() {
    return 'Notification' in window;
  }

  function getPermission() {
    return isSupported() ? Notification.permission : 'unsupported';
  }

  function getAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function unlockAudio() {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  }

  function setSoundEnabled(enabled) {
    isSoundEnabled = !!enabled;
    try {
      localStorage.setItem(SOUND_KEY, isSoundEnabled ? 'true' : 'false');
    } catch (err) {}
  }

  function getSoundEnabled() {
    return isSoundEnabled;
  }

  /**
   * Phát âm thanh chuông thông báo sử dụng Web Audio API (tổng hợp 2 nốt nhạc D5 -> A5 rõ ràng, êm tai).
   */
  function playSound() {
    if (!isSoundEnabled) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;

      // Nốt 1 (D5 = 587.33 Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now);
      gain1.gain.setValueAtTime(0.2, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.25);

      // Nốt 2 (A5 = 880 Hz)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, now + 0.12);
      gain2.gain.setValueAtTime(0.25, now + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.4);
    } catch (err) {
      console.error('Không thể phát âm thanh thông báo:', err);
    }
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return null;
    try {
      swRegistration = await navigator.serviceWorker.register('sw.js');
      return swRegistration;
    } catch (err) {
      console.error('Không đăng ký được service worker:', err);
      return null;
    }
  }

  /** Xin quyền thông báo - trình duyệt tự hiển thị hộp thoại hệ thống (như app native). */
  function requestPermission() {
    unlockAudio();
    if (!isSupported()) return Promise.resolve('unsupported');
    return Notification.requestPermission().then((perm) => {
      hideBanner();
      if (perm === 'granted') {
        playSound();
      }
      return perm;
    });
  }

  /** Gửi 1 thông báo cục bộ và phát âm thanh. */
  async function notify(title, body) {
    // Luôn phát âm thanh khi có thông báo
    playSound();

    if (!isSupported() || Notification.permission !== 'granted') return;

    try {
      let reg = swRegistration;
      if (!reg && 'serviceWorker' in navigator) {
        reg = await navigator.serviceWorker.getRegistration();
      }
      if (reg) {
        await reg.showNotification(title, {
          body,
          icon: 'icons/icon-192.png',
          badge: 'icons/icon-192.png',
          tag: 'dq-tracker-' + Date.now(), // tránh gộp/đè các thông báo liên tiếp
        });
        return;
      }
      // Fallback không có service worker
      new Notification(title, { body, icon: 'icons/icon-192.png' });
    } catch (err) {
      console.error('Lỗi khi gửi thông báo:', err);
    }
  }

  /** Banner nhỏ ở dưới màn hình, mời người dùng bật thông báo (chỉ hiện khi chưa quyết định). */
  function showBanner() {
    if (bannerEl || !isSupported() || Notification.permission !== 'default') return;

    bannerEl = document.createElement('div');
    bannerEl.id = 'notifPermissionBanner';
    bannerEl.innerHTML = `
      <span>🔔 Bật thông báo & âm thanh để nhận cảnh báo giá và tín hiệu BUY/SELL?</span>
      <div class="notif-banner-actions">
        <button id="notifAllowBtn" type="button">Bật thông báo</button>
        <button id="notifDismissBtn" type="button">Để sau</button>
      </div>
    `;
    document.body.appendChild(bannerEl);

    bannerEl.querySelector('#notifAllowBtn').addEventListener('click', requestPermission);
    bannerEl.querySelector('#notifDismissBtn').addEventListener('click', hideBanner);
  }

  function hideBanner() {
    if (bannerEl) {
      bannerEl.remove();
      bannerEl = null;
    }
  }

  /** Gọi 1 lần lúc app khởi động. */
  function init() {
    // Kích hoạt AudioContext khi người dùng tương tác với app (giúp phát âm thanh mượt mà trên iOS/Android/Chrome)
    window.addEventListener('click', unlockAudio, { passive: true });
    window.addEventListener('touchstart', unlockAudio, { passive: true });
    window.addEventListener('keydown', unlockAudio, { passive: true });

    // Lắng nghe tín hiệu phát âm thanh từ Service Worker (khi nhận Push từ Server)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'PLAY_NOTIFICATION_SOUND') {
          playSound();
        }
      });
    }

    registerServiceWorker();
    if (isSupported() && Notification.permission === 'default') {
      // Delay nhẹ để không hỏi ngay khi trang vừa mở, đỡ gây khó chịu.
      setTimeout(showBanner, 1500);
    }
  }

  return {
    init,
    requestPermission,
    notify,
    playSound,
    setSoundEnabled,
    getSoundEnabled,
    isSupported,
    getPermission,
  };
})();