document.addEventListener("DOMContentLoaded", () => {
  updateButtonText();
});

document.getElementById("toggleAI").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Check if the URL is valid for content script execution
  if (tab.url.startsWith("http://") || tab.url.startsWith("https://")) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: toggleAutocomplete,
    });

    // Update the button text after toggling
    // !!
    updateButtonText();
  } else {
    alert("AI Autocomplete cannot be enabled on this page.");
  }
});

function toggleAutocomplete() {
  let enabled = localStorage.getItem("aiAutocomplete") === "true";
  localStorage.setItem("aiAutocomplete", !enabled);
  alert(`AI Autocomplete is now ${!enabled ? "enabled" : "disabled"}!`);
}

function updateButtonText() {
  const enabled = localStorage.getItem("aiAutocomplete") === "true";
  const button = document.getElementById("toggleAI");
  button.textContent = enabled ? "Disable Autocomplete" : "Enable Autocomplete";
}
