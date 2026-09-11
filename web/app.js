// JS web minicode: tema + copy button. Tanpa dependensi, tanpa framework.
(function () {
  var root = document.documentElement;
  try {
    var saved = localStorage.getItem("minicode-theme");
    if (saved === "dark" || saved === "light") root.setAttribute("data-theme", saved);
  } catch (_) {}
  function checkMi() {
    try {
      if (!document.fonts || !document.fonts.check) return;
      if (!document.fonts.check('20px "Material Symbols Outlined"')) document.body.classList.add("no-mi");
    } catch (_) {}
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(checkMi);
  else window.addEventListener("load", checkMi);
  var themeBtn = document.getElementById("themebtn");
  if (themeBtn) themeBtn.setAttribute("aria-pressed", root.getAttribute("data-theme") === "dark" ? "true" : "false");
  if (themeBtn) themeBtn.addEventListener("click", function () {
    var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    themeBtn.setAttribute("aria-pressed", next === "dark" ? "true" : "false");
    var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("minicode-theme", next); } catch (_) {}
    // Ikon saja: bulan (dark_mode) saat light, matahari (light_mode) saat dark.
    themeBtn.querySelector(".material-symbols-outlined").textContent = next === "dark" ? "light_mode" : "dark_mode";
  });
  document.querySelectorAll("[data-copy]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var text = btn.getAttribute("data-copy") || "";
      function done() {
        var ic = btn.querySelector(".material-symbols-outlined");
        if (ic) { var old = ic.textContent; ic.textContent = "check"; setTimeout(function () { ic.textContent = old; }, 1200); }
      }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, done);
      else done();
    });
  });
})();
