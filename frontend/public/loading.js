// The Tauri shell calls window.__qzError(msg) (via eval) if the server
// never comes up, turning a blank "can't reach this page" into an
// actionable message.
window.__qzError = function (msg) {
  document.getElementById("spinner").style.display = "none";
  document.getElementById("sub").style.display = "none";
  var e = document.getElementById("error");
  e.textContent = msg;
  e.style.display = "block";
};
