// JS web minicode: tema + drawer + copy + search sidebar. Tanpa dependensi.
// Sengaja tanpa framework — total <3KB agar first-paint cepat.
(function () {
  var root = document.documentElement;
  try {
    var saved = localStorage.getItem("minicode-theme");
    if (saved === "dark" || saved === "light") root.setAttribute("data-theme", saved);
  } catch (_) {}
  // Sembunyikan ikon bila font Material gagal dimuat (offline).
  function checkMi() {
    try {
      if (!document.fonts || !document.fonts.check) return;
      if (!document.fonts.check('20px "Material Symbols Outlined"')) document.body.classList.add("no-mi");
    } catch (_) {}
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(checkMi);
  else window.addEventListener("load", checkMi);
  var themeBtn = document.getElementById("themebtn");
  if (themeBtn) themeBtn.addEventListener("click", function () {
    var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("minicode-theme", next); } catch (_) {}
    themeBtn.querySelector(".material-symbols-outlined").textContent = next === "dark" ? "light_mode" : "dark_mode";
  });
  var menuBtn = document.getElementById("menubtn");
  if (menuBtn) menuBtn.addEventListener("click", function () { document.body.classList.toggle("side-open"); });
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
  var search = document.getElementById("sidesearch");
  if (search) search.addEventListener("input", function () {
    var q = search.value.toLowerCase();
    document.querySelectorAll(".side-link").forEach(function (a) {
      a.style.display = a.textContent.toLowerCase().indexOf(q) === -1 ? "none" : "";
    });
    document.querySelectorAll(".side-group").forEach(function (g) {
      var nxt = g.nextElementSibling, any = false;
      while (nxt && !nxt.classList.contains("side-group")) {
        if (nxt.classList.contains("side-link") && nxt.style.display !== "none") { any = true; break; }
        nxt = nxt.nextElementSibling;
      }
      g.style.display = any || !q ? "" : "none";
    });
  });
})();
