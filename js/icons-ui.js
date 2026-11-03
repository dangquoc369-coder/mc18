/**
 * icons-ui.js
 * Bộ icon dạng ĐƯỜNG VIỀN (outline) kiểu TradingView: nét mảnh đều 1.6,
 * đầu/góc bo tròn, bên trong TRONG SUỐT (không tô nền), hình học gọn.
 * Màu lấy từ currentColor nên tự đổi theo theme / trạng thái nút.
 *
 * NẠP NGAY SAU js/icons.js. Dùng Object.assign nên không phải sửa icons.js;
 * các icon trùng tên (sun, moon, bell, trendline, ray, hline, hray, vline,
 * cursor, long, short) GHI ĐÈ bản cũ để cả app đồng nhất 1 phong cách.
 */
const _S = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';

Object.assign(Icons, {
  // --- Topbar ---
  sun: `<svg ${_S}><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></svg>`,
  moon: `<svg ${_S}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>`,
  bell: `<svg ${_S}><path d="M6 10a6 6 0 0 1 12 0c0 4.2 1.4 5.7 2 6.5H4c.6-.8 2-2.3 2-6.5z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>`,
  marketStatus: `<svg ${_S}><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M7 11h2.5l1.5-3 2 6 1.5-3H17"/><path d="M9 21h6M12 17v4"/></svg>`,
  account: `<svg ${_S}><circle cx="12" cy="8" r="3.6"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/></svg>`,
  maximize: `<svg ${_S}><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/></svg>`,
  minimize: `<svg ${_S}><path d="M9 4v4a1 1 0 0 1-1 1H4M20 9h-4a1 1 0 0 1-1-1V4M15 20v-4a1 1 0 0 1 1-1h4M4 15h4a1 1 0 0 1 1 1v4"/></svg>`,

  // --- Điều hướng / điều khiển ---
  menu: `<svg ${_S}><path d="M4 7h16M4 12h16M4 17h16"/></svg>`,
  chevronDown: `<svg ${_S}><path d="M6 9l6 6 6-6"/></svg>`,
  chevronRight: `<svg ${_S}><path d="M9 6l6 6-6 6"/></svg>`,
  chevronsLeft: `<svg ${_S}><path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/></svg>`,
  chevronsRight: `<svg ${_S}><path d="M13 17l5-5-5-5M6 17l5-5-5-5"/></svg>`,
  starOutline: `<svg ${_S}><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>`,

  // --- Dữ liệu / sao lưu ---
  database: `<svg ${_S}><ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>`,
  download: `<svg ${_S}><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/></svg>`,
  upload: `<svg ${_S}><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 19.5h14"/></svg>`,
  volume: `<svg ${_S}><path d="M4 9.5v5h3.5L12 19V5L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/></svg>`,

  // --- Panel "Trạng thái thị trường" ---
  trendDown: `<svg ${_S}><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>`,
  sideway: `<svg ${_S}><path d="M3 12h18M17 8l4 4-4 4M7 8l-4 4 4 4"/></svg>`,
  compass: `<svg ${_S}><circle cx="12" cy="12" r="9"/><path d="M15.8 8.2l-2.1 5.5-5.5 2.1 2.1-5.5z"/></svg>`,
  pin: `<svg ${_S}><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3z"/><path d="M12 14v7"/></svg>`,
  ruler: `<svg ${_S}><path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/></svg>`,

  // --- Công cụ vẽ (đầu mút rỗng, kiểu TradingView) ---
  magnet: `<svg ${_S}><path d="M6 15V5h4v10a2 2 0 0 0 4 0V5h4v10a6 6 0 0 1-12 0z"/><path d="M6 9h4M14 9h4"/></svg>`,
  cursor: `<svg ${_S}><path d="M5 4l5.4 15 2.3-6.3L19 10.4z"/></svg>`,
  trendline: `<svg ${_S}><circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/><path d="M6.4 17.6L17.6 6.4"/></svg>`,
  ray: `<svg ${_S}><circle cx="5" cy="19" r="2"/><path d="M6.4 17.6L20 4M15 4h5v5"/></svg>`,
  hline: `<svg ${_S}><path d="M3 12h6M15 12h6"/><circle cx="12" cy="12" r="2"/></svg>`,
  hray: `<svg ${_S}><circle cx="5" cy="12" r="2"/><path d="M7 12h14M17 8l4 4-4 4"/></svg>`,
  vline: `<svg ${_S}><path d="M12 3v6M12 15v6"/><circle cx="12" cy="12" r="2"/></svg>`,
  long: `<svg ${_S}><rect x="5" y="4" width="14" height="8" rx="1" stroke="#26a69a"/><rect x="5" y="12" width="14" height="8" rx="1" stroke="#ef5350"/><path d="M12 10V6M10 8l2-2 2 2" stroke="#26a69a"/></svg>`,
  short: `<svg ${_S}><rect x="5" y="4" width="14" height="8" rx="1" stroke="#26a69a"/><rect x="5" y="12" width="14" height="8" rx="1" stroke="#ef5350"/><path d="M12 14v4M10 16l2 2 2-2" stroke="#ef5350"/></svg>`,
});

/** SVG thuần, gắn class icon-svg (cỡ do CSS quyết định) - dùng trong nút. */
function iconHTML(name) {
  const svg = Icons[name];
  return svg ? svg.replace('<svg ', '<svg class="icon-svg" ') : '';
}

/** Icon nhỏ nằm cùng dòng với chữ (tiêu đề panel, nhãn...). Màu theo chữ. */
function iconInline(name) {
  return Icons[name] ? `<span class="ms-ico">${Icons[name]}</span>` : '';
}